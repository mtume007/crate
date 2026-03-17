import { createContext, useContext, useEffect, useState } from 'react'
import type { Theme } from '../tokens'
import { applySurfaceTokens } from '../theme'

interface ThemeContextType {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  toggle: () => {},
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (window as any).__crateMode ?? (localStorage.getItem('crate-theme') as Theme) ?? 'dark'
  })

  useEffect(() => {
    localStorage.setItem('crate-theme', theme)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    applySurfaceTokens(t)
    fetch('http://localhost:8000/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: { mode: t } }),
    }).catch(() => {})
  }

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
