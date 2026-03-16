import { useState, useEffect } from 'react'

interface ReviewAlbum {
  id: number
  artist: string
  title: string
  enriched_source: string | null
  enriched_discogs_url: string | null
  enriched_label: string | null
  enriched_year: string | null
}

interface DiscogsCandidate {
  id: number
  title: string
  year: number
  label: string | string[]
  country: string
  format: string[]
  thumb: string
  uri: string
}

export default function ReviewPanel({ onClose }: { onClose: () => void }) {
  const [albums, setAlbums] = useState<ReviewAlbum[]>([])
  const [candidates, setCandidates] = useState<Record<number, DiscogsCandidate[]>>({})
  const [loading, setLoading] = useState<Record<number, boolean>>({})

  useEffect(() => {
    fetch('http://localhost:8000/library/albums?limit=500')
      .then(r => r.json())
      .then(data => {
        const unmatched = (data.albums as ReviewAlbum[]).filter(a =>
          (a.enriched_source == null ||
           a.enriched_source === 'not_found' ||
           a.enriched_source === 'low_confidence') &&
          a.artist && a.title
        )
        setAlbums(unmatched)
      })
      .catch(e => console.error('ReviewPanel fetch failed:', e))
  }, [])

  const searchCandidates = async (album: ReviewAlbum) => {
    if (candidates[album.id] !== undefined || loading[album.id]) return
    setLoading(l => ({ ...l, [album.id]: true }))
    try {
      const res = await fetch(
        `http://localhost:8000/library/enrich/candidates?artist=${encodeURIComponent(album.artist)}&title=${encodeURIComponent(album.title)}`
      )
      const data = await res.json()
      setCandidates(c => ({ ...c, [album.id]: data.results || [] }))
    } catch (e) {
      console.error('Candidates fetch failed:', e)
      setCandidates(c => ({ ...c, [album.id]: [] }))
    } finally {
      setLoading(l => ({ ...l, [album.id]: false }))
    }
  }

  const linkCandidate = async (album: ReviewAlbum, candidate: DiscogsCandidate) => {
    const url = `https://www.discogs.com${candidate.uri}`
    await fetch('http://localhost:8000/library/enrich/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album_id: album.id, discogs_url: url })
    })
    setAlbums(a => a.filter(x => x.id !== album.id))
  }

  const skipAlbum = async (album: ReviewAlbum) => {
    await fetch(`http://localhost:8000/library/enrich/skip/${album.id}`, { method: 'POST' })
    setAlbums(a => a.filter(x => x.id !== album.id))
  }

  const labelText = (label: string | string[] | undefined) => {
    if (!label) return ''
    return Array.isArray(label) ? label[0] : label
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="review-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">Review Unmatched</span>
          <span className="review-count">{albums.length} remaining</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="review-body">
          {albums.length === 0 && (
            <div className="review-empty">All albums matched ✓</div>
          )}

          {albums.map(album => (
            <div key={album.id} className="review-row">
              <div className="review-album-info">
                <div className="review-album-title">{album.title}</div>
                <div className="review-album-artist">{album.artist}</div>
                <div className="review-album-status">{album.enriched_source || 'unmatched'}</div>
              </div>

              <div className="review-actions">
                {candidates[album.id] === undefined && (
                  <button
                    className="review-search-btn"
                    onClick={() => searchCandidates(album)}
                    disabled={loading[album.id]}
                  >
                    {loading[album.id] ? 'Searching…' : 'Find on Discogs'}
                  </button>
                )}

                {candidates[album.id] !== undefined && (
                  <div className="review-candidates">
                    {candidates[album.id].length === 0 && (
                      <span className="review-no-results">No results found</span>
                    )}
                    {candidates[album.id].map(c => (
                      <div key={c.id} className="review-candidate" onClick={() => linkCandidate(album, c)}>
                        {c.thumb && <img src={c.thumb} alt="" className="review-thumb" />}
                        <div className="review-candidate-info">
                          <div className="review-candidate-title">{c.title}</div>
                          <div className="review-candidate-meta">
                            {[c.year, labelText(c.label), c.country].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="review-candidate-select">Select</div>
                      </div>
                    ))}
                  </div>
                )}

                <button className="review-skip-btn" onClick={() => skipAlbum(album)}>
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
