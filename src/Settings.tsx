import { useState, useEffect } from 'react'
import { fetchConfig, updateConfig } from './api'

interface Config {
  ai: { provider: string; model: string; api_key: string }
  theme: { accent: string; base: string; card: string; hover: string; border: string; radius: number; font: string }
  library: { path: string }
  enrichment: { discogs_token: string; auto_enrich: boolean; source: string }
}

const ACCENT_PRESETS = ['#e8a045','#e8694a','#6b8cff','#4acaa8','#b06bff','#e84a8c']
const FONTS = ['Outfit', 'DM Sans', 'Inter', 'System']

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [tab, setTab] = useState<'appearance' | 'ai' | 'library' | 'enrichment'>('appearance')
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

  useEffect(() => {
    if (!config) return
    const root = document.documentElement
    const { r, g, b } = hexToRgb(config.theme.accent)
    root.style.setProperty('--c-accent', config.theme.accent)
    root.style.setProperty('--c-accent-dim', `rgba(${r},${g},${b},0.12)`)
    root.style.setProperty('--c-accent-border', `rgba(${r},${g},${b},0.3)`)
    root.style.setProperty('--c-base', config.theme.base)
    root.style.setProperty('--c-card', config.theme.card)
    root.style.setProperty('--c-hover', config.theme.hover)
    root.style.setProperty('--c-border', config.theme.border)
    root.style.setProperty('--border-radius', `${config.theme.radius}px`)
    const fontStack = config.theme.font === 'System'
      ? '-apple-system, sans-serif'
      : `'${config.theme.font}', -apple-system, sans-serif`
    root.style.setProperty('--font-display', fontStack)
  }, [config])

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
          {(['appearance', 'ai', 'library', 'enrichment'] as const).map(t => (
            <button key={t} className={`settings-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'appearance' && <>
            <div className="settings-row">
              <div className="settings-row-label">Accent Colour</div>
              <div className="accent-row">
                <input type="color" value={config.theme.accent} className="color-picker"
                  onChange={e => set('theme', 'accent', e.target.value)} />
                <div className="accent-presets">
                  {ACCENT_PRESETS.map(c => (
                    <div key={c} className="accent-swatch"
                      style={{ background: c, outlineColor: config.theme.accent === c ? c : 'transparent' }}
                      onClick={() => set('theme', 'accent', c)} />
                  ))}
                </div>
                <span className="hex-label">{config.theme.accent}</span>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Corner Radius</div>
              <div className="slider-row">
                <input type="range" min={0} max={16} value={config.theme.radius} className="settings-slider"
                  onChange={e => set('theme', 'radius', parseInt(e.target.value))} />
                <span className="slider-value">{config.theme.radius}px</span>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Font</div>
              <div className="font-options">
                {FONTS.map(f => (
                  <button key={f} className={`font-btn ${config.theme.font === f ? 'active' : ''}`}
                    style={{ fontFamily: f === 'System' ? '-apple-system' : f }}
                    onClick={() => set('theme', 'font', f)}>{f}</button>
                ))}
              </div>
            </div>
          </>}

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
            <div className="settings-row">
              <div className="settings-row-label">Library Path</div>
              <input className="settings-input" value={config.library.path}
                onChange={e => set('library', 'path', e.target.value)} />
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
                    // Poll status
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
