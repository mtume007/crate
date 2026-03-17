"""
Crate library organiser.

When config.library.organise is True, this module physically moves audio files
into a clean folder structure under the library root:

  Complete Albums/
    Various Artists/    ← compilations (VA tag or 3+ contributing artists)
      [Album Name]/
    [Artist Name]/
      [Album Name]/
  Singles & Loose/      ← lone tracks, no album tag, or 1-track "albums"

Files already in the correct location are skipped (no move).
After moving, Track.filepath is updated in the DB, then rebuild_albums()
re-derives all Album.folder_path values from the new locations.
"""

import os
import re
import shutil
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

VA_KEYWORDS = {
    'various artists', 'various', 'va', 'v/a', 'v.a.', 'v.a',
    'varios artistas', 'divers', 'aa.vv.', 'aa vv',
}


def _sanitise(name: str) -> str:
    """Make a string safe for use as a macOS folder/file name component."""
    name = re.sub(r'[/\\:*?"<>|\x00-\x1f]', '_', name)
    name = name.strip().strip('.')
    return name[:200] or '_'


def _is_va(track_list: list) -> bool:
    """Return True if this album is a Various Artists compilation."""
    artists = set()
    for t in track_list:
        aa = (t.album_artist or '').strip()
        ta = (t.artist or '').strip()
        val = aa or ta
        if val:
            artists.add(val.lower())

    # Explicit VA tag
    if any(a in VA_KEYWORDS for a in artists):
        return True

    # Three or more distinct contributing artists (with no shared root) → compilation
    if len(artists) >= 3:
        return True

    return False


def _target_dir(track_list: list, library_path: str) -> str:
    """Work out the correct destination folder for a group of tracks."""
    if not track_list:
        return os.path.join(library_path, 'Singles & Loose')

    # Pick best representative track (most populated fields)
    def _score(t):
        return sum(1 for f in [t.album, t.album_artist, t.artist, t.year, t.label] if f)
    best = max(track_list, key=_score)

    album_title = (best.album or '').strip()
    if not album_title or len(track_list) < 2:
        return os.path.join(library_path, 'Singles & Loose')

    if _is_va(track_list):
        return os.path.join(
            library_path, 'Complete Albums', 'Various Artists',
            _sanitise(album_title)
        )

    display_artist = _sanitise(best.album_artist or best.artist or 'Unknown Artist')
    display_album  = _sanitise(album_title)
    return os.path.join(library_path, 'Complete Albums', display_artist, display_album)


def organise_library(library_path: str, db, progress_callback=None) -> dict:
    """
    Organise all tracks under library_path into the canonical folder structure.

    Returns a stats dict: { moved, skipped, errors, total }.
    """
    from .database import Track
    from .scanner import rebuild_albums

    library_path = os.path.normpath(os.path.expanduser(library_path))
    stats = {'moved': 0, 'skipped': 0, 'errors': 0, 'total': 0}

    # Only touch files that live inside the library path
    tracks = db.query(Track).filter(
        Track.filepath.like(f'{library_path}%')
    ).all()
    stats['total'] = len(tracks)

    # Group tracks by (normalised_album, normalised_album_artist_or_artist)
    groups: dict[tuple, list] = defaultdict(list)
    for t in tracks:
        album_key  = (t.album or '').lower().strip()
        artist_key = (t.album_artist or t.artist or '').lower().strip()
        if album_key:
            groups[(album_key, artist_key)].append(t)
        else:
            groups[('__singles__', '')].append(t)

    total_groups = len(groups)
    for idx, ((album_key, _), track_list) in enumerate(groups.items()):
        dest_dir = _target_dir(track_list, library_path)
        os.makedirs(dest_dir, exist_ok=True)

        for t in track_list:
            try:
                src = t.filepath
                if not os.path.exists(src):
                    stats['errors'] += 1
                    continue

                dest = os.path.join(dest_dir, os.path.basename(src))

                # Resolve filename conflict
                if os.path.exists(dest) and os.path.normpath(dest) != os.path.normpath(src):
                    base, ext = os.path.splitext(os.path.basename(src))
                    prefix = _sanitise(t.artist or 'Unknown')
                    dest = os.path.join(dest_dir, f'{prefix} - {base}{ext}')

                if os.path.normpath(dest) == os.path.normpath(src):
                    stats['skipped'] += 1
                else:
                    shutil.move(src, dest)
                    t.filepath = dest
                    stats['moved'] += 1

            except Exception as e:
                logger.error(f'organiser: could not move {t.filepath}: {e}')
                stats['errors'] += 1

        if progress_callback:
            progress_callback(idx + 1, total_groups, album_key)

    db.commit()

    # Rebuild album records to reflect the new file locations
    rebuild_albums(library_path, db)

    logger.info(
        f'Organise complete: {stats["moved"]} moved, '
        f'{stats["skipped"]} skipped, {stats["errors"]} errors'
    )
    return stats
