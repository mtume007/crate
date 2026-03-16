# Electron Setup

## One-time install (run this from the crate/ folder)

```bash
npm install
```

This installs Electron and electron-builder (previously Tauri was handling all of this).

## Dev mode (two terminals)

**Terminal 1 — Vite frontend:**
```bash
npm run dev
```

**Terminal 2 — Electron shell (after Vite is ready):**
```bash
npm run electron:dev
```

The Python backend starts automatically inside the Electron process.
No need to run uvicorn manually.

## Build a distributable .dmg

```bash
npm run electron:build
```

Output goes to `dist-electron/`.

## What changed from Tauri

| Before (Tauri) | After (Electron) |
|---|---|
| `src-tauri/` | `electron/` |
| `tauri dev` | `npm run dev` + `npm run electron:dev` |
| `convertFileSrc(path)` | `window.electronAPI.assetUrl(path)` |
| `data-tauri-drag-region` | `titleBarStyle: 'hiddenInset'` (native) |
| Asset protocol via tauri.conf.json | `crate-asset://` protocol in main.ts |
