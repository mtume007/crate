import os
import hashlib
from pathlib import Path
from datetime import datetime
from mutagen.flac import FLAC
from mutagen.mp3 import MP3
from mutagen.id3 import ID3
from mutagen import MutagenError
from PIL import Image
import io
import logging

logger = logging.getLogger(__name__)

ARTWORK_DIR = os.path.expanduser("~/.crate/artwork")
os.makedirs(ARTWORK_DIR, exist_ok=True)

SUPPORTED_FORMATS = {".flac", ".mp3"}


def scan_library(folder_path: str, db, progress_callback=None):
    """
    Scan a folder recursively for music files.
    Returns dict with counts: scanned, added, updated, skipped, errors
    """
    from .database import Track, Album

    folder_path = os.path.expanduser(folder_path)
    if not os.path.isdir(folder_path):
        raise ValueError(f"Folder not found: {folder_path}")

    stats = {"scanned": 0, "added": 0, "updated": 0, "skipped": 0, "errors": 0}

    # Collect all music files
    music_files = []
    for root, dirs, files in os.walk(folder_path):
        # Sort for consistent ordering
        dirs.sort()
        for filename in sorted(files):
            ext = Path(filename).suffix.lower()
            if ext in SUPPORTED_FORMATS:
                music_files.append(os.path.join(root, filename))

    total = len(music_files)
    logger.info(f"Found {total} music files in {folder_path}")

    for i, filepath in enumerate(music_files):
        try:
            stats["scanned"] += 1

            # Check if already in DB and unchanged
            existing = db.query(Track).filter(Track.filepath == filepath).first()
            mtime = os.path.getmtime(filepath)

            if existing and existing.scanned_at:
                scanned_ts = existing.scanned_at.timestamp()
                if scanned_ts >= mtime:
                    stats["skipped"] += 1
                    if progress_callback:
                        progress_callback(i + 1, total, filepath, "skipped")
                    continue

            # Read tags
            track_data = read_tags(filepath)
            if track_data is None:
                stats["errors"] += 1
                continue

            # Extract and save artwork
            artwork_path = extract_artwork(filepath, track_data.get("_raw_artwork"))
            track_data.pop("_raw_artwork", None)
            track_data["artwork_path"] = artwork_path

            if existing:
                # Update existing track
                for key, value in track_data.items():
                    setattr(existing, key, value)
                existing.scanned_at = datetime.utcnow()
                existing.updated_at = datetime.utcnow()
                stats["updated"] += 1
            else:
                # Create new track
                track = Track(
                    filepath=filepath,
                    scanned_at=datetime.utcnow(),
                    **track_data
                )
                db.add(track)
                stats["added"] += 1

            # Commit every 50 tracks to avoid large transactions
            if stats["scanned"] % 50 == 0:
                db.commit()
                logger.info(f"Progress: {i+1}/{total}")

            if progress_callback:
                progress_callback(i + 1, total, filepath, "added" if not existing else "updated")

        except Exception as e:
            logger.error(f"Error scanning {filepath}: {e}")
            stats["errors"] += 1
            continue

    db.commit()

    # Rebuild albums from tracks
    rebuild_albums(folder_path, db)

    logger.info(f"Scan complete: {stats}")
    return stats


def purge_stale_tracks(library_path: str, db) -> dict:
    """
    Remove Track records whose files no longer exist on disk.

    Should be called after every scan so that moved/deleted files don't linger
    in the DB as ghost entries (causing duplicates and failed playback).

    Returns { 'removed': int, 'checked': int }.
    """
    from .database import Track

    library_path = os.path.normpath(os.path.expanduser(library_path))
    tracks = db.query(Track).filter(
        Track.filepath.like(f"{library_path}%")
    ).all()

    removed = 0
    for t in tracks:
        if not os.path.exists(t.filepath):
            db.delete(t)
            removed += 1

    if removed:
        db.commit()
        try:
            rebuild_albums(library_path, db)
        except Exception as e:
            logger.error(f"purge_stale_tracks: rebuild_albums failed: {e}", exc_info=True)
        logger.info(f"Purged {removed} stale track(s) from DB")

    return {"checked": len(tracks), "removed": removed}


def read_tags(filepath: str) -> dict | None:
    """Read metadata tags from a FLAC or MP3 file."""
    ext = Path(filepath).suffix.lower()

    try:
        if ext == ".flac":
            return read_flac_tags(filepath)
        elif ext == ".mp3":
            return read_mp3_tags(filepath)
    except MutagenError as e:
        logger.error(f"Mutagen error reading {filepath}: {e}")
        return None


def _first(tags, *keys):
    """Get first non-empty value from a list of tag keys."""
    for key in keys:
        val = tags.get(key)
        if val:
            if isinstance(val, list):
                v = str(val[0]).strip()
            else:
                v = str(val).strip()
            if v:
                return v
    return None


def read_flac_tags(filepath: str) -> dict:
    audio = FLAC(filepath)
    tags = audio.tags or {}

    # Flatten lists
    t = {k.lower(): v for k, v in tags.items()}

    # Extract raw artwork
    raw_artwork = None
    if audio.pictures:
        raw_artwork = audio.pictures[0].data

    bpm_str = _first(t, "bpm", "tempo")
    bpm = None
    if bpm_str:
        try:
            bpm = float(bpm_str)
        except ValueError:
            pass

    return {
        "filename":    os.path.basename(filepath),
        "format":      "flac",
        "filesize":    os.path.getsize(filepath),
        "duration":    audio.info.length if audio.info else None,
        "bitrate":     int(audio.info.bits_per_sample * audio.info.sample_rate / 1000) if audio.info else None,
        "title":       _first(t, "title"),
        "artist":      _first(t, "artist"),
        "album_artist":_first(t, "albumartist", "album artist"),
        "album":       _first(t, "album"),
        "year":        _first(t, "date", "year"),
        "genre":       _first(t, "genre"),
        "label":       _first(t, "label", "organization", "publisher"),
        "catalog_num": _first(t, "catalognumber", "catalog", "catalogue"),
        "country":     _first(t, "releasecountry", "country"),
        "track_number":_first(t, "tracknumber"),
        "disc_number": _first(t, "discnumber"),
        "bpm":         bpm,
        "key":         _first(t, "initialkey", "key"),
        "mb_track_id": _first(t, "musicbrainz_trackid", "musicbrainz track id"),
        "mb_album_id": _first(t, "musicbrainz_albumid", "musicbrainz album id"),
        "mb_artist_id":_first(t, "musicbrainz_artistid", "musicbrainz artist id"),
        "_raw_artwork": raw_artwork,
    }


def read_mp3_tags(filepath: str) -> dict:
    audio = MP3(filepath)
    tags = ID3(filepath) if audio.tags else {}

    def get_id3(frame_id):
        frame = tags.get(frame_id)
        if frame is None:
            return None
        if hasattr(frame, 'text'):
            return str(frame.text[0]).strip() if frame.text else None
        return str(frame).strip()

    # Extract artwork from APIC frame
    raw_artwork = None
    for key in tags.keys():
        if key.startswith("APIC"):
            raw_artwork = tags[key].data
            break

    bpm_str = get_id3("TBPM")
    bpm = None
    if bpm_str:
        try:
            bpm = float(bpm_str)
        except ValueError:
            pass

    year = get_id3("TDRC") or get_id3("TYER")
    if year:
        year = str(year)[:4]  # just the year part

    return {
        "filename":    os.path.basename(filepath),
        "format":      "mp3",
        "filesize":    os.path.getsize(filepath),
        "duration":    audio.info.length if audio.info else None,
        "bitrate":     int(audio.info.bitrate / 1000) if audio.info else None,
        "title":       get_id3("TIT2"),
        "artist":      get_id3("TPE1"),
        "album_artist":get_id3("TPE2"),
        "album":       get_id3("TALB"),
        "year":        year,
        "genre":       get_id3("TCON"),
        "label":       get_id3("TPUB"),
        "catalog_num": get_id3("TXXX:CATALOGNUMBER") or get_id3("TXXX:catalognumber"),
        "country":     get_id3("TXXX:RELEASECOUNTRY") or get_id3("TXXX:MusicBrainz Album Release Country"),
        "track_number":get_id3("TRCK"),
        "disc_number": get_id3("TPOS"),
        "bpm":         bpm,
        "key":         get_id3("TKEY"),
        "mb_track_id": get_id3("UFID:http://musicbrainz.org") or get_id3("TXXX:MusicBrainz Track Id"),
        "mb_album_id": get_id3("TXXX:MusicBrainz Album Id"),
        "mb_artist_id":get_id3("TXXX:MusicBrainz Artist Id"),
        "_raw_artwork": raw_artwork,
    }


def extract_artwork(filepath: str, raw_data: bytes | None) -> str | None:
    """Extract embedded artwork, save as JPEG, return path."""
    if not raw_data:
        return None

    try:
        # Use a hash of the raw data as filename — deduplicates artwork
        art_hash = hashlib.md5(raw_data).hexdigest()
        art_path = os.path.join(ARTWORK_DIR, f"{art_hash}.jpg")

        if os.path.exists(art_path):
            return art_path  # Already extracted

        img = Image.open(io.BytesIO(raw_data))
        img = img.convert("RGB")

        # Save at reasonable size — 600px max
        img.thumbnail((600, 600), Image.LANCZOS)
        img.save(art_path, "JPEG", quality=85, optimize=True)

        return art_path

    except Exception as e:
        logger.warning(f"Could not extract artwork from {filepath}: {e}")
        return None


def rebuild_albums(folder_path: str, db):
    """
    Group tracks into albums, handling Apple Music's split-artist folder structure.

    Apple Music stores tracks by artist, so a Various Artists album or a release
    with featured artists gets split into multiple folders:
        ./Mathematik/Ecology/track1.flac
        ./Mathematik_ Boom/Ecology/track2.flac
        ./Mathematik_ Bahamadia/Ecology/track3.flac

    We detect this pattern and collapse these into one album entry.
    Grouping key: (album_title_normalised, mb_album_id OR year, parent_of_parent)
    """
    from .database import Track, Album
    import re

    tracks = db.query(Track).filter(
        Track.filepath.like(f"{folder_path}%")
    ).all()

    # Step 1: group by raw folder as before
    folders: dict[str, list] = {}
    for track in tracks:
        folder = os.path.dirname(track.filepath)
        folders.setdefault(folder, []).append(track)

    # Step 2: detect and merge split-artist folders
    # Key: (grandparent_path, normalised_album_title, year) → list of folders
    album_groups: dict[tuple, list[str]] = {}

    for folder, folder_tracks in folders.items():
        rep = next((t for t in folder_tracks if t.album), folder_tracks[0])
        album_title = rep.album or os.path.basename(folder)
        norm_title = _norm_album(album_title)
        year = (rep.year or "")[:4]
        mb_id = rep.mb_album_id or ""

        # Grandparent = the music root / artist folder's parent
        grandparent = os.path.dirname(os.path.dirname(folder))

        # Use MB ID as grouping key if available — scope globally, it's definitive
        if mb_id:
            key = ("__mb__", norm_title, mb_id)
        else:
            # Check if album folder is directly inside an artist folder
            # that is directly inside the library root — the standard Apple Music structure.
            # In this case, group globally by title+year so VA compilations collapse.
            parent = os.path.dirname(folder)
            library_root = os.path.normpath(folder_path)
            parent_norm = os.path.normpath(parent)
            is_direct_child = (parent_norm == library_root or
                               os.path.dirname(parent_norm) == library_root)

            if is_direct_child:
                # Global scope — title only, no year
                # Catches VA compilations split across unrelated artist folders
                # regardless of year differences between tracks
                key = ("__global__", norm_title)
            else:
                key = (grandparent, norm_title, year)

        album_groups.setdefault(key, []).append(folder)

    # Step 3: for each group, create/update one Album entry
    # Delete stale album entries first for this library path
    existing_albums = db.query(Album).filter(
        Album.folder_path.like(f"{folder_path}%")
    ).all()
    existing_by_folder = {a.folder_path: a for a in existing_albums}

    seen_folders = set()

    for key, group_folders in album_groups.items():
        # Collect all tracks across all folders in this group
        all_tracks = []
        for f in group_folders:
            all_tracks.extend(folders[f])

        # Pick best representative track (most metadata)
        def meta_score(t):
            return sum(1 for f in [t.album, t.artist, t.year, t.label, t.catalog_num, t.mb_album_id] if f)
        rep = max(all_tracks, key=meta_score)

        # Use primary folder (most tracks) as the canonical folder_path
        primary_folder = max(group_folders, key=lambda f: len(folders[f]))
        seen_folders.add(primary_folder)

        # Determine artist — if split across multiple artist folders, use base artist
        artists = set(
            (t.album_artist or t.artist or "").strip()
            for t in all_tracks if (t.album_artist or t.artist)
        )
        if len(artists) > 1:
            # Find common prefix (e.g. "Mathematik" from "Mathematik_ Boom" etc.)
            artist = _common_artist_root(artists)
        else:
            artist = next(iter(artists), None) or rep.album_artist or rep.artist

        artwork = next((t.artwork_path for t in all_tracks if t.artwork_path), None)

        data = {
            "title":        rep.album or os.path.basename(primary_folder),
            "artist":       artist,
            "year":         rep.year,
            "label":        rep.label,
            "catalog_num":  rep.catalog_num,
            "genre":        rep.genre,
            "country":      rep.country,
            "mb_album_id":  rep.mb_album_id,
            "artwork_path": artwork,
            "track_count":  len(all_tracks),
            "updated_at":   datetime.utcnow(),
        }

        existing = existing_by_folder.get(primary_folder)
        if existing:
            for k, v in data.items():
                setattr(existing, k, v)
        else:
            db.add(Album(folder_path=primary_folder, **data))

        # Remove stale entries for the non-primary folders in this group
        for f in group_folders:
            if f != primary_folder and f in existing_by_folder:
                db.delete(existing_by_folder[f])

    db.commit()
    logger.info(f"Rebuilt albums: {len(album_groups)} unique releases from {len(folders)} folders")


def _norm_album(title: str) -> str:
    """Normalise album title for grouping."""
    import re
    t = title.lower().strip()
    t = re.sub(r'\s*[\(\[]\s*(lp|ep|2lp|remaster|remastered|deluxe|expanded|re-?issue)[^\)\]]*[\)\]]\s*$', '', t)
    t = re.sub(r'^(the|a)\s+', '', t)
    t = re.sub(r'[^\w\s]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def _common_artist_root(artists: set) -> str:
    """
    Find the common root artist name from a set of 'Artist_ Feature' style names.
    e.g. {'Mathematik', 'Mathematik_ Boom', 'Mathematik_ Bahamadia'} → 'Mathematik'
    """
    if not artists:
        return "Various Artists"
    artists_list = sorted(artists, key=len)
    shortest = artists_list[0]
    # Check if shortest is a prefix of all others
    separators = ['_ ', ' & ', ' feat. ', ' ft. ', ', ']
    for sep in separators:
        root = shortest.split(sep)[0].strip()
        if all(a.startswith(root) for a in artists_list):
            return root
    # Fall back to shortest name
    return shortest
