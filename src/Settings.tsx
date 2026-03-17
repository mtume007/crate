import { useState, useEffect } from 'react'
import { fetchConfig, updateConfig } from './api'

interface Config {
  ai: { provider: string; model: string; api_key: string }
  library: { path: string }
  enrichment: { discogs_token: string; auto_enrich: boolean; source: string }
}

export default function Settings({ onClose, onLibraryChange }: { onClose: () => void; onLibraryChange?: (path: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [tab, setTab] = useState<'ai' | 'library' | 'enrichment'>('ai')
  const [pickingFolder, setPickingFolder] = useState(false)
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
        </div>

      </div>
    </div>
  )
}
