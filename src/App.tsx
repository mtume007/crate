import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAlbums, fetchStats, startScan, fetchScanStatus, fetchTracks, artworkUrl, audioUrl } from './api'
import Settings from './Settings'
import ReviewPanel from './ReviewPanel'
import AddModal from './components/AddModal'
import Onboarding from './components/Onboarding'
import type { DiscogsCandidate } from './components/AlbumMatcher'
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

interface Stats {
  tracks: number
  albums: number
  tagged: number
  untagged: number
}

export default function App() {
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

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const loadLibrary = useCallback(async () => {
    try {
      const [albumData, statsData] = await Promise.all([fetchAlbums(), fetchStats()])
      setAlbums(albumData.albums)
      setStats(statsData)
      setLoaded(true)
    } catch (e) {
      console.error('Failed to load library:', e)
      setLoaded(true)
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
        setShowOnboarding(true)
      }
    }
    checkConfig()
  }, [])

  const handleMatch = useCallback(async (
    albumId: number,
    candidate: DiscogsCandidate | null,
    discogsUrl?: string
  ) => {
    const url = discogsUrl ?? (candidate ? `https://www.discogs.com${candidate.uri}` : null)
    if (!url) return
    await fetch('http://localhost:8000/library/enrich/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album_id: albumId, discogs_url: url })
    })
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
    try { setScanning(true); await startScan(scanPath) }
    catch (e) { console.error('Scan failed:', e); setScanning(false) }
  }

  const handleOnboardingComplete = (path: string) => {
    setLibraryPath(path)
    setShowOnboarding(false)
    handleScan(path)
  }

  const pct = scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0

  const filtered = albums.filter(album => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      album.artist?.toLowerCase().includes(q) ||
      album.title?.toLowerCase().includes(q) ||
      album.label?.toLowerCase().includes(q) ||
      album.catalog_num?.toLowerCase().includes(q) ||
      album.genre?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="app-shell">
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
          {searchQuery.trim()
            ? `${filtered.length} album${filtered.length !== 1 ? 's' : ''}`
            : stats.albums > 0 ? `${stats.albums} albums` : 'Crate'}
        </span>
        {!searchQuery.trim() && stats.tracks > 0 && <><span className="titlebar-sep">·</span><span className="titlebar-count">{stats.tracks.toLocaleString()} tracks</span></>}
      </header>

      <div className="toolbar">
        <div className="view-switcher">
          <button className="vs-btn active" title="Grid"><IconGrid size={12} /></button>
          <button className="vs-btn" title="Coverflow"><IconCoverflow size={12} /></button>
          <button className="vs-btn" title="List"><IconList size={12} /></button>
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
          <button className={`scan-btn ${scanning ? 'scanning' : ''}`} onClick={() => handleScan()} disabled={scanning}>
            {scanning ? `${pct}%${scanProgress.file ? ` — ${scanProgress.file}` : ''}` : albums.length === 0 ? 'Import Library' : 'Rescan'}
          </button>
        </div>
      </div>

      <main className="main-content">
        {activeView === 'library' && <LibraryView albums={filtered} loaded={loaded} scanning={scanning} onScan={() => handleScan()} onAlbumClick={setSelectedAlbum} />}
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
      />

      {selectedAlbum && (
        <AlbumDetail
          album={selectedAlbum}
          onClose={() => setSelectedAlbum(null)}
          onPlayTrack={playTrack}
          onRefresh={loadLibrary}
          onOpenMatcher={(a) => {
            setSelectedAlbum(null)
            setPendingAlbum(a)
          }}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showReview && <ReviewPanel onClose={() => setShowReview(false)} />}
      <AddModal
        album={pendingAlbum}
        onConfirm={handleMatch}
        onSkip={handleSkipMatch}
        onClose={() => setPendingAlbum(null)}
      />
      {showOnboarding && <Onboarding onComplete={handleOnboardingComplete} />}
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

function LibraryView({ albums, loaded, scanning, onScan, onAlbumClick }: { albums: Album[]; loaded: boolean; scanning: boolean; onScan: () => void; onAlbumClick: (a: Album) => void }) {
  if (!loaded) return <div className="placeholder-view"><span className="placeholder-label">Loading...</span></div>
  if (albums.length === 0 && !scanning) {
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
  return (
    <div className="library-grid-wrap">
      <div className="library-grid">
        {albums.map(album => <AlbumCard key={album.id} album={album} onClick={onAlbumClick} />)}
      </div>
    </div>
  )
}

function AlbumCard({ album, onClick }: { album: Album; onClick: (a: Album) => void }) {
  const [imgError, setImgError] = useState(false)
  const url = artworkUrl(album.artwork_url)
  const meta = [album.artist, album.label, album.year].filter(Boolean).join(' · ')

  return (
    <div className="album-card" onClick={() => onClick(album)}>
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
              <input
                type="text"
                className="discogs-url-input"
                placeholder={album.enriched_discogs_url ? 'Paste URL to change release…' : 'Paste Discogs URL to link…'}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const url = (e.target as HTMLInputElement).value.trim()
                    if (!url) return
                    const res = await fetch('http://localhost:8000/library/enrich/url', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ album_id: album.id, discogs_url: url })
                    })
                    const data = await res.json()
                    if (data.success) {
                      onRefresh()
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }
                }}
              />
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

function Playbar({ track, album, isPlaying, progress, volume, onToggle, onPrev, onNext, onSeek, onVolume, stats, scanning, scanPct }: {
  track: Track | null; album: Album | null
  isPlaying: boolean; progress: number; volume: number
  onToggle: () => void; onPrev: () => void; onNext: () => void
  onSeek: (p: number) => void; onVolume: (v: number) => void
  stats: { tracks: number; albums: number; untagged: number }
  scanning: boolean; scanPct: number
}) {
  const artUrl = album ? artworkUrl(album.artwork_url) : null

  if (!track) {
    return (
      <footer className="playbar playbar-empty">
        <span className="playbar-stats">{stats.tracks.toLocaleString()} tracks · {stats.albums} albums</span>
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
