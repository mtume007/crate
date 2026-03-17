import { useState, useEffect } from 'react'

export interface DiscogsCandidate {
  id: number
  type?: string
  title: string
  year?: number
  label?: string | string[]
  format?: string | string[]
  country?: string
  thumb?: string
  uri: string
}

interface AlbumMatcherProps {
  albumId: number
  artist: string
  title: string
  year?: string
  format?: string
  trackCount?: number
  onConfirm: (candidate: DiscogsCandidate | null, discogsUrl?: string) => void
  onSkip?: () => void
  onOpenSettings?: () => void
}

export default function AlbumMatcher({
  albumId,
  artist,
  title,
  year,
  format,
  trackCount,
  onConfirm,
  onSkip,
  onOpenSettings,
}: AlbumMatcherProps) {
  const [candidates, setCandidates] = useState<DiscogsCandidate[]>([])
  const [selected, setSelected] = useState<number | 'none' | null>(null)
  const [manualUrl, setManualUrl] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  // null = still checking, true = token missing, false = token present
  const [noToken, setNoToken] = useState<boolean | null>(null)

  // Check for Discogs token before attempting any search
  useEffect(() => {
    fetch('http://localhost:8000/config')
      .then(r => r.json())
      .then(c => setNoToken(!c.enrichment?.discogs_token))
      .catch(() => setNoToken(true))
  }, [])

  // Fire search only once we know a token is present
  useEffect(() => {
    if (noToken === null || noToken) return
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
        setError('Discogs search failed — check your token in Settings')
        setSearching(false)
      })
  }, [artist, title, noToken])

  const canConfirm =
    !confirmLoading && (selected === 'none' ? manualUrl.trim().length > 0 : selected !== null)

  async function handleConfirm() {
    setConfirmError(null)
    setConfirmLoading(true)
    try {
      let discogsUrl: string
      let candidate: DiscogsCandidate | null = null
      if (selected === 'none') {
        discogsUrl = manualUrl.trim()
      } else {
        candidate = candidates.find(c => c.id === selected) ?? null
        const resourceType = candidate?.type === 'master' ? 'master' : 'release'
        discogsUrl = `https://www.discogs.com/${resourceType}/${candidate?.id}`
      }
      const res = await fetch(`http://localhost:8000/library/enrich/url/${albumId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: discogsUrl }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setConfirmError(data.error || 'Failed to save — check your Discogs token')
        return
      }
      onConfirm(candidate, discogsUrl)
    } catch {
      setConfirmError('Request failed — is the server running?')
    } finally {
      setConfirmLoading(false)
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
        {/* Checking config */}
        {noToken === null && (
          <div className="am-searching">
            <span className="am-dot" />
            <span>Checking configuration…</span>
          </div>
        )}

        {/* No Discogs token */}
        {noToken === true && (
          <div className="am-no-token">
            <span>Add your Discogs token in Settings to enable matching.</span>
            {onOpenSettings && (
              <button className="am-settings-link" onClick={onOpenSettings}>Open Settings</button>
            )}
          </div>
        )}

        {/* Has token — normal search flow */}
        {noToken === false && searching && (
          <div className="am-searching">
            <span className="am-dot" />
            <span>Searching Discogs…</span>
          </div>
        )}

        {noToken === false && !searching && error && (
          <p className="am-error">{error}</p>
        )}

        {noToken === false && !searching && !error && (
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

      {/* Confirm error */}
      {confirmError && <p className="am-confirm-error">{confirmError}</p>}

      {/* Actions */}
      <div className="am-actions">
        {onSkip && (
          <button className="am-skip" onClick={onSkip} disabled={confirmLoading}>Skip</button>
        )}
        <button
          className="am-confirm"
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          {confirmLoading ? 'Saving…' : 'Confirm match'}
        </button>
      </div>
    </div>
  )
}
