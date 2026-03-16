import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import App from './App'
import '@fontsource/outfit/300.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import './styles/global.css'

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

async function applyTheme() {
  try {
    const res = await fetch('http://localhost:8000/config')
    const config = await res.json()
    const t = config.theme
    const root = document.documentElement
    const { r, g, b } = hexToRgb(t.accent)
    root.style.setProperty('--c-accent', t.accent)
    root.style.setProperty('--c-accent-dim', `rgba(${r},${g},${b},0.12)`)
    root.style.setProperty('--c-accent-border', `rgba(${r},${g},${b},0.3)`)
    root.style.setProperty('--c-base', t.base)
    root.style.setProperty('--c-card', t.card)
    root.style.setProperty('--c-hover', t.hover)
    root.style.setProperty('--c-border', t.border)
    root.style.setProperty('--border-radius', `${t.radius}px`)
    const fontStack = t.font === 'System'
      ? '-apple-system, sans-serif'
      : `'${t.font}', -apple-system, sans-serif`
    root.style.setProperty('--font-display', fontStack)
  } catch (e) {
    // Fall back to CSS defaults silently
  }
}

applyTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)
