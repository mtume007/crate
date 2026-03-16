import { useState, useEffect } from 'react'

export interface DiscogsCandidate {
  id: number
  title: string
  year?: number
  label?: string | string[]
  format?: string | string[]
  country?: string
  thumb?: string
  uri: string
}

interface AlbumMatcherProps {
  artist: string
  title: string
  year?: string
  format?: string
  trackCount?: number
  onConfirm: (candidate: DiscogsCandidate | null, discogsUrl?: string) => void
  onSkip?: () => void
}

export default function AlbumMatcher({
  artist,
  title,
  year,
  format,
  trackCount,
  onConfirm,
  onSkip,
}: AlbumMatcherProps) {
  const [candidates, setCandidates] = useState<DiscogsCandidate[]>([])
  const [selected, setSelected] = useState<number | 'none' | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [searching, setSearching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSearching(true)
    setSelected(null)
    setCandidates([])
    setError(null)

    fetch('http://localhost:8000/enrich/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist, title, year }),
    })
      .then(r => r.json())
      .then(data => {
        setCandidates(data.candidates ?? [])
        setSearching(false)
      })
      .catch(() => {
        setError('Search failed')
        setSearching(false)
      })
  }, [artist, title])

  const canConfirm =
    selected === 'none' ? manualUrl.trim().length > 0 : selected !== null

  function handleConfirm() {
    if (selected === 'none') {
      onConfirm(null, manualUrl.trim())
    } else {
      const match = candidates.find(c => c.id === selected) ?? null
      onConfirm(match)
    }
  }

  const labelText = (label: string | string[] | undefined) => {
    if (!label) return undefined
    return Array.isArray(label) ? label[0] : label
  }

  const formatText = (fmt: string | string[] | undefined) => {
    if (!fmt) return undefined
    return Array.isArray(fmt) ? fmt[0] : fmt
  }

  return (
    <div className="album-matcher">
      {/* Header — what we're matching */}
      <div className="am-header">
        <p className="am-query">{artist} — {title}</p>
        <div className="am-tags">
          {format && <span className="am-tag">{format}</span>}
          {year && <span className="am-tag">{year}</span>}
          {trackCount != null && <span className="am-tag">{trackCount} tracks</span>}
        </div>
      </div>

      {/* Candidates */}
      <div className="am-candidates">
        {searching && (
          <div className="am-searching">
            <span className="am-dot" />
            <span>Searching Discogs…</span>
          </div>
        )}

        {!searching && error && (
          <p className="am-error">{error}</p>
        )}

        {!searching && !error && (
          <>
            {candidates.map(c => (
              <button
                key={c.id}
                className={`am-card${selected === c.id ? ' am-card--selected' : ''}`}
                onClick={() => setSelected(c.id)}
              >
                <div className="am-card-art">
                  {c.thumb
                    ? <img src={c.thumb} alt="" />
                    : <span className="am-card-art-empty" />}
                </div>
                <div className="am-card-info">
                  <p className="am-card-title">{c.title}</p>
                  <p className="am-card-meta">
                    {[c.year, labelText(c.label), formatText(c.format)].filter(Boolean).join(' · ')}
                  </p>
                  {c.country && <p className="am-card-label">{c.country}</p>}
                </div>
              </button>
            ))}

            {/* None of these */}
            <button
              className={`am-card am-card--none${selected === 'none' ? ' am-card--selected' : ''}`}
              onClick={() => setSelected('none')}
            >
              <div className="am-card-art am-card-art--empty" />
              <div className="am-card-info">
                <p className="am-card-title">None of these</p>
                <p className="am-card-meta">Paste a Discogs URL manually</p>
              </div>
            </button>
          </>
        )}
      </div>

      {/* Manual URL input — only when "none" is selected */}
      {selected === 'none' && (
        <input
          className="am-manual"
          placeholder="Paste a Discogs URL…"
          value={manualUrl}
          onChange={e => setManualUrl(e.target.value)}
          autoFocus
        />
      )}

      {/* Actions */}
      <div className="am-actions">
        {onSkip && (
          <button className="am-skip" onClick={onSkip}>Skip</button>
        )}
        <button
          className="am-confirm"
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          Confirm match
        </button>
      </div>
    </div>
  )
}
