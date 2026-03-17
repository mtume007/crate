import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './context/ThemeContext'
import App from './App'
import '@fontsource/martian-mono/300.css'
import '@fontsource/martian-mono/400.css'
import '@fontsource/martian-mono/500.css'
import './styles/global.css'
import { applySurfaceTokens } from './theme'
export { applySurfaceTokens } from './theme'

async function applyTheme() {
  try {
    const res = await fetch('http://localhost:8000/config')
    const config = await res.json()
    // Only read mode from config — accent, radius, and font are HULDRA fixed values
    const mode: 'dark' | 'light' = config.theme?.mode === 'light' ? 'light' : 'dark'
    ;(window as any).__crateMode = mode
    applySurfaceTokens(mode)
  } catch {
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
