import httpx
import time
import logging
import re
import json
from sqlalchemy import or_
from sqlalchemy.orm import Session
from .database import Album
from .config import load_config

logger = logging.getLogger(__name__)
DISCOGS_BASE = 'https://api.discogs.com'


# ── STEP 1: Claude normalises the search query ────────────────────────────────

def normalise_query(artist: str, title: str, api_key: str) -> dict:
    """
    Ask Claude to clean and prepare the best Discogs search query.
    Returns a dict with: clean_artist, alt_artist, search_title, notes
    """
    try:
        resp = httpx.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            json={
                'model': 'claude-haiku-4-5-20251001',
                'max_tokens': 200,
                'messages': [{
                    'role': 'user',
                    'content': f'''You are helping search for a music release on Discogs.

Artist: {artist}
Album: {title}

Return ONLY a JSON object with these fields:
- clean_artist: the artist name cleaned for search (remove special chars, fix encoding issues like ö→o, ü→u, normalize & vs and)
- alt_artist: if compound artist (A & B), just the primary/first artist name
- search_title: the album title cleaned for search (remove subtitles after : or /, remove EP/LP/Vol suffixes if they might not be on Discogs)
- notes: one sentence about what kind of release this likely is

No explanation, just the JSON.'''
                }]
            },
            timeout=15
        )
        resp.raise_for_status()
        text = resp.json()['content'][0]['text'].strip()
        # Strip markdown fences if present
        text = re.sub(r'^```json\s*|\s*```$', '', text, flags=re.MULTILINE).strip()
        return json.loads(text)
    except Exception as e:
        logger.warning(f'Claude normalisation failed for {artist} - {title}: {e}')
        # Fall back to basic cleaning
        clean = re.sub(r'[^\w\s&]', ' ', artist).strip()
        return {
            'clean_artist': clean,
            'alt_artist': re.split(r'\s*[&,]\s*', clean)[0].strip(),
            'search_title': title,
            'notes': ''
        }


# ── STEP 2: Discogs search with multiple strategies ───────────────────────────

def discogs_search(artist: str, title: str, token: str) -> tuple[list, str]:
    """
    Search Discogs with multiple strategies. Returns (results, result_type).
    Tries master releases first (have original year), then releases.
    """
    headers = {
        'Authorization': f'Discogs token={token}',
        'User-Agent': 'CrateApp/1.0'
    }

    strategies = [
        {'artist': artist, 'release_title': title, 'type': 'master'},
        {'release_title': title, 'type': 'master'},
        {'artist': artist, 'release_title': title, 'type': 'release'},
        {'release_title': title, 'type': 'release'},
    ]

    for params in strategies:
        try:
            resp = httpx.get(
                f'{DISCOGS_BASE}/database/search',
                params={**params, 'per_page': 5},
                headers=headers,
                timeout=10
            )
            resp.raise_for_status()
            results = resp.json().get('results', [])
            if results:
                return results, params.get('type', 'release')
            time.sleep(0.3)
        except Exception as e:
            logger.warning(f'Discogs strategy {params} failed: {e}')
            time.sleep(0.5)

    return [], 'release'


def get_release_detail(discogs_id: str, token: str) -> dict | None:
    headers = {
        'Authorization': f'Discogs token={token}',
        'User-Agent': 'CrateApp/1.0'
    }
    try:
        resp = httpx.get(
            f'{DISCOGS_BASE}/releases/{discogs_id}',
            headers=headers,
            timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning(f'Discogs release detail failed for {discogs_id}: {e}')
        return None


# ── STEP 3: Claude validates the match ───────────────────────────────────────

def validate_match(artist: str, title: str, discogs_result: dict, api_key: str) -> float:
    """
    Returns confidence score 0.0–1.0. Skips Claude if titles match closely.
    """
    result_title = discogs_result.get('title', '').lower()
    search_title = title.lower()
    search_artist = artist.lower().split('&')[0].strip()

    # Quick title check — if titles overlap closely, skip the API call entirely
    result_album_part = result_title.split(' - ')[-1].strip()
    if search_title in result_title or result_album_part in search_title:
        logger.info(f'Title match — skipping validation for: {title}')
        return 0.9

    # Otherwise ask Claude
    try:
        result_summary = {
            'title': discogs_result.get('title', ''),
            'year': discogs_result.get('year', ''),
            'label': discogs_result.get('label', []),
            'genre': discogs_result.get('genre', []),
            'style': discogs_result.get('style', []),
            'country': discogs_result.get('country', ''),
            'format': discogs_result.get('format', []),
        }

        resp = httpx.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            json={
                'model': 'claude-haiku-4-5-20251001',
                'max_tokens': 50,
                'messages': [{
                    'role': 'user',
                    'content': f'''Does this Discogs result match the album we are looking for? Be generous — different pressings, reissues, and regional releases of the same album count as a match.

We are looking for:
Artist: {artist}
Album: {title}

Discogs result:
{json.dumps(result_summary, indent=2)}

A match means: same music, same artist (allowing for name variations), same album title (allowing for subtitle differences).
NOT a match means: completely different artist, or completely different album.

Reply ONLY with JSON: {{"confidence": 0.0}} where 1.0 = same music, 0.0 = different music entirely.'''
                }]
            },
            timeout=15
        )
        resp.raise_for_status()
        text = resp.json()['content'][0]['text'].strip()
        text = re.sub(r'^```json\s*|\s*```$', '', text, flags=re.MULTILINE).strip()
        return float(json.loads(text).get('confidence', 0.0))
    except Exception as e:
        logger.warning(f'Claude validation failed: {e}')
        return 0.5  # assume ok if validation fails


# ── STEP 4: Main enrichment function ─────────────────────────────────────────

def enrich_album(album: Album, db: Session, token: str, api_key: str,
                 confidence_threshold: float = 0.75) -> bool:
    if not album.artist or not album.title:
        return False

    # Step 1 — Claude normalises the query
    normalised = normalise_query(album.artist, album.title, api_key)
    clean_artist = normalised.get('clean_artist', album.artist)
    alt_artist = normalised.get('alt_artist', clean_artist)
    search_title = normalised.get('search_title', album.title)

    logger.info(f'Searching: "{clean_artist}" — "{search_title}"')

    # Step 2 — Search Discogs with cleaned query, then alt artist if needed
    results, result_type = discogs_search(clean_artist, search_title, token)
    if not results and alt_artist != clean_artist:
        time.sleep(0.5)
        results, result_type = discogs_search(alt_artist, search_title, token)
    if not results:
        # Last resort — title only
        time.sleep(0.5)
        results, result_type = discogs_search('', search_title, token)
    if not results:
        logger.info(f'No Discogs results for: {album.artist} — {album.title}')
        album.enriched_source = 'not_found'
        db.commit()
        return False

    best = results[0]

    # Step 3 — Claude validates the match
    confidence = validate_match(album.artist, album.title, best, api_key)
    if confidence < confidence_threshold:
        logger.info(f'Low confidence ({confidence:.2f}) for {album.artist} — {album.title}, skipping')
        album.enriched_source = 'low_confidence'
        db.commit()
        return False

    # Step 4 — Get full release detail
    discogs_id = str(best.get('id', ''))
    if result_type == 'master':
        main_release_id = best.get('main_release')
        detail = get_release_detail(str(main_release_id), token) if main_release_id else None
        original_year = str(best.get('year', '') or '')
    else:
        detail = get_release_detail(discogs_id, token) if discogs_id else None
        # Pick earliest year from results
        with_years = [(r, int(r['year'])) for r in results if r.get('year') and str(r['year']).isdigit()]
        if with_years:
            with_years.sort(key=lambda x: x[1])
            original_year = str(with_years[0][1])
        else:
            original_year = str(best.get('year', '') or '')

    source = detail or best

    # Extract fields
    labels = source.get('labels', [])
    label = labels[0].get('name') if labels else (
        best.get('label', [None])[0] if isinstance(best.get('label'), list) else best.get('label')
    )
    catalog_num = labels[0].get('catno') if labels else None
    genres = source.get('genres', [])
    styles = source.get('styles', [])
    country = source.get('country') or best.get('country')
    formats = source.get('formats', [])
    fmt = formats[0].get('name') if formats else None

    # Save
    album.enriched_label       = label
    album.enriched_catalog_num = catalog_num
    album.enriched_genre       = genres[0] if genres else None
    album.enriched_style       = ', '.join(styles[:3]) if styles else None
    album.enriched_year        = original_year or None
    album.enriched_country     = country
    album.enriched_format      = fmt
    album.enriched_discogs_id  = discogs_id
    raw_uri = source.get('uri') or f'/release/{discogs_id}'
    album.enriched_discogs_url = raw_uri if raw_uri.startswith('http') else f'https://www.discogs.com{raw_uri}'
    album.enriched_source      = 'discogs'

    db.commit()
    logger.info(f'Enriched ({confidence:.2f}): {album.artist} — {album.title} (Discogs ID: {discogs_id}, Year: {original_year})')
    return True


# ── STEP 5: Enrich full library ───────────────────────────────────────────────

def enrich_library(progress_callback=None) -> dict:
    """Opens its own DB session — never call with an external session."""
    from .database import SessionLocal

    config = load_config()
    token = config.get('enrichment', {}).get('discogs_token', '')
    api_key = config.get('ai', {}).get('api_key', '')
    confidence_threshold = config.get('enrichment', {}).get('confidence_threshold', 0.55)

    if not token:
        return {'error': 'No Discogs token configured', 'total': 0, 'enriched': 0, 'failed': 0}
    if not api_key:
        return {'error': 'No AI API key configured', 'total': 0, 'enriched': 0, 'failed': 0}

    db = SessionLocal()
    try:
        # Pick up unenriched, failed, and low-confidence albums
        albums = db.query(Album).filter(
            or_(
                Album.enriched_source.is_(None),
                Album.enriched_source.in_(['not_found', 'low_confidence', 'retry'])
            ),
            Album.artist != None,
            Album.title != None
        ).all()

        total = len(albums)
        enriched = 0
        failed = 0
        logger.info(f'enrich_library: starting — {total} albums to process')

        for i, album in enumerate(albums):
            success = enrich_album(album, db, token, api_key, confidence_threshold)
            if success:
                enriched += 1
            else:
                failed += 1

            if progress_callback:
                progress_callback(i + 1, total, album.title or '')

            # Discogs rate limit: 60/min. Claude adds ~2s per album.
            # Total ~3-4s per album keeps both APIs happy.
            time.sleep(1.0)

        logger.info(f'enrich_library: done — enriched={enriched}, failed={failed}')
        return {'total': total, 'enriched': enriched, 'failed': failed}
    finally:
        db.close()
