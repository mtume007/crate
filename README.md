# Crate

A local-first music library for collectors and DJs.

Crate scans your music folder, identifies every album using the Discogs database, and presents your collection in a clean, considered interface. It treats your music the way you do — seriously.

---

## What it does

- **Scans** your local music folder and reads file tags
- **Enriches** every album via Discogs — label, pressing, year, format, artwork
- **AI-assisted matching** — Claude normalises messy tags and validates results
- **Review panel** for anything the pipeline isn't confident about
- **Single-album add flow** — drop a folder, pick the pressing, confirm
- Built on **HULDRA** — a purpose-built design system. One font, one accent, nothing generic

---

## Requirements

- macOS (Apple Silicon — arm64)
- Python 3.12
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (free tier works)
- A [Discogs token](https://www.discogs.com/settings/developers) (free)

---

## Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/mtume007/crate.git
cd crate
npm install
cd src-python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

On first launch, Crate will walk you through selecting your music folder and entering your API keys. Everything is saved to `~/.crate/config.json`.

---

## Running in development

```bash
bash start.sh
```

Or in two terminals:

```bash
npm run dev          # Terminal 1 — Vite frontend
npm run electron:dev # Terminal 2 — Electron
```

Backend runs on `localhost:8000`, frontend on `localhost:1420`.

---

## Building

```bash
npm run electron:build
```

Output lands in `dist-electron/` as a `.dmg` for macOS arm64.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI + SQLAlchemy + SQLite |
| Desktop | Electron 33 |
| AI | Claude Sonnet via Anthropic API |
| Data | Discogs API |
| Config | `~/.crate/config.json` |

---

## Status

Early development. Works well for personal use — 208 albums, 2,516 tracks enriched and counting. Not yet packaged for general distribution.

---

## Design

Crate is built on HULDRA — a personal design system. Dark palette, Martian Mono throughout, amber accent on structural labels only. The collection is the protagonist. The UI is the room it lives in.

[Design overview →](https://mtume007.github.io/crate/huldra.html)
