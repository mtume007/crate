import os
import re
import logging
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from sqlalchemy import func, cast, Integer
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from .database import init_db, get_db, SessionLocal, Track, Album
from .scanner import scan_library
from .deduplicator import deduplicate_library
from .config import load_config, save_config
from .enricher import enrich_library, enrich_album, get_release_detail, normalise_query, discogs_search

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Database initialised")
    yield

app = FastAPI(title="Crate API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost", "http://localhost"],
    allow_methods=["*"],
    allow_headers=["*", "Range"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

ARTWORK_DIR = os.path.expanduser("~/.crate/artwork")
os.makedirs(ARTWORK_DIR, exist_ok=True)

config = load_config()
ANTHROPIC_API_KEY = config['ai']['api_key'] or os.environ.get('ANTHROPIC_API_KEY')
LIBRARY_PATH = config['library']['path']

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}

# ── Scan ──────────────────────────────────────────────────────────────────────

scan_status = {
    "running": False, "stage": "",
    "current": 0, "total": 0, "current_file": "", "last_result": None,
}

class ScanRequest(BaseModel):
    folder_path: str

@app.post("/scan")
async def start_scan(req: ScanRequest, background_tasks: BackgroundTasks):
    if scan_status["running"]:
        return {"status": "already_running"}

    scan_status["running"] = True
    scan_status["stage"] = "scanning"
    scan_status["current"] = 0
    scan_status["total"] = 0
    scan_status["current_file"] = ""

    def run_scan():
        db = SessionLocal()
        try:
            def progress(current, total, filepath, action):
                scan_status["current"] = current
                scan_status["total"] = total
                scan_status["current_file"] = os.path.basename(filepath)

            result = scan_library(req.folder_path, db, progress_callback=progress)

            scan_status["stage"] = "deduplicating"
            scan_status["current_file"] = "Deduplicating library..."
            dedup_result = deduplicate_library(db, anthropic_api_key=ANTHROPIC_API_KEY)
            result["dedup"] = dedup_result
            scan_status["last_result"] = result
            scan_status["stage"] = "done"
        except Exception as e:
            logger.error(f"Scan error: {e}")
            scan_status["stage"] = "error"
        finally:
            scan_status["running"] = False
            db.close()

    background_tasks.add_task(run_scan)
    return {"status": "started", "folder": req.folder_path}

@app.get("/scan/status")
def get_scan_status():
    return scan_status

@app.post("/library/deduplicate")
async def run_dedup(background_tasks: BackgroundTasks):
    def run():
        db = SessionLocal()
        try:
            result = deduplicate_library(db, anthropic_api_key=ANTHROPIC_API_KEY)
            logger.info(f"Manual dedup result: {result}")
        finally:
            db.close()
    background_tasks.add_task(run)
    return {"status": "started"}

# ── Albums ────────────────────────────────────────────────────────────────────

@app.get("/library/albums")
def get_albums(skip: int = 0, limit: int = 500, genre: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Album)
    if genre:
        query = query.filter(Album.genre.ilike(f"%{genre}%"))
    query = query.order_by(Album.artist, Album.year)
    total = query.count()
    albums = query.offset(skip).limit(limit).all()
    return {"total": total, "albums": [album_to_dict(a) for a in albums]}

def album_to_dict(a: Album) -> dict:
    cfg = load_config()
    source = cfg.get('enrichment', {}).get('source', 'file')

    # Resolve display values based on config.enrichment.source
    def resolved(file_val, enriched_val):
        if source == 'enriched':
            return enriched_val or file_val
        if source == 'mixed':
            return enriched_val or file_val
        return file_val  # 'file' — always use original tags

    return {
        "id": a.id,
        "title": a.title,
        "artist": a.artist,
        "year": resolved(a.year, a.enriched_year),
        "label": resolved(a.label, a.enriched_label),
        "catalog_num": resolved(a.catalog_num, a.enriched_catalog_num),
        "genre": resolved(a.genre, a.enriched_genre),
        "country": resolved(a.country, a.enriched_country),
        "track_count": a.track_count,
        "mb_album_id": a.mb_album_id,
        "artwork_url": f"/artwork/{os.path.basename(a.artwork_path)}" if a.artwork_path else None,
        "folder_path": a.folder_path,
        # Raw enriched fields always included so frontend can show both
        "enriched_label": a.enriched_label,
        "enriched_catalog_num": a.enriched_catalog_num,
        "enriched_genre": a.enriched_genre,
        "enriched_style": a.enriched_style,
        "enriched_year": a.enriched_year,
        "enriched_country": a.enriched_country,
        "enriched_format": a.enriched_format,
        "enriched_discogs_id": a.enriched_discogs_id,
        "enriched_discogs_url": a.enriched_discogs_url,
        "enriched_source": a.enriched_source,
    }

# ── Tracks ────────────────────────────────────────────────────────────────────

@app.get("/library/tracks")
def get_tracks(skip: int = 0, limit: int = 500, album_folder: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Track)
    if album_folder:
        query = query.filter(Track.filepath.like(f"{album_folder}%"))
    query = query.order_by(
        Track.album,
        cast(func.substr(Track.disc_number,  1, func.instr(Track.disc_number  + '/', '/')), Integer),
        cast(func.substr(Track.track_number, 1, func.instr(Track.track_number + '/', '/')), Integer),
    )
    total = query.count()
    tracks = query.offset(skip).limit(limit).all()
    return {"total": total, "tracks": [track_to_dict(t) for t in tracks]}

def track_to_dict(t: Track) -> dict:
    return {
        "id": t.id, "filepath": t.filepath, "title": t.title, "artist": t.artist,
        "album": t.album, "album_artist": t.album_artist, "year": t.year,
        "label": t.label, "catalog_num": t.catalog_num, "genre": t.genre,
        "country": t.country, "track_number": t.track_number,
        "duration": round(t.duration, 1) if t.duration else None,
        "bitrate": t.bitrate, "format": t.format, "bpm": t.bpm, "key": t.key,
        "feel_mood": t.feel_mood, "feel_scene": t.feel_scene, "feel_role": t.feel_role,
        "feel_energy": t.feel_energy, "feel_tagged": t.feel_tagged,
        "artwork_url": f"/artwork/{os.path.basename(t.artwork_path)}" if t.artwork_path else None,
        "notes": t.notes,
    }

# ── Stats ─────────────────────────────────────────────────────────────────────

@app.get("/library/stats")
def get_stats(db: Session = Depends(get_db)):
    track_count = db.query(Track).count()
    album_count = db.query(Album).count()
    tagged_count = db.query(Track).filter(Track.feel_tagged == True).count()
    return {
        "tracks": track_count, "albums": album_count,
        "tagged": tagged_count, "untagged": track_count - tagged_count,
    }

# ── Artwork ───────────────────────────────────────────────────────────────────

@app.get("/artwork/{filename}")
def get_artwork(filename: str):
    filename = os.path.basename(filename)
    path = os.path.join(ARTWORK_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Artwork not found")
    return FileResponse(path, media_type="image/jpeg")

# ── Audio ─────────────────────────────────────────────────────────────────────

@app.get("/audio")
def serve_audio(path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(path)

# ── Enrichment ────────────────────────────────────────────────────────────────

enrichment_status = {
    'running': False, 'current': 0, 'total': 0,
    'current_album': '', 'enriched': 0, 'failed': 0, 'error': None
}

@app.post('/library/enrich')
async def start_enrichment(background_tasks: BackgroundTasks):
    if enrichment_status['running']:
        return {'status': 'already_running'}

    # Mark running immediately so status polls reflect it before the task starts
    enrichment_status['running'] = True
    enrichment_status['error'] = None
    enrichment_status['enriched'] = 0
    enrichment_status['failed'] = 0
    enrichment_status['current'] = 0
    enrichment_status['total'] = 0
    enrichment_status['current_album'] = ''

    def run():
        import traceback
        try:
            def progress(current, total, album_title):
                enrichment_status['current'] = current
                enrichment_status['total'] = total
                enrichment_status['current_album'] = album_title or ''

            result = enrich_library(progress_callback=progress)
            enrichment_status.update(result)
        except Exception as e:
            logger.error(f'Enrichment background task crashed: {e}')
            logger.error(traceback.format_exc())
            enrichment_status['error'] = str(e)
        finally:
            enrichment_status['running'] = False

    background_tasks.add_task(run)
    return {'status': 'started'}

@app.get('/library/enrich/status')
def get_enrichment_status():
    return enrichment_status

@app.post('/library/enrich/{album_id}')
def enrich_single(album_id: int, db: Session = Depends(get_db)):
    cfg = load_config()
    token = cfg.get('enrichment', {}).get('discogs_token', '')
    api_key = cfg.get('ai', {}).get('api_key', '')
    confidence_threshold = cfg.get('enrichment', {}).get('confidence_threshold', 0.75)
    if not token:
        raise HTTPException(status_code=400, detail='No Discogs token configured')
    if not api_key:
        raise HTTPException(status_code=400, detail='No AI API key configured')
    album = db.query(Album).filter(Album.id == album_id).first()
    if not album:
        raise HTTPException(status_code=404, detail='Album not found')
    success = enrich_album(album, db, token, api_key, confidence_threshold)
    return {'success': success, 'album_id': album_id}

@app.post('/enrich/search')
def enrich_search(body: dict):
    """
    Claude-normalised Discogs search for the single-add / AlbumMatcher flow.
    Returns top candidates for the user to pick from — no auto-validation.
    """
    artist = body.get('artist', '')
    title  = body.get('title', '')
    year   = body.get('year')  # informational only, not used in search yet

    cfg       = load_config()
    api_key   = cfg.get('ai', {}).get('api_key', '')
    token     = cfg.get('enrichment', {}).get('discogs_token', '')

    if not token:
        return {'error': 'No Discogs token configured', 'candidates': []}

    # Step 1 — Claude normalises (falls back to basic cleaning if no api_key)
    normalised   = normalise_query(artist, title, api_key)
    clean_artist = normalised.get('clean_artist', artist)
    search_title = normalised.get('search_title', title)

    # Step 2 — Discogs search (master first, then release)
    results, _ = discogs_search(clean_artist, search_title, token)

    return {'candidates': results[:5]}


@app.post('/library/enrich/url/{album_id}')
def enrich_by_url(album_id: int, payload: dict, db: Session = Depends(get_db)):
    """Enrich an album directly from a Discogs URL (release or master)."""
    discogs_url = payload.get('url') or payload.get('discogs_url', '')

    release_match = re.search(r'/release/(\d+)', discogs_url)
    master_match  = re.search(r'/master/(\d+)', discogs_url)

    is_master  = bool(master_match)
    release_id = master_match.group(1) if is_master else (release_match.group(1) if release_match else None)

    if not release_id:
        return {'error': 'Could not extract Discogs ID from URL'}

    cfg = load_config()
    token = cfg.get('enrichment', {}).get('discogs_token', '')
    if not token:
        return {'error': 'No Discogs token configured'}

    album = db.query(Album).filter(Album.id == album_id).first()
    if not album:
        return {'error': 'Album not found'}

    headers = {'Authorization': f'Discogs token={token}', 'User-Agent': 'CrateApp/1.0'}

    # For masters, resolve to main release first
    if is_master:
        try:
            master = httpx.get(f'https://api.discogs.com/masters/{release_id}', headers=headers, timeout=10).json()
            release_id = str(master.get('main_release', release_id))
        except Exception as e:
            logger.warning(f'Master lookup failed: {e}')

    detail = get_release_detail(release_id, token)
    if not detail:
        return {'error': 'Could not fetch release from Discogs'}

    labels  = detail.get('labels', [])
    genres  = detail.get('genres', [])
    styles  = detail.get('styles', [])
    formats = detail.get('formats', [])

    album.enriched_label       = labels[0].get('name') if labels else None
    album.enriched_catalog_num = labels[0].get('catno') if labels else None
    album.enriched_genre       = genres[0] if genres else None
    album.enriched_style       = ', '.join(styles[:3]) if styles else None
    album.enriched_year        = str(detail.get('year', '') or '') or None
    album.enriched_country     = detail.get('country')
    album.enriched_format      = formats[0].get('name') if formats else None
    album.enriched_discogs_id  = release_id
    album.enriched_discogs_url = discogs_url
    album.enriched_source      = 'discogs'

    db.commit()
    return {'success': True, 'album_id': album_id, 'year': album.enriched_year, 'label': album.enriched_label}


@app.get('/library/enrich/candidates')
def get_candidates(artist: str, title: str):
    """Return up to 4 Discogs candidates for manual review."""
    cfg = load_config()
    token = cfg.get('enrichment', {}).get('discogs_token', '')
    if not token:
        return {'error': 'No token', 'results': []}

    headers = {'Authorization': f'Discogs token={token}', 'User-Agent': 'CrateApp/1.0'}

    for search_type in ['master', 'release']:
        try:
            resp = httpx.get(
                'https://api.discogs.com/database/search',
                params={'artist': artist, 'release_title': title, 'type': search_type, 'per_page': 4},
                headers=headers,
                timeout=10
            )
            resp.raise_for_status()
            results = resp.json().get('results', [])
            if results:
                return {'results': results[:4]}
        except Exception as e:
            logger.warning(f'Candidates search failed ({search_type}): {e}')

    return {'results': []}


@app.post('/library/enrich/skip/{album_id}')
def skip_album(album_id: int, db: Session = Depends(get_db)):
    album = db.query(Album).filter(Album.id == album_id).first()
    if album:
        album.enriched_source = 'skipped'
        db.commit()
    return {'success': True}


# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/config")
def get_config():
    return load_config()

@app.post("/config")
def update_config(updates: dict):
    from .config import _deep_merge
    current = load_config()
    merged = _deep_merge(current, updates)
    save_config(merged)
    return merged
