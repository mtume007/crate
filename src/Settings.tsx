import { useState, useEffect } from 'react'
import { fetchConfig, updateConfig } from './api'

interface Config {
  ai: { provider: string; model: string; api_key: string }
  library: { path: string; organise: boolean }
  enrichment: { discogs_token: string; auto_enrich: boolean; source: string }
}

export default function Settings({ onClose, onLibraryChange }: { onClose: () => void; onLibraryChange?: (path: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [tab, setTab] = useState<'ai' | 'library' | 'enrichment'>('ai')
  const [pickingFolder, setPickingFolder] = useState(false)
  const [organising, setOrganising] = useState(false)
  const [organiseResult, setOrganiseResult] = useState<{ moved?: number; skipped?: number; errors?: number; not_found?: number } | null>(null)
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState<{ success?: boolean; removed?: number; checked?: number; error?: string } | null>(null)
  const [clearRescanning, setClearRescanning] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichStatus, setEnrichStatus] = useState<{ enriched?: number; failed?: number; total?: number; current?: number; current_album?: string; running?: boolean; error?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchConfig().then(setConfig) }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const set = (section: keyof Config, key: string, value: any) =>
    setConfig(c => c ? { ...c, [section]: { ...c[section as keyof Config], [key]: value } } : c)

  const save = async () => {
    if (!config) return
    setSaving(true)
    await updateConfig(config)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!config) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>

        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs">
          {(['ai', 'library', 'enrichment'] as const).map(t => (
            <button key={t} className={`settings-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="settings-body">

          {tab === 'ai' && <>
            <div className="settings-row">
              <div className="settings-row-label">Provider</div>
              <input className="settings-input" value={config.ai.provider}
                onChange={e => set('ai', 'provider', e.target.value)} />
            </div>
            <div className="settings-row">
              <div className="settings-row-label">Model</div>
              <input className="settings-input" value={config.ai.model}
                onChange={e => set('ai', 'model', e.target.value)} />
            </div>
            <div className="settings-row">
              <div className="settings-row-label">API Key</div>
              <input className="settings-input" type="password" value={config.ai.api_key}
                onChange={e => set('ai', 'api_key', e.target.value)} placeholder="sk-ant-..." />
            </div>
          </>}

          {tab === 'library' && <>
            <div className="settings-row settings-row--folder">
              <div className="settings-row-label">Music Folder</div>
              <div className="settings-folder-wrap">
                <div className="settings-folder-path">
                  {config.library.path || <span className="settings-folder-empty">No folder selected</span>}
                </div>
                <button
                  className="settings-folder-btn"
                  disabled={pickingFolder}
                  onClick={async () => {
                    setPickingFolder(true)
                    try {
                      const picked = await (window as any).electronAPI?.selectFolder()
                      if (picked && picked !== config.library.path) {
                        set('library', 'path', picked)
                        await updateConfig({ library: { path: picked } })
                        onLibraryChange?.(picked)
                        onClose()
                      }
                    } finally {
                      setPickingFolder(false)
                    }
                  }}
                >
                  {pickingFolder ? 'Choosing…' : 'Choose Folder'}
                </button>
              </div>
              <div className="settings-folder-hint">
                Changing the folder will clear your current library and rescan automatically.
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Clear &amp; Rescan</div>
              <div className="enrich-row">
                <button
                  className={`enrich-btn ${clearRescanning ? 'running' : ''}`}
                  disabled={clearRescanning || !config.library.path}
                  onClick={async () => {
                    if (!config.library.path) return
                    setClearRescanning(true)
                    try {
                      await fetch('http://localhost:8000/library/clear', { method: 'DELETE' })
                      onLibraryChange?.(config.library.path)
                      onClose()
                    } finally {
                      setClearRescanning(false)
                    }
                  }}
                >
                  {clearRescanning ? 'Clearing…' : 'Clear & Rescan'}
                </button>
              </div>
              <div className="settings-folder-hint">
                Wipes the database and rebuilds it from scratch. Use this if you see duplicates or tracks that won't play.
              </div>
            </div>

            <div className="settings-row settings-row--organise">
              <div className="settings-row-label">Organise Files</div>
              <div className="settings-organise-wrap">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={config.library.organise ?? false}
                    onChange={e => {
                      set('library', 'organise', e.target.checked)
                      updateConfig({ library: { organise: e.target.checked } })
                    }}
                  />
                  <span className="settings-toggle-track" />
                </label>
                <span className="settings-organise-label">
                  {config.library.organise ? 'On — files are sorted on disk' : 'Off — files stay where they are'}
                </span>
              </div>
              <div className="settings-folder-hint">
                When on, Crate moves your music into Complete Albums/ and Singles &amp; Loose/ inside your library folder. Drag-and-drop imports are organised automatically.
              </div>
            </div>

            {config.library.organise && (
              <div className="settings-row">
                <div className="settings-row-label">Organise Now</div>
                <div className="enrich-row">
                  <button
                    className={`enrich-btn ${organising ? 'running' : ''}`}
                    disabled={organising}
                    onClick={async () => {
                      setOrganising(true)
                      setOrganiseResult(null)
                      await fetch('http://localhost:8000/library/organise', { method: 'POST' })
                      const poll = setInterval(async () => {
                        const r = await fetch('http://localhost:8000/library/organise/status')
                        const s = await r.json()
                        if (!s.running) {
                          clearInterval(poll)
                          setOrganising(false)
                          if (s.last_result) setOrganiseResult(s.last_result)
                        }
                      }, 800)
                    }}
                  >
                    {organising ? 'Organising…' : 'Organise library'}
                  </button>
                  {organiseResult && !organising && (
                    <span className="enrich-result">
                      {organiseResult.moved} moved · {organiseResult.skipped} already sorted
                      {(organiseResult.not_found ?? 0) > 0 && ` · ${organiseResult.not_found} not found — try Rescan first`}
                      {(organiseResult.errors ?? 0) > 0 && ` · ${organiseResult.errors} errors`}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row-label">Fix Library</div>
              <div className="enrich-row">
                <button
                  className={`enrich-btn ${purging ? 'running' : ''}`}
                  disabled={purging}
                  onClick={async () => {
                    setPurging(true)
                    setPurgeResult(null)
                    try {
                      const r = await fetch('http://localhost:8000/library/purge-stale', { method: 'POST' })
                      const data = await r.json()
                      setPurgeResult(data)
                    } finally {
                      setPurging(false)
                    }
                  }}
                >
                  {purging ? 'Fixing…' : 'Remove stale entries'}
                </button>
                {purgeResult && !purging && (
                  <span className="enrich-result" style={purgeResult.error ? { color: 'var(--c-error, #e05)' } : undefined}>
                    {purgeResult.error
                      ? `Error: ${purgeResult.error}`
                      : purgeResult.removed === 0
                        ? `All good — ${purgeResult.checked ?? 0} tracks checked`
                        : `Removed ${purgeResult.removed} ghost entries · ${purgeResult.checked ?? 0} checked`}
                  </span>
                )}
              </div>
              <div className="settings-folder-hint">
                Removes tracks from the database whose files have been moved or deleted. Run this if you see duplicates or tracks that won't play.
              </div>
            </div>
          </>}

          {tab === 'enrichment' && <>
            <div className="settings-row">
              <div className="settings-row-label">Discogs Token</div>
              <input className="settings-input" type="password"
                value={config.enrichment?.discogs_token || ''}
                onChange={e => set('enrichment', 'discogs_token', e.target.value)}
                placeholder="Your Discogs personal access token" />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Tag Source</div>
              <div className="font-options">
                {(['file', 'enriched', 'mixed'] as const).map(s => (
                  <button key={s} className={`font-btn ${config.enrichment?.source === s ? 'active' : ''}`}
                    onClick={() => set('enrichment', 'source', s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <div className="settings-source-hint">
                {config.enrichment?.source === 'file' && 'Shows original tags from your music files'}
                {config.enrichment?.source === 'enriched' && 'Shows Discogs data where available, falls back to file tags'}
                {config.enrichment?.source === 'mixed' && 'Prefers Discogs data, falls back to file tags'}
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Enrich Library</div>
              <div className="enrich-row">
                <button className={`enrich-btn ${enriching ? 'running' : ''}`}
                  disabled={enriching || !config.enrichment?.discogs_token}
                  onClick={async () => {
                    setEnriching(true)
                    setEnrichStatus(null)
                    await fetch('http://localhost:8000/library/enrich', { method: 'POST' })
                    const poll = setInterval(async () => {
                      const r = await fetch('http://localhost:8000/library/enrich/status')
                      const s = await r.json()
                      setEnrichStatus(s)
                      if (!s.running) { clearInterval(poll); setEnriching(false) }
                    }, 1500)
                  }}>
                  {enriching ? 'Enriching...' : 'Enrich all albums'}
                </button>
                {enrichStatus && !enriching && (
                  <span className="enrich-result">
                    {enrichStatus.enriched} enriched · {enrichStatus.failed} failed
                  </span>
                )}
                {enriching && enrichStatus && (
                  <span className="enrich-result">
                    {enrichStatus.current}/{enrichStatus.total} — {enrichStatus.current_album}
                  </span>
                )}
              </div>
            </div>
          </>}
        </div>

        <div className="settings-footer">
          <button className="settings-save" onClick={save} disabled={saving}>
            {saved ? 'Saved ✓' : saving ? 'Saving...' : 'Save changes'}
          </button>
          {import.meta.env.DEV && (
            <button
              className="settings-save"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)', marginLeft: 8 }}
              onClick={async () => {
                await fetch('http://localhost:8000/library/clear', { method: 'DELETE' })
                await fetch('http://localhost:8000/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ library: { path: '' } }),
                })
                window.location.reload()
              }}
            >
              Reset to new user
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
