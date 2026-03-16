"""
Crate deduplication engine.

Three layers:
1. MusicBrainz album ID — definitive same-release identifier
2. Fuzzy matching — same title + overlapping tracks = same release
3. Claude AI — disambiguation for hard cases

Run after every scan. Non-destructive — merges albums in DB,
never touches original files.
"""

import os
import logging
from collections import defaultdict
from rapidfuzz import fuzz
import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


# ── Main entry point ──────────────────────────────────────────────────────────

def deduplicate_library(db, anthropic_api_key: str | None = None) -> dict:
    """
    Run full deduplication pass on the library.
    Returns stats: { merged_mb, merged_fuzzy, merged_ai, skipped }
    """
    from .database import Album, Track

    stats = {"merged_mb": 0, "merged_fuzzy": 0, "merged_ai": 0, "skipped": 0}

    albums = db.query(Album).all()
    logger.info(f"Deduplication: checking {len(albums)} albums")

    # Layer 1 — MusicBrainz ID grouping
    mb_groups = group_by_mb_id(albums)
    for mb_id, group in mb_groups.items():
        if len(group) > 1:
            merge_albums(group, db, reason="mb_id")
            stats["merged_mb"] += len(group) - 1

    # Reload albums after merges
    db.expire_all()
    albums = db.query(Album).all()

    # Layer 2 — Fuzzy title + track matching
    fuzzy_groups = group_by_fuzzy_match(albums, db)
    for group in fuzzy_groups:
        if len(group) > 1:
            merge_albums(group, db, reason="fuzzy")
            stats["merged_fuzzy"] += len(group) - 1

    # Reload again
    db.expire_all()
    albums = db.query(Album).all()

    # Layer 3 — AI disambiguation for remaining near-matches
    if anthropic_api_key:
        ai_groups = find_ai_candidates(albums, db)
        for group in ai_groups:
            if len(group) > 1:
                decision = ask_claude(group, db, anthropic_api_key)
                if decision == "same":
                    merge_albums(group, db, reason="ai")
                    stats["merged_ai"] += len(group) - 1
                else:
                    stats["skipped"] += 1
    else:
        logger.info("No API key — skipping AI deduplication layer")

    db.commit()
    logger.info(f"Deduplication complete: {stats}")
    return stats


# ── Layer 1: MusicBrainz ID ───────────────────────────────────────────────────

def group_by_mb_id(albums) -> dict:
    """Group albums by MusicBrainz album ID. Ignores albums without MB ID."""
    groups = defaultdict(list)
    for album in albums:
        if album.mb_album_id:
            groups[album.mb_album_id].append(album)
    return {k: v for k, v in groups.items() if len(v) > 1}


# ── Layer 2: Fuzzy matching ───────────────────────────────────────────────────

def group_by_fuzzy_match(albums, db) -> list[list]:
    """
    Find albums that are likely the same release based on:
    - Title similarity >= 92%
    - Same artist (or one is Various/Unknown)
    - Year within 1 year of each other (or either is blank)
    - Track listings don't overlap (different tracks = different discs, same album)
    """
    from .database import Track

    groups = []
    used = set()

    for i, a in enumerate(albums):
        if a.id in used:
            continue
        group = [a]
        used.add(a.id)

        for j, b in enumerate(albums):
            if i >= j or b.id in used:
                continue

            if not titles_similar(a.title, b.title):
                continue

            if not artists_compatible(a.artist, b.artist):
                continue

            if not years_compatible(a.year, b.year):
                continue

            # Check track overlap — if tracks overlap it's a true duplicate,
            # if they don't overlap it could be multi-disc
            overlap = tracks_overlap(a, b, db)

            if overlap == "duplicate" or overlap == "complementary":
                group.append(b)
                used.add(b.id)

        if len(group) > 1:
            groups.append(group)

    return groups


def titles_similar(t1: str | None, t2: str | None) -> bool:
    if not t1 or not t2:
        return False
    # Normalise
    n1 = normalise_title(t1)
    n2 = normalise_title(t2)
    return fuzz.ratio(n1, n2) >= 92


def normalise_title(title: str) -> str:
    """Strip common suffixes that cause false negatives."""
    import re
    title = title.lower().strip()
    # Remove trailing parentheticals: (LP), (EP), (2LP), (Remaster), etc.
    title = re.sub(r'\s*\([^)]*\)\s*$', '', title)
    # Remove leading "the ", "a "
    title = re.sub(r'^(the|a)\s+', '', title)
    # Normalise whitespace
    title = re.sub(r'\s+', ' ', title).strip()
    return title


def artists_compatible(a1: str | None, a2: str | None) -> bool:
    """Return True if artists could be the same release."""
    VARIOUS = {"various artists", "various", "v.a.", "va", "unknown", "", None}
    n1 = (a1 or "").lower().strip()
    n2 = (a2 or "").lower().strip()
    # Both various/unknown — compatible
    if n1 in VARIOUS or n2 in VARIOUS:
        return True
    # Exact or near-exact match
    return fuzz.ratio(n1, n2) >= 88


def years_compatible(y1: str | None, y2: str | None) -> bool:
    """Return True if years are within 1 year of each other, or either is blank."""
    if not y1 or not y2:
        return True
    try:
        return abs(int(str(y1)[:4]) - int(str(y2)[:4])) <= 1
    except (ValueError, TypeError):
        return True


def tracks_overlap(a, b, db) -> str:
    """
    Compare track listings.
    Returns: 'duplicate' (same tracks), 'complementary' (different tracks, same album),
             'different' (genuinely different)
    """
    from .database import Track

    tracks_a = set(
        (normalise_title(t.title or ""), t.track_number or "")
        for t in db.query(Track).filter(Track.filepath.like(f"{a.folder_path}%")).all()
    )
    tracks_b = set(
        (normalise_title(t.title or ""), t.track_number or "")
        for t in db.query(Track).filter(Track.filepath.like(f"{b.folder_path}%")).all()
    )

    if not tracks_a or not tracks_b:
        return "complementary"

    intersection = tracks_a & tracks_b
    overlap_ratio = len(intersection) / min(len(tracks_a), len(tracks_b))

    if overlap_ratio >= 0.7:
        return "duplicate"
    elif overlap_ratio < 0.1:
        # No overlap — could be different discs of same album
        # Check if disc numbers differ
        return "complementary"
    else:
        return "different"


# ── Layer 3: Claude AI disambiguation ─────────────────────────────────────────

def find_ai_candidates(albums, db) -> list[list]:
    """
    Find pairs that need AI judgment. Two cases:

    1. Title similarity 75-91% — fuzzy match won't catch these cleanly.
    2. Title similarity >= 92% but year gap > 1 — these are likely reissues that
       Layer 2 rejected on year. In a digital library, same music = merge regardless
       of pressing year, so we send them to Claude for a final call.
    """
    candidates = []
    used = set()

    for i, a in enumerate(albums):
        if a.id in used:
            continue
        for j, b in enumerate(albums):
            if i >= j or b.id in used:
                continue
            if not a.title or not b.title:
                continue
            if not artists_compatible(a.artist, b.artist):
                continue
            n1 = normalise_title(a.title)
            n2 = normalise_title(b.title)
            score = fuzz.ratio(n1, n2)

            is_fuzzy_candidate = 75 <= score < 92
            is_year_suspicious = score >= 92 and not years_compatible(a.year, b.year)

            if is_fuzzy_candidate or is_year_suspicious:
                candidates.append([a, b])
                used.add(a.id)
                used.add(b.id)
                break

    return candidates


def ask_claude(group, db, api_key: str) -> str:
    """
    Ask Claude whether a group of albums are the same release.
    Returns 'same' or 'different'.
    """
    from .database import Track

    descriptions = []
    for album in group:
        tracks = db.query(Track).filter(
            Track.filepath.like(f"{album.folder_path}%")
        ).order_by(Track.track_number).limit(8).all()

        track_list = ", ".join(
            f"{t.track_number or '?'}. {t.title or 'Unknown'}"
            for t in tracks
        )

        descriptions.append(
            f"Album {group.index(album) + 1}:\n"
            f"  Title: {album.title}\n"
            f"  Artist: {album.artist}\n"
            f"  Year: {album.year}\n"
            f"  Label: {album.label}\n"
            f"  Cat#: {album.catalog_num}\n"
            f"  Country: {album.country}\n"
            f"  Tracks: {track_list}\n"
            f"  MB ID: {album.mb_album_id or 'none'}"
        )

    prompt = (
        "You are a music metadata expert helping deduplicate a DJ's record library.\n\n"
        "Are the following albums the same release (including different pressings or editions "
        "that should be grouped together), or genuinely different releases?\n\n"
        + "\n\n".join(descriptions)
        + "\n\nRespond with exactly one word: 'same' or 'different'."
    )

    try:
        response = httpx.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 10,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=15,
        )
        text = response.json()["content"][0]["text"].strip().lower()
        return "same" if "same" in text else "different"
    except Exception as e:
        logger.error(f"Claude API error: {e}")
        return "different"


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge_albums(group: list, db, reason: str):
    """
    Merge a group of duplicate albums into one.
    Keeps the album with the most metadata, updates all tracks to point to it.
    Deletes the rest.
    """
    from .database import Album, Track

    # Score each album by metadata completeness
    def score(a):
        fields = [a.title, a.artist, a.year, a.label, a.catalog_num,
                  a.genre, a.country, a.mb_album_id, a.artwork_path]
        return sum(1 for f in fields if f)

    primary = max(group, key=score)
    duplicates = [a for a in group if a.id != primary.id]

    # Fill any gaps in primary from duplicates
    for dup in duplicates:
        if not primary.artwork_path and dup.artwork_path:
            primary.artwork_path = dup.artwork_path
        if not primary.label and dup.label:
            primary.label = dup.label
        if not primary.catalog_num and dup.catalog_num:
            primary.catalog_num = dup.catalog_num
        if not primary.mb_album_id and dup.mb_album_id:
            primary.mb_album_id = dup.mb_album_id
        if not primary.country and dup.country:
            primary.country = dup.country
        # Add track count
        primary.track_count = (primary.track_count or 0) + (dup.track_count or 0)

    logger.info(
        f"[{reason}] Merging {len(duplicates)} duplicate(s) into '{primary.title}' "
        f"by {primary.artist} ({primary.year})"
    )

    # Delete duplicates (tracks stay — they still point to their files)
    for dup in duplicates:
        db.delete(dup)

    db.flush()
