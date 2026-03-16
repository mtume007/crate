# Crate

A local-first DJ library app for macOS. Built for collectors who care about the details.

---

## What it does

Crate scans your music folder, builds a local library, and lets you browse your collection the way it deserves — full artwork grid, instant search, track-level detail. No cloud sync. No subscriptions. Your files, your database.

**Enrichment** — Crate connects to Discogs to fill in the gaps: original release year, label, genre, catalogue number. Claude normalises the search query, Discogs finds the match, Claude validates it. You can also paste a Discogs URL directly or use the manual matcher.

**Playback** — Click any track to play. Queue follows the album. Progress bar, volume, prev/next.

**Deduplication** — Three-pass dedup: MusicBrainz ID match → fuzzy title match → Claude as tiebreaker.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript (Vite) |
| Backend | FastAPI + SQLAlchemy + SQLite |
| Desktop | Electron 33 |
| AI | Claude (Anthropic API) |
| Enrichment | Discogs API |
| Fonts | Outfit (display) · SF Mono (data) |

---

## Setup

**Requirements:** Node 18+, Python 3.12+, macOS

```bash
git clone https://github.com/mtume007/crate.git
cd crate

# Frontend
npm install

# Python env
cd src-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

Create `~/.crate/config.json`:

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "api_key": "your-anthropic-key"
  },
  "enrichment": {
    "discogs_token": "your-discogs-token",
    "auto_enrich": false,
    "source": "discogs"
  },
  "theme": {
    "accent": "#e8a045",
    "base": "#080808",
    "card": "#0f0f0f",
    "hover": "#161616",
    "border": "#1e1e1e",
    "radius": 8,
    "font": "Outfit"
  },
  "library": {
    "path": "/path/to/your/music"
  }
}
```

```bash
~/crate/start.sh
```

Starts FastAPI on `:8000`, Vite on `:1420`, launches Electron.

---

## Design

HULDRA design system — dark, minimal, no decoration that doesn't earn its place. Amber accent runs through interactive elements. Outfit for titles, SF Mono for data. All values come from config tokens, nothing hardcoded.

---

## Status

Active development. Core library, playback, and Discogs enrichment are working. Sets, Listening, and smart tagging are placeholders.

---

## License

MIT
