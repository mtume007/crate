import { useState, useEffect, useRef } from 'react'

interface OnboardingProps {
  onComplete: (libraryPath: string) => void
}

type Step = 1 | 2 | 3 | 4 | 5

const ACCENT_HEX = '#e8a045'

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep]                   = useState<Step>(1)
  const [libraryPath, setLibraryPath]     = useState('')
  const [discogsToken, setDiscogsToken]   = useState('')
  const [anthropicKey, setAnthropicKey]   = useState('')
  const [saving, setSaving]               = useState(false)

  // Step 4 — Scan
  const [scanRunning, setScanRunning]     = useState(false)
  const [scanPct, setScanPct]             = useState(0)
  const [scanFile, setScanFile]           = useState('')
  const [scanStage, setScanStage]         = useState('')
  const [scanAlbums, setScanAlbums]       = useState(0)
  const scanPollRef                       = useRef<ReturnType<typeof setInterval> | null>(null)

  // Step 5 — Enrich
  const [enriching, setEnriching]         = useState(false)
  const [enrichPct, setEnrichPct]         = useState(0)
  const [enrichAlbum, setEnrichAlbum]     = useState('')
  const [enrichDone, setEnrichDone]       = useState(false)
  const [enrichSkipped, setEnrichSkipped] = useState(false)
  const enrichPollRef                     = useRef<ReturnType<typeof setInterval> | null>(null)

  // Step 5 — Organise
  const [organising, setOrganising]       = useState(false)
  const [orgPct, setOrgPct]               = useState(0)
  const [orgAlbum, setOrgAlbum]           = useState('')
  const [orgDone, setOrgDone]             = useState(false)
  const [orgSkipped, setOrgSkipped]       = useState(false)
  const orgPollRef                        = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup pollers on unmount
  useEffect(() => () => {
    if (scanPollRef.current) clearInterval(scanPollRef.current)
    if (enrichPollRef.current) clearInterval(enrichPollRef.current)
    if (orgPollRef.current) clearInterval(orgPollRef.current)
  }, [])

  // ── Step 2: pick folder ──────────────────────────────────────────────────
  const selectFolder = async () => {
    const api = (window as any).electronAPI
    if (api?.selectFolder) {
      const path = await api.selectFolder()
      if (path) setLibraryPath(path)
    }
  }

  // ── Step 3 → 4: save config then start scan ──────────────────────────────
  const saveAndScan = async () => {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { library: { path: libraryPath } }
      if (discogsToken) body.enrichment = { discogs_token: discogsToken }
      if (anthropicKey) body.ai = { api_key: anthropicKey }
      await fetch('http://localhost:8000/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } finally {
      setSaving(false)
    }
    setStep(4)
    startScan()
  }

  const startScan = async () => {
    setScanRunning(true)
    setScanPct(0)
    setScanFile('')
    setScanStage('scanning')
    await fetch('http://localhost:8000/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: libraryPath }),
    })
    scanPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('http://localhost:8000/scan/status')
        const s = await r.json()
        const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0
        setScanPct(pct)
        setScanFile(s.current_file || '')
        setScanStage(s.stage || '')
        if (s.last_result?.albums != null) setScanAlbums(s.last_result.albums)
        if (!s.running && s.stage === 'done') {
          clearInterval(scanPollRef.current!)
          setScanRunning(false)
          if (s.last_result?.albums != null) setScanAlbums(s.last_result.albums)
          setTimeout(() => setStep(5), 600)
        }
        if (!s.running && s.stage === 'error') {
          clearInterval(scanPollRef.current!)
          setScanRunning(false)
          setTimeout(() => setStep(5), 600)
        }
      } catch { /* network hiccup — keep polling */ }
    }, 600)
  }

  // ── Step 5: enrich ───────────────────────────────────────────────────────
  const startEnrich = async () => {
    setEnriching(true)
    setEnrichPct(0)
    setEnrichAlbum('')
    await fetch('http://localhost:8000/library/enrich', { method: 'POST' })
    enrichPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('http://localhost:8000/library/enrich/status')
        const s = await r.json()
        const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0
        setEnrichPct(pct)
        setEnrichAlbum(s.current_album || '')
        if (!s.running) {
          clearInterval(enrichPollRef.current!)
          setEnriching(false)
          setEnrichDone(true)
        }
      } catch { /* keep polling */ }
    }, 800)
  }

  const skipEnrich = () => {
    setEnrichSkipped(true)
  }

  // ── Step 5: organise ─────────────────────────────────────────────────────
  const startOrganise = async () => {
    // Enable organise in config first
    await fetch('http://localhost:8000/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: { organise: true } }),
    })
    setOrganising(true)
    setOrgPct(0)
    setOrgAlbum('')
    await fetch('http://localhost:8000/library/organise', { method: 'POST' })
    orgPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('http://localhost:8000/library/organise/status')
        const s = await r.json()
        const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0
        setOrgPct(pct)
        setOrgAlbum(s.current_album || '')
        if (!s.running) {
          clearInterval(orgPollRef.current!)
          setOrganising(false)
          setOrgDone(true)
        }
      } catch { /* keep polling */ }
    }, 800)
  }

  const skipOrganise = () => setOrgSkipped(true)

  const handleEnter = () => onComplete(libraryPath)

  // ── Computed state for step 5 ────────────────────────────────────────────
  const enrichPhase = enriching ? 'running' : enrichDone ? 'done' : enrichSkipped ? 'skipped' : 'idle'
  const orgPhase    = organising ? 'running' : orgDone ? 'done' : orgSkipped ? 'skipped' : 'idle'

  // Can show organise section once enrich is settled
  const showOrganise = enrichPhase === 'done' || enrichPhase === 'skipped'
  // Can enter once organise is settled (or enrich was just skipped without showing organise yet)
  const canEnter = showOrganise && (orgPhase === 'done' || orgPhase === 'skipped')

  // ── Stage label ──────────────────────────────────────────────────────────
  const stageLabel = (stage: string) => {
    if (stage === 'scanning')     return 'Reading files'
    if (stage === 'purging')      return 'Cleaning up'
    if (stage === 'deduplicating') return 'Deduplicating'
    if (stage === 'done')         return 'Done'
    return 'Working'
  }

  return (
    <>
      <style>{`
        @keyframes ob-fade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ob-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
        .ob-ghost:hover {
          border-color: rgba(255,255,255,0.22) !important;
          color: rgba(255,255,255,0.75) !important;
        }
        .ob-primary:not(:disabled):hover { opacity: 0.85; }
        .ob-skip:hover { color: rgba(255,255,255,0.45) !important; }
        .ob-input:focus {
          outline: none;
          border-color: ${ACCENT_HEX} !important;
          box-shadow: 0 0 0 2px rgba(232,160,69,0.12);
        }
        .ob-card:hover {
          border-color: rgba(232,160,69,0.3) !important;
          background: rgba(232,160,69,0.04) !important;
        }
        .ob-step { animation: ob-fade 0.22s ease; }
      `}</style>

      <div style={s.overlay}>

        {/* Step dots */}
        <div style={s.dots}>
          {([1,2,3,4,5] as Step[]).map(n => (
            <div key={n} style={{
              ...s.dot,
              ...(n === step ? s.dotActive : n < step ? s.dotPast : {}),
            }} />
          ))}
        </div>

        {/* ── STEP 1: Welcome ──────────────────────────────────────────── */}
        {step === 1 && (
          <div className="ob-step" style={s.step}>
            <div style={s.wordmark}>Crate</div>
            <div style={s.tagline}>Your collection. Finally organised.</div>
            <div style={s.flowRow}>
              {['Scan', 'Enrich', 'Organise'].map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={s.flowStep}>
                    <div style={s.flowNum}>{i + 1}</div>
                    <div style={s.flowLabel}>{label}</div>
                  </div>
                  {i < 2 && <div style={s.flowArrow}>→</div>}
                </div>
              ))}
            </div>
            <div style={s.flowDesc}>
              Crate reads your files, looks up missing metadata on Discogs and via AI,
              then sorts everything into a clean folder structure.
            </div>
            <button className="ob-primary" style={s.primaryBtn} onClick={() => setStep(2)}>
              Get started
            </button>
          </div>
        )}

        {/* ── STEP 2: Folder ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="ob-step" style={s.step}>
            <div style={s.stepTitle}>Where's your music?</div>
            <div style={s.stepSub}>Point Crate at any folder — it doesn't matter how it's organised right now</div>

            <div style={s.folderRow}>
              <div style={{
                ...s.folderPath,
                color: libraryPath ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
              }}>
                {libraryPath || 'No folder selected'}
              </div>
              <button className="ob-ghost" style={s.ghostBtn} onClick={selectFolder}>
                Choose
              </button>
            </div>

            <button
              className="ob-primary"
              style={{ ...s.primaryBtn, ...(libraryPath ? {} : s.primaryBtnDisabled) }}
              disabled={!libraryPath}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── STEP 3: API Keys ─────────────────────────────────────────── */}
        {step === 3 && (
          <div className="ob-step" style={s.step}>
            <div style={s.stepTitle}>Connect your services</div>
            <div style={s.stepSub}>
              Used in Step 2 — enrichment. The better the source, the better your tags.
            </div>

            <div style={s.serviceCards}>
              <div style={s.serviceCard} className="ob-card">
                <div style={s.serviceHeader}>
                  <div style={s.serviceName}>Discogs</div>
                  <div style={s.servicePill}>Recommended</div>
                </div>
                <div style={s.serviceDesc}>
                  The world's largest music database. Covers vinyl, CDs, digital releases.
                  Get a free personal access token at discogs.com/settings/developers.
                </div>
                <input
                  className="ob-input"
                  style={s.input}
                  type="password"
                  placeholder="Paste personal access token"
                  value={discogsToken}
                  onChange={e => setDiscogsToken(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div style={s.serviceCard} className="ob-card">
                <div style={s.serviceHeader}>
                  <div style={s.serviceName}>Claude AI</div>
                  <div style={s.servicePill}>Fallback</div>
                </div>
                <div style={s.serviceDesc}>
                  Used when Discogs doesn't have a match. Identifies bootlegs, edits,
                  and releases with unusual tags. Get a key at console.anthropic.com.
                </div>
                <input
                  className="ob-input"
                  style={s.input}
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <button
              className="ob-primary"
              style={{ ...s.primaryBtn, ...(saving ? s.primaryBtnDisabled : {}) }}
              disabled={saving}
              onClick={saveAndScan}
            >
              {saving ? 'Saving…' : 'Start scanning'}
            </button>

            <button className="ob-skip" style={s.skipBtn} onClick={saveAndScan}>
              Skip — I'll add these later
            </button>
          </div>
        )}

        {/* ── STEP 4: Scanning ─────────────────────────────────────────── */}
        {step === 4 && (
          <div className="ob-step" style={s.step}>
            <div style={s.stepTitle}>
              {scanRunning ? 'Scanning your library' : 'Scan complete'}
            </div>
            <div style={s.stepSub}>
              {scanRunning
                ? 'Reading file tags and building your database'
                : `Found ${scanAlbums} albums`}
            </div>

            <div style={s.progressWrap}>
              <div style={s.progressTrack}>
                <div style={{
                  ...s.progressFill,
                  width: `${scanRunning ? Math.max(scanPct, 2) : 100}%`,
                  transition: scanRunning ? 'width 0.4s ease' : 'width 0.6s ease',
                  opacity: scanRunning ? 1 : 0.5,
                }} />
              </div>
              <div style={s.progressMeta}>
                <span style={s.progressStage}>
                  {scanRunning ? stageLabel(scanStage) : '✓ Done'}
                </span>
                {scanRunning && scanPct > 0 && (
                  <span style={s.progressPct}>{scanPct}%</span>
                )}
              </div>
            </div>

            {scanFile && scanRunning && (
              <div style={s.scanFile}>{scanFile}</div>
            )}

            {scanRunning && (
              <div style={{ ...s.scanFile, animation: 'ob-pulse 2s ease-in-out infinite', marginTop: 8 }}>
                This may take a few minutes for large libraries
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: Enrich + Organise ────────────────────────────────── */}
        {step === 5 && (
          <div className="ob-step" style={s.step}>
            <div style={s.stepTitle}>
              {scanAlbums > 0 ? `${scanAlbums} albums scanned` : 'Library scanned'}
            </div>
            <div style={s.stepSub}>Two optional steps to get the most from your collection</div>

            {/* Enrich card */}
            <div style={{
              ...s.actionCard,
              borderColor: enrichPhase === 'done'
                ? 'rgba(232,160,69,0.35)'
                : enrichPhase === 'running'
                  ? 'rgba(232,160,69,0.2)'
                  : 'rgba(255,255,255,0.07)',
            }}>
              <div style={s.actionCardHeader}>
                <div>
                  <div style={s.actionCardTitle}>Enrich metadata</div>
                  <div style={s.actionCardDesc}>
                    Look up albums on Discogs and via AI — fills in year, label, genre,
                    catalogue number, and artwork.
                  </div>
                </div>
                <div style={s.actionCardBadge}>
                  {enrichPhase === 'done' && <span style={{ color: ACCENT_HEX }}>✓</span>}
                  {enrichPhase === 'skipped' && <span style={{ color: 'rgba(255,255,255,0.2)' }}>–</span>}
                  {enrichPhase === 'idle' && <span style={s.stepNumBadge}>2</span>}
                </div>
              </div>

              {enrichPhase === 'running' && (
                <div style={{ marginTop: 10 }}>
                  <div style={s.progressTrack}>
                    <div style={{
                      ...s.progressFill,
                      width: `${Math.max(enrichPct, 2)}%`,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ ...s.progressMeta, marginTop: 6 }}>
                    <span style={s.progressStage}>{enrichAlbum || 'Looking up…'}</span>
                    <span style={s.progressPct}>{enrichPct}%</span>
                  </div>
                </div>
              )}

              {enrichPhase === 'done' && (
                <div style={{ ...s.actionCardDesc, color: 'rgba(232,160,69,0.7)', marginTop: 6 }}>
                  Enrichment complete
                </div>
              )}

              {enrichPhase === 'skipped' && (
                <div style={{ ...s.actionCardDesc, marginTop: 6 }}>
                  Skipped — you can run this from Settings → Enrichment at any time
                </div>
              )}

              {enrichPhase === 'idle' && (
                <div style={s.actionCardActions}>
                  <button className="ob-primary" style={s.actionPrimaryBtn} onClick={startEnrich}>
                    Enrich library
                  </button>
                  <button className="ob-skip" style={s.actionSkipBtn} onClick={skipEnrich}>
                    Skip for now
                  </button>
                </div>
              )}
            </div>

            {/* Organise card — revealed after enrich is settled */}
            {showOrganise && (
              <div style={{
                ...s.actionCard,
                borderColor: orgPhase === 'done'
                  ? 'rgba(232,160,69,0.35)'
                  : orgPhase === 'running'
                    ? 'rgba(232,160,69,0.2)'
                    : 'rgba(255,255,255,0.07)',
                animation: 'ob-fade 0.25s ease',
              }}>
                <div style={s.actionCardHeader}>
                  <div>
                    <div style={s.actionCardTitle}>Organise files</div>
                    <div style={s.actionCardDesc}>
                      Moves your music into <code style={s.code}>Complete Albums/Artist/Album</code> and{' '}
                      <code style={s.code}>Singles &amp; Loose/</code> on disk.
                      Run enrichment first for best results.
                    </div>
                  </div>
                  <div style={s.actionCardBadge}>
                    {orgPhase === 'done' && <span style={{ color: ACCENT_HEX }}>✓</span>}
                    {orgPhase === 'skipped' && <span style={{ color: 'rgba(255,255,255,0.2)' }}>–</span>}
                    {orgPhase === 'idle' && <span style={s.stepNumBadge}>3</span>}
                  </div>
                </div>

                {orgPhase === 'running' && (
                  <div style={{ marginTop: 10 }}>
                    <div style={s.progressTrack}>
                      <div style={{
                        ...s.progressFill,
                        width: `${Math.max(orgPct, 2)}%`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ ...s.progressMeta, marginTop: 6 }}>
                      <span style={s.progressStage}>{orgAlbum || 'Moving files…'}</span>
                      <span style={s.progressPct}>{orgPct}%</span>
                    </div>
                  </div>
                )}

                {orgPhase === 'done' && (
                  <div style={{ ...s.actionCardDesc, color: 'rgba(232,160,69,0.7)', marginTop: 6 }}>
                    Files organised
                  </div>
                )}

                {orgPhase === 'skipped' && (
                  <div style={{ ...s.actionCardDesc, marginTop: 6 }}>
                    Skipped — you can run this from Settings → Library at any time
                  </div>
                )}

                {orgPhase === 'idle' && (
                  <div style={s.actionCardActions}>
                    <button className="ob-primary" style={s.actionPrimaryBtn} onClick={startOrganise}>
                      Organise now
                    </button>
                    <button className="ob-skip" style={s.actionSkipBtn} onClick={skipOrganise}>
                      Skip for now
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Enter library */}
            {canEnter && (
              <button
                className="ob-primary"
                style={{ ...s.primaryBtn, marginTop: 4, animation: 'ob-fade 0.3s ease' }}
                onClick={handleEnter}
              >
                Enter my library →
              </button>
            )}

            {/* Let them in early if they want */}
            {!canEnter && (
              <button className="ob-skip" style={{ ...s.skipBtn, marginTop: 8 }} onClick={handleEnter}>
                Enter library now
              </button>
            )}
          </div>
        )}

      </div>
    </>
  )
}

// ── Styles ───────────────────────────────────────────────────────────────────

const FONT_DISPLAY = "'Martian Mono', monospace"
const FONT_DATA    = "'Martian Mono', monospace"

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position:       'fixed',
    inset:          0,
    zIndex:         300,
    background:     '#080808',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    fontFamily:     FONT_DISPLAY,
  },

  // Step indicator
  dots: {
    position:  'absolute',
    top:       28,
    left:      '50%',
    transform: 'translateX(-50%)',
    display:   'flex',
    gap:       8,
    alignItems: 'center',
  },
  dot: {
    width:        5,
    height:       5,
    borderRadius: '50%',
    background:   'rgba(255,255,255,0.1)',
    transition:   'background 0.2s ease, transform 0.2s ease',
  },
  dotActive: {
    background: ACCENT_HEX,
    transform:  'scale(1.3)',
  },
  dotPast: {
    background: 'rgba(255,255,255,0.28)',
  },

  // Step container
  step: {
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           14,
    maxWidth:      480,
    width:         '100%',
    padding:       '0 32px',
    boxSizing:     'border-box',
  },

  // Step 1
  wordmark: {
    fontSize:      64,
    fontWeight:    500,
    letterSpacing: '-0.04em',
    color:         'rgba(255,255,255,0.92)',
    lineHeight:    1,
    fontFamily:    FONT_DISPLAY,
  },
  tagline: {
    fontSize:      11,
    letterSpacing: '0.08em',
    color:         'rgba(255,255,255,0.38)',
    textAlign:     'center',
    fontFamily:    FONT_DATA,
    textTransform: 'uppercase',
    marginBottom:  8,
  },
  flowRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        0,
    marginTop:  4,
  },
  flowStep: {
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           5,
  },
  flowNum: {
    width:        26,
    height:       26,
    borderRadius: '50%',
    border:       `1px solid rgba(232,160,69,0.3)`,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    fontSize:     10,
    fontFamily:   FONT_DATA,
    color:        ACCENT_HEX,
  },
  flowLabel: {
    fontSize:      10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color:         'rgba(255,255,255,0.38)',
    fontFamily:    FONT_DATA,
  },
  flowArrow: {
    color:      'rgba(255,255,255,0.12)',
    fontSize:   12,
    margin:     '0 10px',
    marginBottom: 14,
    fontFamily: FONT_DATA,
  },
  flowDesc: {
    fontSize:   11,
    lineHeight: 1.65,
    color:      'rgba(255,255,255,0.38)',
    textAlign:  'center',
    maxWidth:   360,
    marginTop:  4,
    marginBottom: 8,
  },

  // Shared step header
  stepTitle: {
    fontSize:      24,
    fontWeight:    500,
    letterSpacing: '-0.02em',
    color:         'rgba(255,255,255,0.90)',
    textAlign:     'center',
    fontFamily:    FONT_DISPLAY,
  },
  stepSub: {
    fontSize:      11,
    letterSpacing: '0.01em',
    color:         'rgba(255,255,255,0.42)',
    textAlign:     'center',
    lineHeight:    1.6,
    marginBottom:  4,
  },

  // Folder picker
  folderRow: {
    width:      '100%',
    display:    'flex',
    alignItems: 'center',
    gap:        12,
    background: 'rgba(255,255,255,0.03)',
    border:     '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding:    '10px 12px 10px 14px',
    boxSizing:  'border-box',
  },
  folderPath: {
    flex:         1,
    fontSize:     10,
    fontFamily:   FONT_DATA,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
    minWidth:     0,
  },

  // Service cards (step 3)
  serviceCards: {
    width:         '100%',
    display:       'flex',
    flexDirection: 'column',
    gap:           10,
  },
  serviceCard: {
    width:      '100%',
    background: 'rgba(255,255,255,0.025)',
    border:     '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding:    '14px 16px',
    boxSizing:  'border-box',
    transition: 'border-color 0.15s ease, background 0.15s ease',
  },
  serviceHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  serviceName: {
    fontSize:      12,
    fontWeight:    500,
    color:         'rgba(255,255,255,0.82)',
    fontFamily:    FONT_DISPLAY,
  },
  servicePill: {
    fontSize:      9,
    fontFamily:    FONT_DATA,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color:         ACCENT_HEX,
    opacity:       0.7,
    border:        `1px solid rgba(232,160,69,0.25)`,
    borderRadius:  4,
    padding:       '2px 6px',
  },
  serviceDesc: {
    fontSize:   11,
    lineHeight: 1.6,
    color:      'rgba(255,255,255,0.42)',
    marginBottom: 10,
  },

  // Progress
  progressWrap: {
    width:     '100%',
    marginTop: 8,
  },
  progressTrack: {
    width:        '100%',
    height:       3,
    background:   'rgba(255,255,255,0.07)',
    borderRadius: 2,
    overflow:     'hidden',
  },
  progressFill: {
    height:       '100%',
    background:   ACCENT_HEX,
    borderRadius: 2,
    transformOrigin: 'left',
  },
  progressMeta: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginTop:      7,
  },
  progressStage: {
    fontSize:   10,
    fontFamily: FONT_DATA,
    color:      'rgba(255,255,255,0.42)',
    letterSpacing: '0.06em',
  },
  progressPct: {
    fontSize:   10,
    fontFamily: FONT_DATA,
    color:      ACCENT_HEX,
    opacity:    0.8,
  },
  scanFile: {
    fontSize:     10,
    fontFamily:   FONT_DATA,
    color:        'rgba(255,255,255,0.35)',
    letterSpacing: '0.02em',
    textAlign:    'center',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
    width:        '100%',
  },

  // Action cards (step 5)
  actionCard: {
    width:        '100%',
    background:   'rgba(255,255,255,0.025)',
    border:       '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding:      '14px 16px',
    boxSizing:    'border-box',
    transition:   'border-color 0.3s ease',
  },
  actionCardHeader: {
    display:        'flex',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
  },
  actionCardTitle: {
    fontSize:   13,
    fontWeight: 500,
    color:      'rgba(255,255,255,0.85)',
    fontFamily: FONT_DISPLAY,
    marginBottom: 4,
  },
  actionCardDesc: {
    fontSize:   11,
    lineHeight: 1.6,
    color:      'rgba(255,255,255,0.42)',
  },
  actionCardBadge: {
    fontSize:   13,
    fontFamily: FONT_DATA,
    flexShrink: 0,
    marginTop:  1,
  },
  stepNumBadge: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    width:          20,
    height:         20,
    borderRadius:   '50%',
    border:         '1px solid rgba(255,255,255,0.12)',
    fontSize:       10,
    color:          'rgba(255,255,255,0.38)',
    fontFamily:     FONT_DATA,
  },
  actionCardActions: {
    display:    'flex',
    alignItems: 'center',
    gap:        16,
    marginTop:  12,
  },
  actionPrimaryBtn: {
    padding:      '8px 20px',
    background:   ACCENT_HEX,
    border:       'none',
    borderRadius: 6,
    color:        '#080808',
    fontFamily:   FONT_DATA,
    fontSize:     10,
    fontWeight:   500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor:       'pointer',
    transition:   'opacity 0.15s ease',
  },
  actionSkipBtn: {
    background:   'none',
    border:       'none',
    color:        'rgba(255,255,255,0.38)',
    fontFamily:   FONT_DATA,
    fontSize:     10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor:       'pointer',
    padding:      '4px 0',
    transition:   'color 0.15s ease',
  },

  // Shared buttons
  primaryBtn: {
    marginTop:    4,
    padding:      '11px 0',
    background:   ACCENT_HEX,
    border:       'none',
    borderRadius: 6,
    color:        '#080808',
    fontFamily:   FONT_DATA,
    fontSize:     10,
    fontWeight:   500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor:       'pointer',
    transition:   'opacity 0.15s ease',
    width:        '100%',
  },
  primaryBtnDisabled: {
    opacity: 0.3,
    cursor:  'default',
  },
  ghostBtn: {
    padding:      '7px 14px',
    background:   'none',
    border:       '1px solid rgba(255,255,255,0.12)',
    borderRadius: 6,
    color:        'rgba(255,255,255,0.48)',
    fontFamily:   FONT_DATA,
    fontSize:     10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor:       'pointer',
    transition:   'all 0.15s ease',
    flexShrink:   0,
    whiteSpace:   'nowrap' as const,
  },
  skipBtn: {
    background:   'none',
    border:       'none',
    color:        'rgba(255,255,255,0.35)',
    fontFamily:   FONT_DATA,
    fontSize:     10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    cursor:       'pointer',
    padding:      '4px 8px',
    transition:   'color 0.15s ease',
  },

  // Misc
  input: {
    width:        '100%',
    padding:      '9px 12px',
    background:   'rgba(255,255,255,0.04)',
    border:       '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    color:        'rgba(255,255,255,0.75)',
    fontFamily:   FONT_DATA,
    fontSize:     11,
    transition:   'border-color 0.15s ease, box-shadow 0.15s ease',
    boxSizing:    'border-box',
  },
  code: {
    fontFamily:  FONT_DATA,
    fontSize:    11,
    background:  'rgba(255,255,255,0.07)',
    borderRadius: 3,
    padding:     '1px 4px',
    color:       'rgba(255,255,255,0.55)',
  },
}
