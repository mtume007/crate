import { useState } from 'react'

interface OnboardingProps {
  onComplete: (libraryPath: string) => void
}

const ACCENT = '#e8a045'

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1)
  const [libraryPath, setLibraryPath] = useState('')
  const [discogsToken, setDiscogsToken] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [saving, setSaving] = useState(false)

  const selectFolder = async () => {
    const api = (window as any).electronAPI
    if (api?.selectFolder) {
      const path = await api.selectFolder()
      if (path) setLibraryPath(path)
    }
  }

  const handleComplete = async () => {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        library: { path: libraryPath },
      }
      if (discogsToken) body.discogs = { token: discogsToken }
      if (anthropicKey) body.ai = { api_key: anthropicKey }

      await fetch('http://localhost:8000/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onComplete(libraryPath)
    } catch (e) {
      console.error('Failed to save config:', e)
      setSaving(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes ob-fade {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .ob-ghost-btn:hover {
          border-color: rgba(255,255,255,0.22) !important;
          color: rgba(255,255,255,0.75) !important;
        }
        .ob-primary-btn:not(:disabled):hover { opacity: 0.85; }
        .ob-skip-btn:hover { color: rgba(255,255,255,0.45) !important; }
        .ob-input:focus {
          outline: none;
          border-color: ${ACCENT} !important;
        }
      `}</style>

      <div style={s.overlay}>

        {/* Step indicator */}
        <div style={s.dots}>
          {[1, 2, 3].map(n => (
            <div
              key={n}
              style={{ ...s.dot, ...(n === step ? s.dotActive : n < step ? s.dotPast : {}) }}
            />
          ))}
        </div>

        {/* ── Step 1 — Welcome ── */}
        {step === 1 && (
          <div key="step1" style={s.step}>
            <div style={s.wordmark}>Crate</div>
            <div style={s.tagline}>Your collection. Finally organised.</div>
            <button
              className="ob-primary-btn"
              style={s.primaryBtn}
              onClick={() => setStep(2)}
            >
              Get started
            </button>
          </div>
        )}

        {/* ── Step 2 — Your Music ── */}
        {step === 2 && (
          <div key="step2" style={s.step}>
            <div style={s.stepTitle}>Where's your music?</div>
            <div style={s.stepSub}>Choose the folder that contains your albums</div>

            <div style={s.folderRow}>
              <div style={{
                ...s.folderPath,
                color: libraryPath ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.20)',
              }}>
                {libraryPath || 'No folder selected'}
              </div>
              <button
                className="ob-ghost-btn"
                style={s.ghostBtn}
                onClick={selectFolder}
              >
                Choose folder
              </button>
            </div>

            <button
              className="ob-primary-btn"
              style={{ ...s.primaryBtn, ...(libraryPath ? {} : s.primaryBtnDisabled) }}
              disabled={!libraryPath}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step 3 — Connect ── */}
        {step === 3 && (
          <div key="step3" style={s.step}>
            <div style={s.stepTitle}>Connect your services</div>
            <div style={s.stepSub}>Optional — adds metadata and AI-powered tagging</div>

            <div style={s.fields}>
              <div style={s.field}>
                <div style={s.fieldLabel}>Discogs Token</div>
                <input
                  className="ob-input"
                  style={s.input}
                  type="password"
                  placeholder="Paste your Discogs personal access token"
                  value={discogsToken}
                  onChange={e => setDiscogsToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div style={s.field}>
                <div style={s.fieldLabel}>Anthropic API Key</div>
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
              className="ob-primary-btn"
              style={{ ...s.primaryBtn, ...(saving ? s.primaryBtnDisabled : {}) }}
              disabled={saving}
              onClick={handleComplete}
            >
              {saving ? 'Setting up…' : 'Start building my library'}
            </button>

            <button
              className="ob-skip-btn"
              style={s.skipBtn}
              onClick={handleComplete}
            >
              Skip for now
            </button>
          </div>
        )}

      </div>
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 300,
    background: '#080808',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Martian Mono', monospace",
  },

  dots: {
    position: 'absolute',
    top: 32,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.12)',
    transition: 'background 0.2s ease, transform 0.2s ease',
  },
  dotActive: {
    background: ACCENT,
    transform: 'scale(1.2)',
  },
  dotPast: {
    background: 'rgba(255,255,255,0.30)',
  },

  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    maxWidth: 440,
    width: '100%',
    padding: '0 32px',
    animation: 'ob-fade 0.22s ease',
    boxSizing: 'border-box',
  },

  wordmark: {
    fontSize: 64,
    fontWeight: 500,
    letterSpacing: '-0.04em',
    color: 'rgba(255,255,255,0.92)',
    marginBottom: 0,
    lineHeight: 1,
  },
  tagline: {
    fontSize: 12,
    letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.30)',
    textAlign: 'center',
    marginBottom: 20,
  },

  stepTitle: {
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    color: 'rgba(255,255,255,0.90)',
    textAlign: 'center',
    marginBottom: 0,
  },
  stepSub: {
    fontSize: 11,
    letterSpacing: '0.04em',
    color: 'rgba(255,255,255,0.28)',
    textAlign: 'center',
    marginBottom: 8,
  },

  primaryBtn: {
    marginTop: 8,
    padding: '11px 0',
    background: ACCENT,
    border: 'none',
    borderRadius: 6,
    color: '#080808',
    fontFamily: "'Martian Mono', monospace",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
    width: '100%',
  },
  primaryBtnDisabled: {
    opacity: 0.3,
    cursor: 'default',
  },

  ghostBtn: {
    padding: '7px 14px',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.40)',
    fontFamily: "'Martian Mono', monospace",
    fontSize: 9,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },

  folderRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '10px 12px 10px 14px',
    boxSizing: 'border-box',
  },
  folderPath: {
    flex: 1,
    fontSize: 10,
    letterSpacing: '0.02em',
    fontFamily: "'Martian Mono', monospace",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },

  fields: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    marginBottom: 4,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    fontSize: 7,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: ACCENT,
    opacity: 0.65,
    fontFamily: "'Martian Mono', monospace",
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: "'Martian Mono', monospace",
    fontSize: 11,
    transition: 'border-color 0.15s ease',
    boxSizing: 'border-box',
  },

  skipBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.18)',
    fontFamily: "'Martian Mono', monospace",
    fontSize: 8,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    padding: '4px 8px',
    marginTop: -6,
    transition: 'color 0.15s ease',
  },
}
