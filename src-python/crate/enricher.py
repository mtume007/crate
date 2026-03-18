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

    # Quick title check — skip the API call only when title AND artist both match closely
    result_parts = result_title.split(' - ', 1)
    result_artist_part = result_parts[0].strip().lower() if len(result_parts) > 1 else ''
    result_album_part = result_parts[-1].strip().lower()
    artist_ok = (
        not result_artist_part                       # no artist field in result title
        or search_artist in result_artist_part       # our artist appears in result
        or result_artist_part in search_artist       # result artist appears in ours
    )
    title_ok = search_title in result_title or result_album_part in search_title
    if artist_ok and title_ok:
        logger.info(f'Title+artist match — skipping validation for: {title}')
        return 0.9
    elif not artist_ok and title_ok:
        # Title matches but artist is clearly different — fail immediately, no API call
        logger.info(f'Title match but artist mismatch — confidence 0.0 for: {title}')
        return 0.0

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
                    'content': f'''Does this Discogs result match the album we are looking for?

Be generous about different pressings, reissues, and regional editions of the same release by the same artist — those all count as matches.

Be strict about artist name: if the artist on Discogs is completely different from the artist we are looking for, return confidence 0.0 regardless of how similar the titles are. A matching title does not override a wrong artist.

We are looking for:
Artist: {artist}
Album: {title}

Discogs result:
{json.dumps(result_summary, indent=2)}

A match means: same music, same artist (minor name variations like punctuation, abbreviations, or "The" prefix are fine), same album title (subtitle differences, regional title variations, and reissue suffixes are fine).
NOT a match: if the Discogs artist is a completely different artist from "{artist}", return 0.0 — do not let title similarity override this rule.

Reply ONLY with JSON: {{"confidence": 0.0}} where 1.0 = certain match, 0.0 = different artist or completely different album.'''
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
    if confidence < 0.45:
        logger.info(f'Very low confidence ({confidence:.2f}) for {album.artist} — {album.title}, skipping')
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

    # Build discogs URL
    raw_uri = source.get('uri') or f'/release/{discogs_id}'
    discogs_url = raw_uri if raw_uri.startswith('http') else f'https://www.discogs.com{raw_uri}'

    # Save all enriched fields regardless of confidence tier
    album.enriched_label       = label
    album.enriched_catalog_num = catalog_num
    album.enriched_genre       = genres[0] if genres else None
    album.enriched_style       = ', '.join(styles[:3]) if styles else None
    album.enriched_year        = original_year or None
    album.enriched_country     = country
    album.enriched_format      = fmt
    album.enriched_discogs_id  = discogs_id
    album.enriched_discogs_url = discogs_url

    if confidence >= confidence_threshold:
        album.enriched_source = 'discogs'
        logger.info(f'Enriched ({confidence:.2f}): {album.artist} — {album.title} → {discogs_url}')
    else:
        # Saved best guess but needs human confirmation
        album.enriched_source = 'needs_review'
        logger.info(f'Needs review ({confidence:.2f}): {album.artist} — {album.title} → {discogs_url}')

    db.commit()
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
        # Pick up all albums that haven't been definitively matched yet
        albums = db.query(Album).filter(
            Album.enriched_source != 'discogs',
            Album.enriched_source != 'skipped',
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


# ── Tag normalisation map ────────────────────────────────────────────────────
#
# Maps Last.fm tag variants → canonical Crate shelf labels.
# MORE SPECIFIC entries must appear BEFORE less specific ones — the resolver
# walks the map in order and returns the first match, so subgenres win over
# broad genres when both appear in a tag list.
#
# To add a new mapping: just add a line. No other code needs changing.

TAG_MAP: list[tuple[str, str]] = [
    # ── Drum n Bass subgenres (most specific first) ──────────────────────────
    ('liquid drum and bass',        'Liquid Drum n Bass'),
    ('liquid dnb',                  'Liquid Drum n Bass'),
    ('liquid funk',                 'Liquid Drum n Bass'),
    ('neurofunk',                   'Neurofunk'),
    ('jump up',                     'Jump Up'),
    ('jump-up',                     'Jump Up'),
    ('techstep',                    'Techstep'),
    ('tech-step',                   'Techstep'),
    ('darkstep',                    'Darkstep'),
    ('dark drum and bass',          'Darkstep'),
    ('atmospheric drum and bass',   'Atmospheric Drum n Bass'),
    ('atmospheric dnb',             'Atmospheric Drum n Bass'),
    ('deep drum and bass',          'Deep Drum n Bass'),
    ('deep dnb',                    'Deep Drum n Bass'),
    ('rollers',                     'Drum n Bass'),
    ('jungle dnb',                  'Jungle'),
    ('ragga jungle',                'Jungle'),
    ('old school jungle',           'Jungle'),
    # ── Drum n Bass broad ────────────────────────────────────────────────────
    ('drum and bass',               'Drum n Bass'),
    ('drum n bass',                 'Drum n Bass'),
    ('dnb',                         'Drum n Bass'),
    ("drum'n'bass",                 'Drum n Bass'),
    ('d&b',                         'Drum n Bass'),
    # ── Jungle ───────────────────────────────────────────────────────────────
    ('jungle',                      'Jungle'),
    ('hardcore jungle',             'Jungle'),
    ('uk jungle',                   'Jungle'),
    # ── Breakbeat ────────────────────────────────────────────────────────────
    ('nu skool breaks',             'Breakbeat'),
    ('nu-skool breaks',             'Breakbeat'),
    ('big beat',                    'Big Beat'),
    ('breakbeat',                   'Breakbeat'),
    ('breakbeats',                  'Breakbeat'),
    ('breaks',                      'Breakbeat'),
    ('broken beat',                 'Broken Beat'),
    # ── Techno subgenres ─────────────────────────────────────────────────────
    ('detroit techno',              'Detroit Techno'),
    ('acid techno',                 'Acid Techno'),
    ('industrial techno',           'Industrial Techno'),
    ('hard techno',                 'Hard Techno'),
    ('minimal techno',              'Minimal Techno'),
    ('dub techno',                  'Dub Techno'),
    ('ambient techno',              'Ambient Techno'),
    ('deep techno',                 'Deep Techno'),
    ('tech trance',                 'Tech Trance'),
    # ── Techno broad ─────────────────────────────────────────────────────────
    ('techno',                      'Techno'),
    # ── House subgenres ──────────────────────────────────────────────────────
    ('deep house',                  'Deep House'),
    ('tech house',                  'Tech House'),
    ('progressive house',           'Progressive House'),
    ('acid house',                  'Acid House'),
    ('chicago house',               'Chicago House'),
    ('afro house',                  'Afro House'),
    ('minimal house',               'Minimal House'),
    ('microhouse',                  'Microhouse'),
    ('electro house',               'Electro House'),
    ('soulful house',               'Soulful House'),
    ('funky house',                 'Funky House'),
    ('disco house',                 'Disco House'),
    # ── House broad ──────────────────────────────────────────────────────────
    ('house',                       'House'),
    ('house music',                 'House'),
    # ── Trance ───────────────────────────────────────────────────────────────
    ('progressive trance',          'Progressive Trance'),
    ('psytrance',                   'Psytrance'),
    ('psy-trance',                  'Psytrance'),
    ('acid trance',                 'Acid Trance'),
    ('goa trance',                  'Goa Trance'),
    ('trance',                      'Trance'),
    # ── Electro ──────────────────────────────────────────────────────────────
    ('electro',                     'Electro'),
    ('electro funk',                'Electro Funk'),
    ('miami bass',                  'Miami Bass'),
    # ── Ambient / Downtempo ──────────────────────────────────────────────────
    ('ambient techno',              'Ambient Techno'),
    ('dark ambient',                'Dark Ambient'),
    ('ambient',                     'Ambient'),
    ('drone',                       'Drone'),
    ('trip hop',                    'Trip Hop'),
    ('trip-hop',                    'Trip Hop'),
    ('triphop',                     'Trip Hop'),
    ('downtempo',                   'Downtempo'),
    ('chillout',                    'Downtempo'),
    ('chill out',                   'Downtempo'),
    # ── IDM / Experimental Electronic ────────────────────────────────────────
    ('idm',                         'IDM'),
    ('intelligent dance music',     'IDM'),
    ('glitch',                      'Glitch'),
    ('electronica',                 'Electronica'),
    # ── UK Bass / Garage ─────────────────────────────────────────────────────
    ('uk garage',                   'UK Garage'),
    ('2-step',                      'UK Garage'),
    ('two step',                    'UK Garage'),
    ('dubstep',                     'Dubstep'),
    ('grime',                       'Grime'),
    ('uk bass',                     'UK Bass'),
    ('bass music',                  'Bass Music'),
    ('garage',                      'UK Garage'),
    # ── Hip Hop ──────────────────────────────────────────────────────────────
    ('instrumental hip hop',        'Instrumental Hip Hop'),
    ('lo-fi hip hop',               'Lo-Fi Hip Hop'),
    ('lo fi hip hop',               'Lo-Fi Hip Hop'),
    ('boom bap',                    'Boom Bap'),
    ('gangsta rap',                 'Hip-Hop'),
    ('trap',                        'Trap'),
    ('hip hop',                     'Hip-Hop'),
    ('hip-hop',                     'Hip-Hop'),
    ('rap',                         'Hip-Hop'),
    ('east coast rap',              'Hip-Hop'),
    ('west coast rap',              'Hip-Hop'),
    # ── Jazz / Soul / Funk ───────────────────────────────────────────────────
    ('acid jazz',                   'Acid Jazz'),
    ('nu jazz',                     'Nu Jazz'),
    ('jazz funk',                   'Jazz Funk'),
    ('soul jazz',                   'Soul Jazz'),
    ('jazz',                        'Jazz'),
    ('neo soul',                    'Neo Soul'),
    ('soul',                        'Soul'),
    ('funk',                        'Funk'),
    ('r&b',                         'R&B'),
    ('rnb',                         'R&B'),
    ('rhythm and blues',            'R&B'),
    # ── Reggae / Dub ─────────────────────────────────────────────────────────
    ('roots reggae',                'Roots Reggae'),
    ('dub',                         'Dub'),
    ('reggae',                      'Reggae'),
    ('dancehall',                   'Dancehall'),
    # ── Rock (for non-electronic albums) ─────────────────────────────────────
    ('post-punk',                   'Post-Punk'),
    ('post punk',                   'Post-Punk'),
    ('indie rock',                  'Indie Rock'),
    ('indie pop',                   'Indie Pop'),
    ('indie',                       'Indie'),
    ('alternative rock',            'Alternative Rock'),
    ('alternative',                 'Alternative Rock'),
    ('folk rock',                   'Folk Rock'),
    ('country rock',                'Country Rock'),
    ('country',                     'Country'),
    ('blues rock',                  'Blues Rock'),
    ('blues',                       'Blues'),
    ('hard rock',                   'Hard Rock'),
    ('heavy metal',                 'Metal'),
    ('metal',                       'Metal'),
    ('rock',                        'Rock'),
    # ── Other ────────────────────────────────────────────────────────────────
    ('footwork',                    'Footwork'),
    ('juke',                        'Footwork'),
    ('afrobeat',                    'Afrobeat'),
    ('world music',                 'World'),
    ('classical',                   'Classical'),
    ('electronic',                  'Electronic'),
]

# Build a fast lookup dict: normalised tag string → canonical label
_TAG_LOOKUP: dict[str, str] = {tag.lower(): label for tag, label in TAG_MAP}


def resolve_from_tags(lastfm_tags: dict, min_weight: int = 30) -> str | None:
    """
    Try to resolve a shelf key directly from Last.fm tags without calling Claude.
    Returns the most specific matching canonical label, or None if no match.

    Strategy:
    1. Combine artist + album tags. Album tags get a small weight boost (×1.2)
       because they're more release-specific.
    2. Filter to tags above min_weight.
    3. Walk TAG_MAP in order (most specific first). For each entry, find the
       best-weighted matching tag. Return the first entry that has a match
       above threshold.
    """
    if not lastfm_tags:
        return None

    # Merge artist and album tags, album tags weighted slightly higher
    merged: dict[str, float] = {}
    for tag, weight in lastfm_tags.get('artist', []):
        key = tag.lower().strip()
        merged[key] = max(merged.get(key, 0), float(weight))
    for tag, weight in lastfm_tags.get('album', []):
        key = tag.lower().strip()
        boosted = float(weight) * 1.2
        merged[key] = max(merged.get(key, 0), boosted)

    # Walk TAG_MAP in order — first match whose weight clears threshold wins.
    # Because more-specific entries come first, specificity beats raw weight.
    for tag_variant, canonical_label in TAG_MAP:
        w = merged.get(tag_variant.lower())
        if w and w >= min_weight:
            return canonical_label

    return None


# ── Last.fm tag lookup ────────────────────────────────────────────────────────

LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/'

def fetch_lastfm_tags(artist: str, title: str, api_key: str) -> dict:
    """
    Fetch Last.fm tags for an artist and album.
    Returns { 'artist': [(tag, weight), ...], 'album': [(tag, weight), ...] }
    Both lists are sorted by weight descending, limited to top 8.
    """
    headers = {'User-Agent': 'CrateApp/1.0'}
    result = {'artist': [], 'album': []}

    # Artist tags — very reliable for genre
    try:
        resp = httpx.get(LASTFM_BASE, params={
            'method': 'artist.getTopTags',
            'artist': artist,
            'api_key': api_key,
            'format': 'json',
            'autocorrect': 1,
        }, headers=headers, timeout=8)
        resp.raise_for_status()
        tags = resp.json().get('toptags', {}).get('tag', [])
        result['artist'] = [
            (t['name'], int(t['count']))
            for t in tags
            if int(t.get('count', 0)) > 5
        ][:8]
        time.sleep(0.2)
    except Exception as e:
        logger.warning(f'Last.fm artist tags failed for {artist}: {e}')

    # Album tags — per-release accuracy
    try:
        resp = httpx.get(LASTFM_BASE, params={
            'method': 'album.getTopTags',
            'artist': artist,
            'album': title,
            'api_key': api_key,
            'format': 'json',
            'autocorrect': 1,
        }, headers=headers, timeout=8)
        resp.raise_for_status()
        tags = resp.json().get('toptags', {}).get('tag', [])
        result['album'] = [
            (t['name'], int(t['count']))
            for t in tags
            if int(t.get('count', 0)) > 5
        ][:8]
        time.sleep(0.2)
    except Exception as e:
        logger.warning(f'Last.fm album tags failed for {artist} — {title}: {e}')

    return result


def _fmt_tags(tags: list) -> str:
    if not tags:
        return '(none found)'
    return ', '.join(f'{name} ({weight})' for name, weight in tags)


# ── Shelf key classification ──────────────────────────────────────────────────

def classify_shelf_key(album: Album, api_key: str,
                        track_titles: list[str] | None = None,
                        existing_keys: list[str] | None = None,
                        lastfm_tags: dict | None = None) -> str | None:
    """
    Ask Claude to assign a single canonical shelf label for this album.
    - track_titles:  all track titles from the DB
    - existing_keys: shelf keys already in use — Claude reuses these
    - lastfm_tags:   {'artist': [(tag, weight),...], 'album': [(tag, weight),...]}
    Returns a clean label like "Atmospheric Drum n Bass" or None on failure.
    """
    # ── Fast path: try direct tag map lookup before calling Claude ───────────
    if lastfm_tags:
        direct = resolve_from_tags(lastfm_tags, min_weight=40)
        if direct:
            logger.info(f'  TAG_MAP hit → "{direct}" (no Claude call)')
            return direct

    discogs_styles = album.enriched_style or ''
    discogs_genre  = album.enriched_genre or album.genre or ''
    tracks_str     = ', '.join(track_titles) if track_titles else '(unknown)'

    # ── Build Last.fm block ──────────────────────────────────────────────────
    lfm_block = ''
    if lastfm_tags:
        artist_tags = lastfm_tags.get('artist', [])
        album_tags  = lastfm_tags.get('album',  [])
        if artist_tags or album_tags:
            lfm_block = f"""
LAST.FM TAGS — crowd-sourced by millions of listeners, HIGH confidence:
  Artist tags: {_fmt_tags(artist_tags)}
  Album tags:  {_fmt_tags(album_tags)}
"""

    # ── Build existing vocabulary block ────────────────────────────────────
    existing_block = ''
    if existing_keys:
        existing_block = f"""
SHELF LABELS ALREADY IN USE — reuse one of these if it fits:
{chr(10).join(f'  - {k}' for k in sorted(existing_keys))}
"""

    prompt = f"""You are organising a serious DJ's record collection into labelled shelf sections.

─── HIGH-CONFIDENCE SOURCES (trust these first) ───────────────────────────
{lfm_block if lfm_block else '  (no Last.fm data available)'}
  Discogs genre:  {discogs_genre}
  Discogs styles: {discogs_styles}

─── SUPPORTING CONTEXT ────────────────────────────────────────────────────
  Title:          {album.title or ''}
  Artist:         {album.artist or ''}
  Label:          {album.enriched_label or album.label or ''}
  Catalog number: {album.enriched_catalog_num or album.catalog_num or ''}
  Year:           {album.enriched_year or album.year or ''}
  Track titles:   {tracks_str}
{existing_block}
─── TASK ───────────────────────────────────────────────────────────────────
Assign ONE shelf label — the subgenre that best describes this record.

Rules:
- Last.fm tags with weight ≥ 50 are near-certain — trust them above everything else.
- Last.fm artist tags are the single most reliable signal. If top artist tag is
  "drum and bass" with weight 80+, the shelf key IS a Drum n Bass subgenre.
- Use Last.fm + Discogs together to narrow from genre → subgenre.
- Artist name clues: "DJ TRAX", "MC", genre words in the name.
- Reuse an existing shelf label if one fits — consistency matters.
- Be specific when confident: "Liquid Drum n Bass" beats "Drum n Bass".
- Broad genre is better than a wrong subgenre.
- 1–4 words, title case.

Reply ONLY with JSON: {{"shelf_key": "Liquid Drum n Bass"}}"""

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
                'max_tokens': 60,
                'temperature': 0,
                'messages': [{'role': 'user', 'content': prompt}]
            },
            timeout=15
        )
        resp.raise_for_status()
        text = resp.json()['content'][0]['text'].strip()
        text = re.sub(r'^```json\s*|\s*```$', '', text, flags=re.MULTILINE).strip()
        key = json.loads(text).get('shelf_key', '').strip()
        return key if key else None
    except Exception as e:
        logger.warning(f'classify_shelf_key failed for {album.artist} — {album.title}: {e}')
        return None


def classify_library_shelf_keys(force: bool = False, progress_callback=None) -> dict:
    """
    Run shelf-key classification for all albums that don't have one yet
    (or all albums if force=True). Opens its own DB session.
    Passes existing shelf keys and track titles to each classification call.
    """
    from .database import SessionLocal, Track

    config       = load_config()
    api_key      = config.get('ai', {}).get('api_key', '')
    lastfm_key   = config.get('enrichment', {}).get('lastfm_api_key', '')
    if not api_key:
        return {'error': 'No AI API key configured', 'total': 0, 'classified': 0, 'failed': 0}

    if lastfm_key:
        logger.info('classify_library_shelf_keys: Last.fm key found — will fetch tags per album')
    else:
        logger.info('classify_library_shelf_keys: no Last.fm key — using metadata only')

    db = SessionLocal()
    try:
        query = db.query(Album).filter(Album.title != None)
        # Never overwrite user-verified placements
        query = query.filter(Album.shelf_key_verified != True)
        if not force:
            query = query.filter(Album.shelf_key == None)
        albums = query.all()

        total      = len(albums)
        classified = 0
        failed     = 0
        logger.info(f'classify_library_shelf_keys: {total} albums to classify')

        # Seed existing keys from albums that are NOT being reclassified
        existing_keys: set[str] = set()
        if not force:
            already_done = db.query(Album.shelf_key).filter(Album.shelf_key != None).all()
            existing_keys = {row[0] for row in already_done if row[0]}

        for i, album in enumerate(albums):
            # Fetch track titles for richer context
            tracks = db.query(Track.title).filter(
                Track.filepath.like(f"{album.folder_path}%"),
                Track.title != None
            ).all()
            track_titles = [t[0] for t in tracks if t[0]]

            # Fetch Last.fm tags if key is configured
            lastfm_tags = None
            if lastfm_key and album.artist:
                lastfm_tags = fetch_lastfm_tags(
                    album.artist,
                    album.title or '',
                    lastfm_key
                )
                if lastfm_tags.get('artist') or lastfm_tags.get('album'):
                    logger.info(
                        f'  Last.fm: artist={_fmt_tags(lastfm_tags["artist"][:3])} '
                        f'album={_fmt_tags(lastfm_tags["album"][:3])}'
                    )

            key = classify_shelf_key(
                album, api_key,
                track_titles=track_titles,
                existing_keys=sorted(existing_keys) if existing_keys else None,
                lastfm_tags=lastfm_tags
            )
            if key:
                album.shelf_key = key
                existing_keys.add(key)
                classified += 1
                logger.info(f'  → "{key}" for {album.artist} — {album.title}')
            else:
                failed += 1

            db.commit()

            if progress_callback:
                progress_callback(i + 1, total, album.title or '')

            # Last.fm + Discogs rate limits — 2 extra calls per album so a little more breathing room
            time.sleep(0.5 if lastfm_key else 0.3)

        logger.info(f'classify_library_shelf_keys: done — classified={classified}, failed={failed}')
        return {'total': total, 'classified': classified, 'failed': failed}
    finally:
        db.close()
