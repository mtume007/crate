import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAlbums, fetchStats, startScan, fetchScanStatus, fetchTracks, fetchAllTracks, artworkUrl, audioUrl } from './api'
import Settings from './Settings'
import ReviewPanel from './ReviewPanel'
import AddModal from './components/AddModal'
import Onboarding from './components/Onboarding'
import type { DiscogsCandidate } from './components/AlbumMatcher'
import { useTheme } from './context/ThemeContext'
import './styles/app.css'

type View = 'library'

interface Album {
  id: number
  title: string
  artist: string
  year: string
  label: string
  catalog_num: string
  genre: string
  country?: string
  track_count: number
  artwork_url: string | null
  folder_path: string
  // Raw enriched fields from Discogs
  enriched_year?: string | null
  enriched_label?: string | null
  enriched_genre?: string | null
  enriched_catalog_num?: string | null
  enriched_country?: string | null
  enriched_style?: string | null
  enriched_format?: string | null
  enriched_discogs_id?: string | null
  enriched_discogs_url?: string | null
  enriched_source?: string | null
}

interface Track {
  id: number
  title: string
  artist: string
  album: string
  track_number: string
  duration: number | null
  bpm: number | null
  key: string | null
  format: string
  bitrate: number | null
  filepath: string
}

// Minimal shape needed for track-title search
interface TrackResult {
  title: string
  filepath: string
}

interface Stats {
  tracks: number
  albums: number
  tagged: number
  untagged: number
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [activeView, setActiveView] = useState<View>('library')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [albums, setAlbums] = useState<Album[]>([])
  const [stats, setStats] = useState<Stats>({ tracks: 0, albums: 0, tagged: 0, untagged: 0 })
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, file: '' })
  const [loaded, setLoaded] = useState(false)
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null)
  const [libraryPath, setLibraryPath] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [trackResults, setTrackResults] = useState<TrackResult[]>([])
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [currentAlbum, setCurrentAlbum] = useState<Album | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [queue, setQueue] = useState<Track[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [pendingAlbum, setPendingAlbum] = useState<{
    albumId: number; artist: string; title: string
    year?: string; format?: string; trackCount?: number
  } | null>(null)
  const [backendError, setBackendError] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'artist' | 'year-desc' | 'year-asc'>('artist')
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'coverflow'>('grid')
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; album?: Album; track?: Track; trackAlbum?: Album
  } | null>(null)
  const [isDroppingFile, setIsDroppingFile] = useState(false)

  const audioRef    = useRef<HTMLAudioElement | null>(null)
  const dragCounter = useRef(0)

  const loadLibrary = useCallback(async () => {
    try {
      const [albumData, statsData] = await Promise.all([fetchAlbums(), fetchStats()])
      setAlbums(albumData.albums)
      setStats(statsData)
      setLoaded(true)
      // Load all tracks once for search — fire and forget, non-blocking
      fetchAllTracks().then(data => setTrackResults(data.tracks)).catch(() => {})
      return albumData.albums as Album[]
    } catch {
      setBackendError(true)
      setLoaded(true)
      return [] as Album[]
    }
  }, [])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  // Check config on mount — show onboarding if library path not set
  useEffect(() => {
    async function checkConfig() {
      try {
        const res = await fetch('http://localhost:8000/config')
        const config = await res.json()
        if (config.library?.path) {
          setLibraryPath(config.library.path)
        } else {
          setShowOnboarding(true)
        }
      } catch {
        setBackendError(true)
      }
    }
    checkConfig()
  }, [])

  const handleMatch = useCallback((
    _albumId: number,
    _candidate: DiscogsCandidate | null,
    _discogsUrl?: string
  ) => {
    // POST already completed inside AlbumMatcher — just close and refresh
    setPendingAlbum(null)
    loadLibrary()
  }, [loadLibrary])

  const handleSkipMatch = useCallback(async (albumId: number) => {
    await fetch(`http://localhost:8000/library/enrich/skip/${albumId}`, { method: 'POST' })
    setPendingAlbum(null)
  }, [])

  const playTrack = (track: Track, trackList: Track[], album: Album) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
    }
    const audio = new Audio(audioUrl(track.filepath))
    audio.volume = volume
    audioRef.current = audio
    audio.play().catch(console.error)
    setIsPlaying(true)
    setCurrentTrack(track)
    setCurrentAlbum(album)
    setQueue(trackList)
    setProgress(0)

    audio.ontimeupdate = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration)
    }
    audio.onended = () => {
      const idx = trackList.findIndex(t => t.id === track.id)
      if (idx < trackList.length - 1) playTrack(trackList[idx + 1], trackList, album)
      else setIsPlaying(false)
    }
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false) }
    else { audioRef.current.play(); setIsPlaying(true) }
  }

  const skipTo = (direction: 'prev' | 'next') => {
    if (!currentTrack || !currentAlbum) return
    const idx = queue.findIndex(t => t.id === currentTrack.id)
    const next = direction === 'next' ? queue[idx + 1] : queue[idx - 1]
    if (next) playTrack(next, queue, currentAlbum)
  }

  const seek = (pct: number) => {
    if (!audioRef.current || !audioRef.current.duration) return
    audioRef.current.currentTime = pct * audioRef.current.duration
    setProgress(pct)
  }

  const changeVolume = (v: number) => {
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
  }

  const removeAlbum = async (albumId: number) => {
    try {
      await fetch(`http://localhost:8000/library/albums/${albumId}`, { method: 'DELETE' })
      if (selectedAlbum?.id === albumId) setSelectedAlbum(null)
      if (currentAlbum?.id === albumId) {
        audioRef.current?.pause()
        setCurrentTrack(null)
        setCurrentAlbum(null)
        setIsPlaying(false)
      }
      await loadLibrary()
    } catch { /* silent */ }
  }

  const showInFinder = (path: string) => {
    ;(window as any).electronAPI?.showInFinder(path)
  }

  const playAlbum = async (album: Album) => {
    try {
      const data = await fetchTracks(album.folder_path)
      if (data.tracks.length > 0) playTrack(data.tracks[0], data.tracks, album)
    } catch { /* silent */ }
  }

  // Called when the user picks a new library folder (Settings or drag & drop)
  const handleLibraryChange = async (newPath: string) => {
    // Stop playback
    audioRef.current?.pause()
    setCurrentTrack(null)
    setCurrentAlbum(null)
    setIsPlaying(false)
    setSelectedAlbum(null)
    // Clear the DB
    try { await fetch('http://localhost:8000/library/clear', { method: 'DELETE' }) } catch { /* silent */ }
    // Update local state + load empty library
    setLibraryPath(newPath)
    await loadLibrary()
    // Start scan with the new path
    handleScan(newPath)
  }

  // Drag-and-drop a folder onto the window
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) setIsDroppingFile(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDroppingFile(false)
  }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDroppingFile(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = (file as any).path
    if (path) handleLibraryChange(path)
  }

  useEffect(() => {
    if (!scanning) return
    const interval = setInterval(async () => {
      try {
        const status = await fetchScanStatus()
        setScanProgress({ current: status.current, total: status.total, file: status.current_file })
        if (!status.running) {
          setScanning(false)
          await loadLibrary()
        }
      } catch (e) { console.error('Scan status error:', e) }
    }, 500)
    return () => clearInterval(interval)
  }, [scanning, loadLibrary])

  const handleScan = async (path?: string) => {
    const scanPath = path || libraryPath
    if (!scanPath) return
    setScanError(null)
    try { setScanning(true); await startScan(scanPath) }
    catch { setScanning(false); setScanError('Scan failed — is the backend running?') }
  }

  const handleOnboardingComplete = (path: string) => {
    setLibraryPath(path)
    setShowOnboarding(false)
    handleScan(path)
  }

  const pct = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0

  const q = searchQuery.trim().toLowerCase()

  const albumMatches = q ? albums.filter(album =>
    album.artist?.toLowerCase().includes(q) ||
    album.title?.toLowerCase().includes(q) ||
    album.label?.toLowerCase().includes(q) ||
    album.catalog_num?.toLowerCase().includes(q) ||
    album.genre?.toLowerCase().includes(q)
  ) : albums

  // Phase 2: if no album matches, search track titles and return their parent albums
  const trackMatchFallback = albumMatches.length === 0 && q.length > 0
  let filtered = albumMatches
  if (trackMatchFallback) {
    // Build folder→album map for O(1) lookups
    const folderMap = new Map(albums.map(a => [a.folder_path, a]))
    const parentFolders = new Set(
      trackResults
        .filter(t => t.title?.toLowerCase().includes(q))
        .map(t => t.filepath.substring(0, t.filepath.lastIndexOf('/')))
    )
    filtered = Array.from(parentFolders)
      .map(f => folderMap.get(f))
      .filter((a): a is Album => a !== undefined)
  }

  // Client-side sort applied after filtering
  const sorted = [...filtered].sort((a, b) => {
    if (sortOrder === 'artist') {
      return (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' })
    }
    const ay = parseInt(a.enriched_year || a.year || '0')
    const by = parseInt(b.enriched_year || b.year || '0')
    return sortOrder === 'year-desc' ? by - ay : ay - by
  })

  return (
    <div
      className="app-shell"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <aside className={`sidebar ${sidebarExpanded ? 'expanded' : ''}`}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}>
        <nav className="nav-items">
          <NavItem id="library" label="Library" active={activeView} icon={<IconGrid />}   onClick={() => setActiveView('library')} />
          <NavItem id="library" label="Review"  active={activeView} icon={<IconTagger />} onClick={() => setShowReview(true)} />
        </nav>
        <div className="nav-divider" />
        <nav className="nav-footer">
          <button className="nav-item" title="Settings" onClick={() => setShowSettings(true)}>
            <span className="nav-icon"><IconSettings /></span>
            {sidebarExpanded && <span className="nav-label">Settings</span>}
          </button>
        </nav>
      </aside>

      <header className="titlebar">
        <span className="titlebar-context">
          {q
            ? `${filtered.length} album${filtered.length !== 1 ? 's' : ''}`
            : stats.albums > 0 ? `${stats.albums} albums` : 'Crate'}
        </span>
        {!q && stats.tracks > 0 && <><span className="titlebar-sep">·</span><span className="titlebar-count">{stats.tracks.toLocaleString()} tracks</span></>}
        {trackMatchFallback && filtered.length > 0 && <><span className="titlebar-sep">·</span><span className="titlebar-count">track match</span></>}
      </header>

      <div className="toolbar">
        <div className="view-switcher">
          <button className={`vs-btn${viewMode === 'grid' ? ' active' : ''}`} title="Grid" onClick={() => setViewMode('grid')}><IconGrid size={12} /></button>
          <button className={`vs-btn${viewMode === 'coverflow' ? ' active' : ''}`} title="Coverflow" onClick={() => setViewMode('coverflow')}><IconCoverflow size={12} /></button>
          <button className={`vs-btn${viewMode === 'list' ? ' active' : ''}`} title="List" onClick={() => setViewMode('list')}><IconList size={12} /></button>
        </div>
        <div className="toolbar-sep" />
        <div className="sort-switcher">
          <button className={`ss-btn ${sortOrder === 'artist' ? 'active' : ''}`} title="Artist A–Z" onClick={() => setSortOrder('artist')}>A–Z</button>
          <button className={`ss-btn ${sortOrder === 'year-desc' ? 'active' : ''}`} title="Year newest first" onClick={() => setSortOrder('year-desc')}>↓YR</button>
          <button className={`ss-btn ${sortOrder === 'year-asc' ? 'active' : ''}`} title="Year oldest first" onClick={() => setSortOrder('year-asc')}>↑YR</button>
        </div>
        <div className="toolbar-sep" />
        <div className="search-bar">
          <IconSearch size={11} />
          <input
            className="search-input"
            placeholder="artist, label, cat#..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')} title="Clear">✕</button>
          )}
        </div>
        <div className="toolbar-right">
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className={`scan-btn ${scanning ? 'scanning' : ''}`} onClick={() => handleScan()} disabled={scanning}>
            {scanning ? `${pct}%${scanProgress.file ? ` — ${scanProgress.file}` : ''}` : albums.length === 0 ? 'Import Library' : 'Rescan'}
          </button>
          {scanError && <span className="scan-error">{scanError}</span>}
        </div>
      </div>

      <main className="main-content">
        {activeView === 'library' && (
          <LibraryView
            albums={sorted} loaded={loaded} scanning={scanning}
            onScan={() => handleScan()} onAlbumClick={setSelectedAlbum}
            onPlayTrack={playTrack} hasLibrary={albums.length > 0}
            searchQuery={q} viewMode={viewMode} onAlbumUpdate={loadLibrary}
            currentAlbum={currentAlbum}
            onAlbumContextMenu={(album, e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, album }) }}
            onTrackContextMenu={(track, trackAlbum, e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, track, trackAlbum }) }}
          />
        )}
      </main>

      <Playbar
        track={currentTrack}
        album={currentAlbum}
        isPlaying={isPlaying}
        progress={progress}
        volume={volume}
        onToggle={togglePlay}
        onPrev={() => skipTo('prev')}
        onNext={() => skipTo('next')}
        onSeek={seek}
        onVolume={changeVolume}
        stats={stats}
        scanning={scanning}
        scanPct={pct}
        filteredCount={q ? filtered.length : undefined}
        isTrackMatch={trackMatchFallback}
      />

      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onPlayTrack={playTrack}
          onRefresh={async () => {
            const fresh = await loadLibrary()
            const updated = fresh.find(a => a.id === selectedAlbum?.id)
            if (updated) setSelectedAlbum(updated)
          }}
          onOpenMatcher={(a) => {
            setSelectedAlbum(null)
            setPendingAlbum(a)
          }}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} onLibraryChange={handleLibraryChange} />}
      {showReview && <ReviewPanel onClose={() => setShowReview(false)} />}
      <AddModal
        album={pendingAlbum}
        onConfirm={handleMatch}
        onSkip={handleSkipMatch}
        onClose={() => setPendingAlbum(null)}
        onOpenSettings={() => { setPendingAlbum(null); setShowSettings(true) }}
      />
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}

      {isDroppingFile && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">
            <div className="drop-overlay-icon">⊕</div>
            <div className="drop-overlay-label">Drop folder to import</div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          album={contextMenu.album} track={contextMenu.track} trackAlbum={contextMenu.trackAlbum}
          onClose={() => setContextMenu(null)}
          onShowInFinder={showInFinder}
          onRemove={removeAlbum}
          onPlayAlbum={playAlbum}
        />
      )}

      {backendError && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(8,8,8,0.97)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '10px', fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.01em' }}>
            Can't connect to backend
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
            Make sure the Crate server is running on localhost:8000
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '10px', padding: '6px 18px',
              background: 'none', border: '1px solid rgba(255,255,255,0.18)',
              color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-mono)',
              fontSize: '11px', cursor: 'pointer', borderRadius: '2px',
              letterSpacing: '0.04em',
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

function NavItem({ id, label, active, icon, onClick }: { id: View; label: string; active: View; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button className={`nav-item ${active === id ? 'active' : ''}`} onClick={onClick} title={label}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  )
}

function LibraryView({ albums, loaded, scanning, onScan, onAlbumClick, onPlayTrack, hasLibrary, searchQuery, viewMode, onAlbumUpdate, currentAlbum, onAlbumContextMenu, onTrackContextMenu }: {
  albums: Album[]; loaded: boolean; scanning: boolean; onScan: () => void; onAlbumClick: (a: Album) => void
  onPlayTrack: (track: Track, list: Track[], album: Album) => void
  hasLibrary: boolean; searchQuery: string; viewMode: 'grid' | 'list' | 'coverflow'
  onAlbumUpdate: () => void; currentAlbum: Album | null
  onAlbumContextMenu: (album: Album, e: React.MouseEvent) => void
  onTrackContextMenu: (track: Track, album: Album, e: React.MouseEvent) => void
}) {
  if (!loaded) return <div className="placeholder-view"><span className="placeholder-label">Loading...</span></div>
  if (albums.length === 0 && !scanning) {
    if (hasLibrary && searchQuery) {
      return (
        <div className="placeholder-view">
          <div className="import-prompt">
            <div className="import-title">No results for "{searchQuery}"</div>
          </div>
        </div>
      )
    }
    return (
      <div className="placeholder-view">
        <div className="import-prompt">
          <div className="import-title">No library yet</div>
          <div className="import-sub">Click to scan your music folder</div>
          <button className="import-btn" onClick={onScan}>Import Library</button>
        </div>
      </div>
    )
  }
  if (viewMode === 'list') return <ListView albums={albums} onAlbumClick={onAlbumClick} onAlbumUpdate={onAlbumUpdate} currentAlbumId={currentAlbum?.id ?? null} onAlbumContextMenu={onAlbumContextMenu} />
  if (viewMode === 'coverflow') return <CoverflowView albums={albums} onPlayTrack={onPlayTrack} currentAlbumId={currentAlbum?.id ?? null} onAlbumContextMenu={onAlbumContextMenu} onTrackContextMenu={onTrackContextMenu} />
  return (
    <div className="library-grid-wrap">
      <div className="library-grid">
        {albums.map(album => <AlbumCard key={album.id} album={album} onClick={onAlbumClick} isPlaying={album.id === currentAlbum?.id} onContextMenu={e => onAlbumContextMenu(album, e)} />)}
      </div>
    </div>
  )
}

function AlbumCard({ album, onClick, isPlaying, onContextMenu }: { album: Album; onClick: (a: Album) => void; isPlaying?: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  const [imgError, setImgError] = useState(false)
  const url = artworkUrl(album.artwork_url)
  const meta = [album.artist, album.label, album.year].filter(Boolean).join(' · ')

  return (
    <div className={`album-card${isPlaying ? ' album-card--playing' : ''}`} onClick={() => onClick(album)} onContextMenu={onContextMenu}>
      <div className="album-art">
        {url && !imgError
          ? <img src={url} alt={album.title} onError={() => setImgError(true)} />
          : <ArtworkPlaceholder title={album.title} />}
        <div className="album-frosted">
          <div className="album-frosted-title">{album.title || 'Unknown'}</div>
          <div className="album-frosted-meta">{meta}</div>
        </div>
      </div>
    </div>
  )
}

// ── List View ───────────────────────────────────────────────────────────────

function ListView({ albums, onAlbumClick, onAlbumUpdate, currentAlbumId, onAlbumContextMenu }: {
  albums: Album[]; onAlbumClick: (a: Album) => void; onAlbumUpdate: () => void; currentAlbumId: number | null
  onAlbumContextMenu: (album: Album, e: React.MouseEvent) => void
}) {
  return (
    <div className="list-view-wrap">
      <div className="list-header">
        <span />
        <span className="lh-cell">Artist</span>
        <span className="lh-cell">Title</span>
        <span className="lh-cell">Year</span>
        <span className="lh-cell">Label</span>
        <span className="lh-cell">Genre / Tags</span>
        <span className="lh-cell">Tracks</span>
        <span />
      </div>
      {albums.map(album => (
        <ListRow key={album.id} album={album} onClick={onAlbumClick} onUpdate={onAlbumUpdate} isPlaying={album.id === currentAlbumId} onContextMenu={e => onAlbumContextMenu(album, e)} />
      ))}
    </div>
  )
}

// Chip input: comma-separated string ↔ visual pill chips
function ChipInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tags    = value ? value.split(',').map(t => t.trim()).filter(Boolean) : []
  const [input, setInput] = useState('')

  const addTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, '')
    if (!trimmed) return
    const next = [...tags, trimmed]
    onChange(next.join(', '))
    setInput('')
  }

  const removeTag = (i: number) => {
    const next = tags.filter((_, idx) => idx !== i)
    onChange(next.join(', '))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input) }
    if (e.key === 'Backspace' && input === '' && tags.length > 0) removeTag(tags.length - 1)
  }

  return (
    <div className="chip-input" onClick={e => e.stopPropagation()}>
      {tags.map((tag, i) => (
        <span key={i} className="chip-tag">
          {tag}
          <button className="chip-remove" onClick={() => removeTag(i)} tabIndex={-1}>×</button>
        </span>
      ))}
      <input
        className="chip-text-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (input) addTag(input) }}
        placeholder={tags.length === 0 ? 'Add tag…' : ''}
      />
    </div>
  )
}

function ListRow({ album, onClick, onUpdate, isPlaying, onContextMenu }: {
  album: Album; onClick: (a: Album) => void; onUpdate: () => void; isPlaying?: boolean; onContextMenu?: (e: React.MouseEvent) => void
}) {
  const [imgError, setImgError] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)

  // Editable field state — initialise from album
  const [year,  setYear]  = useState(album.enriched_year  || album.year  || '')
  const [label, setLabel] = useState(album.enriched_label || album.label || '')
  const [genre, setGenre] = useState(album.enriched_genre || album.genre || '')

  // Keep local state fresh if album prop changes
  useEffect(() => {
    setYear (album.enriched_year  || album.year  || '')
    setLabel(album.enriched_label || album.label || '')
    setGenre(album.enriched_genre || album.genre || '')
  }, [album.id, album.enriched_year, album.year, album.enriched_label, album.label, album.enriched_genre, album.genre])

  const url = artworkUrl(album.artwork_url)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
  }

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Revert
    setYear (album.enriched_year  || album.year  || '')
    setLabel(album.enriched_label || album.label || '')
    setGenre(album.enriched_genre || album.genre || '')
    setEditing(false)
  }

  const saveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSaving(true)
    try {
      await fetch(`http://localhost:8000/library/albums/${album.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, label, genre }),
      })
      await onUpdate()
    } catch { /* silent — optimistic UI already shows new values */ }
    setSaving(false)
    setEditing(false)
  }

  return (
    <div
      className={`list-row${editing ? ' list-row--editing' : ''}${isPlaying && !editing ? ' list-row--playing' : ''}`}
      onClick={() => { if (!editing) onClick(album) }}
      onContextMenu={onContextMenu}
    >
      <div className="lr-thumb">
        {url && !imgError
          ? <img src={url} alt="" onError={() => setImgError(true)} />
          : <ArtworkPlaceholder title={album.title} />}
      </div>
      <span className="lr-artist">{album.artist || '—'}</span>
      <span className="lr-title">{album.title || '—'}</span>

      {editing ? (
        <input
          className="lr-edit-input"
          value={year} onChange={e => setYear(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="Year"
        />
      ) : (
        <span className="lr-year">{album.enriched_year || album.year || '—'}</span>
      )}

      {editing ? (
        <input
          className="lr-edit-input"
          value={label} onChange={e => setLabel(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder="Label"
        />
      ) : (
        <span className="lr-label">{album.enriched_label || album.label || '—'}</span>
      )}

      {editing ? (
        <ChipInput value={genre} onChange={setGenre} />
      ) : (
        <div className="lr-genre-chips">
          {(album.enriched_genre || album.genre || '').split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
            <span key={i} className="lr-chip">{t}</span>
          ))}
          {!(album.enriched_genre || album.genre) && <span className="lr-genre">—</span>}
        </div>
      )}

      <span className="lr-tracks">{album.track_count != null ? String(album.track_count) : '—'}</span>

      <div className="lr-actions" onClick={e => e.stopPropagation()}>
        {editing ? (
          <>
            <button className="lr-action-btn lr-save" onClick={saveEdit} disabled={saving} title="Save">
              {saving ? '…' : '✓'}
            </button>
            <button className="lr-action-btn lr-cancel" onClick={cancelEdit} title="Cancel">✕</button>
          </>
        ) : (
          <button className="lr-action-btn lr-edit" onClick={startEdit} title="Edit tags">✎</button>
        )}
      </div>
    </div>
  )
}

// ── Coverflow View ──────────────────────────────────────────────────────────

const CF_CARD  = 280  // base card size (px)
const CF_STEP  = 200  // horizontal distance between card centres (px)
const CF_SCALE = [1, 0.714, 0.5, 0.357, 0.25] as const
const CF_OPAC  = [1, 0.60,  0.35, 0.18, 0.08] as const

// Linearly interpolate between lookup-table values at a fractional distance
function interpAt(vals: readonly number[], t: number): number {
  if (t <= 0) return vals[0]
  if (t >= vals.length - 1) return vals[vals.length - 1]
  const lo = Math.floor(t)
  return vals[lo] + (vals[lo + 1] - vals[lo]) * (t - lo)
}

function CoverflowView({ albums, onPlayTrack, currentAlbumId, onAlbumContextMenu, onTrackContextMenu }: {
  albums: Album[]
  onPlayTrack: (track: Track, list: Track[], album: Album) => void
  currentAlbumId: number | null
  onAlbumContextMenu?: (album: Album, e: React.MouseEvent) => void
  onTrackContextMenu?: (track: Track, album: Album, e: React.MouseEvent) => void
}) {
  const [activeIdx, setActiveIdx]   = useState(0)
  const [trackIdx,  setTrackIdx]    = useState(-1)   // -1 = no track focused
  const [tracks, setTracks]         = useState<Track[]>([])
  const [tracksLoading, setTracksLoading] = useState(false)
  const tracklistRef = useRef<HTMLDivElement>(null)

  // Drag state
  const [dragOffsetPx, setDragOffsetPx] = useState(0)
  const [isDragging, setIsDragging]     = useState(false)
  const dragRef    = useRef<{ startX: number; lastX: number; lastTime: number; velocity: number } | null>(null)
  const didDragRef = useRef(false)

  const safeIdx     = albums.length > 0 ? Math.min(Math.max(activeIdx, 0), albums.length - 1) : 0
  const activeAlbum = albums[safeIdx]
  const activeId    = activeAlbum?.id ?? -1

  // Auto-centre on the currently playing album when it changes or when view mounts
  useEffect(() => {
    if (currentAlbumId == null) return
    const idx = albums.findIndex(a => a.id === currentAlbumId)
    if (idx !== -1) setActiveIdx(idx)
  }, [currentAlbumId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset track focus when album changes
  useEffect(() => { setTrackIdx(-1) }, [activeId])

  // Fetch tracks whenever the centred album changes
  useEffect(() => {
    if (!activeAlbum) return
    setTracksLoading(true)
    setTracks([])
    fetchTracks(activeAlbum.folder_path)
      .then(data => { setTracks(data.tracks); setTracksLoading(false) })
      .catch(() => setTracksLoading(false))
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll focused track row into view
  useEffect(() => {
    if (trackIdx < 0 || !tracklistRef.current) return
    const row = tracklistRef.current.children[trackIdx] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [trackIdx])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setActiveIdx(i => Math.min(albums.length - 1, i + 1))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setTrackIdx(i => {
          if (tracks.length === 0) return -1
          return Math.min(tracks.length - 1, i + 1)
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setTrackIdx(i => {
          if (i <= 0) return -1   // back to album strip focus
          return i - 1
        })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (trackIdx >= 0 && tracks[trackIdx] && activeAlbum) {
          onPlayTrack(tracks[trackIdx], tracks, activeAlbum)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [albums.length, tracks, trackIdx, activeAlbum, onPlayTrack])

  // Pointer drag handlers
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    didDragRef.current = false
    dragRef.current = { startX: e.clientX, lastX: e.clientX, lastTime: Date.now(), velocity: 0 }
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const now = Date.now()
    const dt  = now - dragRef.current.lastTime
    if (dt > 0) dragRef.current.velocity = (e.clientX - dragRef.current.lastX) / dt
    dragRef.current.lastX    = e.clientX
    dragRef.current.lastTime = now
    const delta = e.clientX - dragRef.current.startX
    if (Math.abs(delta) > 5) didDragRef.current = true
    setDragOffsetPx(delta)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const rawOffset   = e.clientX - dragRef.current.startX
    const velocity    = dragRef.current.velocity        // px/ms
    const projected   = rawOffset + velocity * 280      // coast ~280ms worth
    const stepsToMove = -Math.round(projected / CF_STEP)
    setActiveIdx(i => Math.min(albums.length - 1, Math.max(0, i + stepsToMove)))
    setDragOffsetPx(0)
    setIsDragging(false)
    dragRef.current = null
    setTimeout(() => { didDragRef.current = false }, 50)
  }

  return (
    <div className="coverflow-wrap">

      {/* Artwork stage */}
      <div
        className="coverflow-stage"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {(() => {
          // Fractional visual centre — cards scale/fade continuously during drag
          const floatIdx = isDragging ? safeIdx - dragOffsetPx / CF_STEP : safeIdx
          return albums.map((album, idx) => {
          const floatDist = idx - floatIdx
          const absFrac   = Math.abs(floatDist)
          if (absFrac > 4) return null
          const scale   = interpAt(CF_SCALE, absFrac)
          const opacity = interpAt(CF_OPAC,  absFrac)
          const offsetX = floatDist * CF_STEP
          const isActive = idx === safeIdx
          const url = artworkUrl(album.artwork_url)
          return (
            <div
              key={album.id}
              className={`coverflow-card${isActive ? ' coverflow-card--active' : ''}`}
              style={{
                width: `${CF_CARD}px`, height: `${CF_CARD}px`,
                transform: `translateX(calc(-50% + ${offsetX}px)) translateY(-50%) scale(${scale})`,
                opacity,
                zIndex: Math.round(10 - absFrac),
                transition: isDragging ? 'none' : 'transform 0.38s cubic-bezier(0.34,1.56,0.64,1), opacity 0.22s ease',
              }}
              onClick={() => { if (!didDragRef.current && !isActive) setActiveIdx(idx) }}
              onContextMenu={e => { if (!didDragRef.current) onAlbumContextMenu?.(album, e) }}
            >
              {url
                ? <img src={url} alt={album.title} className="cf-art" draggable={false} />
                : <ArtworkPlaceholder title={album.title} />}
              {/* Reflection */}
              <div className="cf-reflection" aria-hidden>
                {url
                  ? <img src={url} alt="" className="cf-art" draggable={false} />
                  : <ArtworkPlaceholder title={album.title} />}
              </div>
            </div>
          )
        })
        })()}
        {/* Edge vignettes */}
        <div className="cf-vignette cf-vignette--left"  aria-hidden />
        <div className="cf-vignette cf-vignette--right" aria-hidden />
      </div>

      {/* Album info + tracklist */}
      {activeAlbum && (
        <div className="coverflow-info">
          <div className="cf-meta">
            <div className="cf-album-title">{activeAlbum.title || 'Unknown Album'}</div>
            <div className="cf-album-artist">{(activeAlbum.artist || 'Unknown').toUpperCase()}</div>
            <div className="cf-chips">
              {(activeAlbum.enriched_year || activeAlbum.year) && (
                <span className="cf-chip">{activeAlbum.enriched_year || activeAlbum.year}</span>
              )}
              {(activeAlbum.enriched_label || activeAlbum.label) && (
                <span className="cf-chip">{activeAlbum.enriched_label || activeAlbum.label}</span>
              )}
              {(activeAlbum.enriched_genre || activeAlbum.genre) && (
                <span className="cf-chip">{activeAlbum.enriched_genre || activeAlbum.genre}</span>
              )}
            </div>
          </div>
          <div className="cf-tracklist" ref={tracklistRef}>
            {tracksLoading && <div className="cf-loading">Loading…</div>}
            {!tracksLoading && tracks.map((track, i) => (
              <div
                key={track.id}
                className={`cf-track${i === trackIdx ? ' cf-track--focused' : ''}`}
                onClick={() => { setTrackIdx(i); onPlayTrack(track, tracks, activeAlbum) }}
                onMouseEnter={() => setTrackIdx(i)}
                onMouseLeave={() => setTrackIdx(-1)}
                onContextMenu={e => onTrackContextMenu?.(track, activeAlbum, e)}
              >
                <span className="cf-track-num">
                  {track.track_number ? track.track_number.split('/')[0].padStart(2, ' ') : String(i + 1).padStart(2, ' ')}
                </span>
                <span className="cf-track-title">{track.title || 'Unknown'}</span>
                {track.duration != null && (
                  <span className="cf-track-dur">{formatDuration(track.duration)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ArtworkPlaceholder({ title }: { title: string }) {
  let hash = 0
  for (let i = 0; i < (title || '').length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash)
  const color = `hsl(${Math.abs(hash) % 360}, 8%, 12%)`
  return (
    <div className="artwork-placeholder" style={{ background: color }}>
      <span className="artwork-initials">{(title || '?').charAt(0).toUpperCase()}</span>
    </div>
  )
}

// ── Context Menu ─────────────────────────────────────────────────────────────

function ContextMenu({ x, y, album, track, trackAlbum: _trackAlbum, onClose, onShowInFinder, onRemove, onPlayAlbum }: {
  x: number; y: number
  album?: Album; track?: Track; trackAlbum?: Album
  onClose: () => void
  onShowInFinder: (path: string) => void
  onRemove: (albumId: number) => void
  onPlayAlbum: (album: Album) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    // Use capture phase so it fires before any onClick handlers that might open a new menu
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Clamp to viewport so menu doesn't overflow
  const MENU_W = 200
  const MENU_H = album ? 112 : 72
  const cx = Math.min(x, window.innerWidth  - MENU_W - 8)
  const cy = Math.min(y, window.innerHeight - MENU_H - 8)

  const isAlbumMenu = !!album
  const targetPath = album ? album.folder_path : (track?.filepath ?? '')
  const targetLabel = album ? (album.title || 'Album') : (track?.title || 'Track')

  const handleShowInFinder = () => { onShowInFinder(targetPath); onClose() }
  const handlePlay = () => {
    if (album) { onPlayAlbum(album); onClose() }
    // Track play is handled via click — context menu just shows in finder / remove
  }
  const handleRemove = () => {
    if (album) { onRemove(album.id); onClose() }
  }

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: cx, top: cy }}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="ctx-label">{targetLabel}</div>
      <div className="ctx-sep" />
      <button className="ctx-item" onClick={handleShowInFinder}>
        Show in Finder
      </button>
      {isAlbumMenu && (
        <button className="ctx-item" onClick={handlePlay}>
          Play
        </button>
      )}
      {isAlbumMenu && (
        <>
          <div className="ctx-sep" />
          <button className="ctx-item ctx-item--danger" onClick={handleRemove}>
            Remove from Library
          </button>
        </>
      )}
    </div>
  )
}

function IconGrid({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="6" height="6" /><rect x="9" y="1" width="6" height="6" /><rect x="1" y="9" width="6" height="6" /><rect x="9" y="9" width="6" height="6" /></svg>
}
function IconTagger({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="8" cy="8" r="3" /><path d="M8 2v2M8 12v2M2 8h2M12 8h2" opacity="0.5" /></svg>
}
function IconSettings({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" /></svg>
}
function IconCoverflow({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="5" y="2" width="6" height="12" /><rect x="1" y="3.5" width="4" height="9" opacity="0.5" /><rect x="11" y="3.5" width="4" height="9" opacity="0.5" /></svg>
}
function IconList({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
}
function IconSearch({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="6.5" cy="6.5" r="4.5" /><path d="M10.5 10.5l3.5 3.5" /></svg>
}

// ── Album Detail Panel ─────────────────────────────────────────────────────

function AlbumDetail({ album, onClose, onPlayTrack, onRefresh, onOpenMatcher }: {
  album: Album
  onClose: () => void
  onPlayTrack: (track: Track, list: Track[], album: Album) => void
  onRefresh: () => void
  onOpenMatcher: (a: { albumId: number; artist: string; title: string; year?: string; trackCount?: number }) => void
}) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [urlInput, setUrlInput] = useState('')
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const url = artworkUrl(album.artwork_url)

  useEffect(() => {
    setLoading(true)
    fetchTracks(album.folder_path)
      .then(data => { setTracks(data.tracks); setLoading(false) })
      .catch(() => setLoading(false))
  }, [album.id])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const hasBpm = tracks.some(t => t.bpm)
  const hasKey = tracks.some(t => t.key)

  return (
    <div className="detail-overlay">
      <div className="detail-backdrop" onClick={onClose} />
      <div className="detail-panel">

        <div className="detail-header">
          <div className="detail-artwork">
            {url
              ? <img src={url} alt={album.title} />
              : <ArtworkPlaceholder title={album.title} />}
          </div>
          <div className="detail-meta">
            <div className="detail-meta-top">
              <div className="detail-title">{album.title || 'Unknown Album'}</div>
              <div className="detail-artist">{(album.artist || 'Unknown').toUpperCase()}</div>
            </div>
            <div className="detail-fields">
              {[
                { label: 'YEAR',   value: album.enriched_year   || album.year   || '—' },
                { label: 'LABEL',  value: album.enriched_label  || album.label  || '—' },
                { label: 'GENRE',  value: album.enriched_genre  || album.genre  || '—' },
                { label: 'TRACKS', value: album.track_count != null ? String(album.track_count) : (tracks.length > 0 ? String(tracks.length) : '—') },
              ].map(f => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </div>

            <div className="detail-discogs-row">
              {album.enriched_discogs_url ? (
                <a
                  href={album.enriched_discogs_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="discogs-link"
                  title="View on Discogs"
                >
                  <span className="discogs-link-icon">↗</span>
                  <span>Discogs</span>
                </a>
              ) : (
                <button
                  className="discogs-find-btn"
                  onClick={() => onOpenMatcher({
                    albumId: album.id,
                    artist: album.artist,
                    title: album.title,
                    year: album.year || undefined,
                    trackCount: album.track_count ?? undefined,
                  })}
                >
                  Find on Discogs
                </button>
              )}
              <div className="discogs-url-wrap">
                <input
                  type="text"
                  className={`discogs-url-input${urlLoading ? ' discogs-url-input--loading' : ''}`}
                  placeholder={album.enriched_discogs_url ? 'Paste URL to change release…' : 'Paste Discogs URL to link…'}
                  value={urlInput}
                  disabled={urlLoading}
                  onChange={e => { setUrlInput(e.target.value); setUrlError(null) }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const val = urlInput.trim()
                      if (!val) return
                      setUrlLoading(true)
                      setUrlError(null)
                      try {
                        const res = await fetch('http://localhost:8000/library/enrich/url', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ album_id: album.id, url: val })
                        })
                        const data = await res.json()
                        if (data.success) {
                          onRefresh()
                          setUrlInput('')
                        } else {
                          setUrlError(data.error || 'Failed to link release')
                        }
                      } catch {
                        setUrlError('Request failed — is the server running?')
                      } finally {
                        setUrlLoading(false)
                      }
                    }
                  }}
                />
                {urlInput && !urlLoading && <span className="discogs-url-hint">↵</span>}
              </div>
              {urlError && <p className="discogs-url-error">{urlError}</p>}
            </div>
          </div>
          <button className="detail-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {!loading && tracks.length > 0 && (
          <div className="track-headers">
            <span className="th-num">#</span>
            <span className="th-title">Title</span>
            {hasBpm && <span className="th-bpm">BPM</span>}
            {hasKey && <span className="th-key">Key</span>}
            <span className="th-dur">Time</span>
          </div>
        )}

        {loading
          ? <div className="detail-loading">Loading tracks...</div>
          : (
            <div className="detail-tracks">
              {tracks.map(track => (
                <TrackRow key={track.id} track={track} hasBpm={hasBpm} hasKey={hasKey}
                  albumArtist={album.artist} onPlay={() => onPlayTrack(track, tracks, album)} />
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-field">
      <span className="detail-field-label">{label}</span>
      <span className="detail-field-value">{value}</span>
    </div>
  )
}

function TrackRow({ track, hasBpm, hasKey, albumArtist, onPlay }: {
  track: Track; hasBpm: boolean; hasKey: boolean; albumArtist?: string; onPlay: () => void
}) {
  const dur = track.duration != null ? formatDuration(track.duration) : ''
  const bpm = track.bpm ? String(Math.round(track.bpm)) : ''
  const num = track.track_number ? track.track_number.split('/')[0].padStart(2, ' ') : '—'

  return (
    <div className="track-row" onClick={onPlay}>
      <span className="track-num">{num}</span>
      <div className="track-title-wrap">
        <div className="track-title">{track.title || 'Unknown'}</div>
        {track.artist && track.artist.toLowerCase() !== albumArtist?.toLowerCase() && (
          <div className="track-sub">{track.artist.toUpperCase()}</div>
        )}
      </div>
      {hasBpm && <span className="track-bpm">{bpm}</span>}
      {hasKey && <span className="track-key">{track.key || ''}</span>}
      <span className="track-dur">{dur}</span>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Playbar ────────────────────────────────────────────────────────────────

function Playbar({ track, album, isPlaying, progress, volume, onToggle, onPrev, onNext, onSeek, onVolume, stats, scanning, scanPct, filteredCount, isTrackMatch }: {
  track: Track | null; album: Album | null
  isPlaying: boolean; progress: number; volume: number
  onToggle: () => void; onPrev: () => void; onNext: () => void
  onSeek: (p: number) => void; onVolume: (v: number) => void
  stats: { tracks: number; albums: number; untagged: number }
  scanning: boolean; scanPct: number
  filteredCount?: number; isTrackMatch?: boolean
}) {
  const artUrl = album ? artworkUrl(album.artwork_url) : null

  if (!track) {
    const statsLabel = filteredCount !== undefined
      ? `${filteredCount} album${filteredCount !== 1 ? 's' : ''}${isTrackMatch ? ' · track match' : ''}`
      : stats.tracks > 0
        ? `${stats.tracks.toLocaleString()} tracks · ${stats.albums} albums`
        : null
    return (
      <footer className="playbar playbar-empty">
        {statsLabel && <span className="playbar-stats">{statsLabel}</span>}
        {scanning && <span className="playbar-scanning">Scanning {scanPct}%</span>}
      </footer>
    )
  }

  return (
    <footer className="playbar">
      <div className="playbar-left">
        <div className="playbar-art">
          {artUrl
            ? <img src={artUrl} alt={track.album || ''} />
            : <div className="playbar-art-placeholder" />}
        </div>
        <div className="playbar-info">
          <div className="playbar-title">{track.title || 'Unknown'}</div>
          <div className="playbar-artist">{[track.artist, track.album].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <div className="playbar-centre">
        <div className="playbar-controls">
          <button className="pb-btn" onClick={onPrev} title="Previous">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 2h1.5v8H2zM10 2L4.5 6 10 10z"/></svg>
          </button>
          <button className="pb-btn pb-play" onClick={onToggle} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="4" height="12"/><rect x="8" y="1" width="4" height="12"/></svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1l10 6-10 6z"/></svg>}
          </button>
          <button className="pb-btn" onClick={onNext} title="Next">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M10 2h-1.5v8H10zM2 2l5.5 4L2 10z"/></svg>
          </button>
        </div>
        <div className="playbar-progress" onClick={e => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          onSeek((e.clientX - rect.left) / rect.width)
        }}>
          <div className="playbar-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="playbar-right">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" style={{ color: 'rgba(var(--ink),0.22)', flexShrink: 0 }}>
          <path d="M1 3.5h2l3-2.5v9l-3-2.5H1zM7 3.5a2.5 2.5 0 010 4M8.5 2a5 5 0 010 7"/>
        </svg>
        <input
          type="range" min="0" max="1" step="0.01"
          value={volume}
          onChange={e => onVolume(parseFloat(e.target.value))}
          className="playbar-volume"
        />
      </div>
    </footer>
  )
}
