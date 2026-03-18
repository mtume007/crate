const BASE = "http://localhost:8000"

export async function fetchAlbums(skip = 0, limit = 2000) {
  const res = await fetch(`${BASE}/library/albums?skip=${skip}&limit=${limit}`)
  if (!res.ok) throw new Error("Failed to fetch albums")
  return res.json()
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/library/stats`)
  if (!res.ok) throw new Error("Failed to fetch stats")
  return res.json()
}

export async function startScan(folderPath: string) {
  const res = await fetch(`${BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: folderPath }),
  })
  if (!res.ok) throw new Error("Failed to start scan")
  return res.json()
}

export async function fetchScanStatus() {
  const res = await fetch(`${BASE}/scan/status`)
  if (!res.ok) throw new Error("Failed to fetch scan status")
  return res.json()
}

export function artworkUrl(url: string | null): string | null {
  if (!url) return null
  return `${BASE}${url}`
}

export function audioUrl(filePath: string): string {
  return `${BASE}/audio?path=${encodeURIComponent(filePath)}`
}

export async function fetchTracks(folderPath: string) {
  const params = new URLSearchParams({ album_folder: folderPath, limit: '200' })
  const res = await fetch(`${BASE}/library/tracks?${params}`)
  if (!res.ok) throw new Error("Failed to fetch tracks")
  return res.json()
}

export async function fetchAllTracks(limit = 5000) {
  const res = await fetch(`${BASE}/library/tracks?limit=${limit}`)
  if (!res.ok) throw new Error("Failed to fetch all tracks")
  return res.json()
}

export async function fetchConfig() {
  const res = await fetch(`${BASE}/config`)
  if (!res.ok) throw new Error('Failed to fetch config')
  return res.json()
}

export async function updateConfig(updates: object) {
  const res = await fetch(`${BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  if (!res.ok) throw new Error('Failed to update config')
  return res.json()
}

export async function startClassifyShelf(force = false) {
  const res = await fetch(`http://localhost:8000/library/classify-shelf?force=${force}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to start shelf classification')
  return res.json()
}

export async function fetchClassifyStatus() {
  const res = await fetch(`http://localhost:8000/library/classify-shelf/status`)
  if (!res.ok) throw new Error('Failed to fetch classify status')
  return res.json()
}

export async function updateAlbumShelf(albumId: number, shelfKey: string, shelfOrder?: number) {
  const res = await fetch(`http://localhost:8000/library/albums/${albumId}/shelf`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shelf_key: shelfKey, shelf_order: shelfOrder }),
  })
  if (!res.ok) throw new Error('Failed to update album shelf')
  return res.json()
}

export async function renameShelfSection(oldKey: string, newKey: string) {
  const res = await fetch(`http://localhost:8000/library/shelf-section/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_key: oldKey, new_key: newKey }),
  })
  if (!res.ok) throw new Error('Failed to rename shelf section')
  return res.json()
}
