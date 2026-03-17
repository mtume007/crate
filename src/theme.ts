export type ThemeMode = 'dark' | 'light'

export const DARK_SURFACE = {
  base: '#080808', card: '#0f0f0f', hover: '#161616', border: '#1e1e1e',
}
export const LIGHT_SURFACE = {
  base: '#f5f0e8', card: '#edeae0', hover: '#e4ddd0', border: '#ddd6c8',
}

export function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function applySurfaceTokens(mode: ThemeMode, accentOverride?: string) {
  const root = document.documentElement
  const s = mode === 'light' ? LIGHT_SURFACE : DARK_SURFACE
  root.setAttribute('data-theme', mode)
  root.style.setProperty('--c-base', s.base)
  root.style.setProperty('--c-card', s.card)
  root.style.setProperty('--c-hover', s.hover)
  root.style.setProperty('--c-border', s.border)
  const accent = accentOverride ?? (mode === 'light' ? '#c07d20' : '#e8a045')
  const { r, g, b } = hexToRgb(accent)
  root.style.setProperty('--c-accent', accent)
  root.style.setProperty('--c-accent-dim', `rgba(${r},${g},${b},${mode === 'light' ? 0.09 : 0.12})`)
  root.style.setProperty('--c-accent-border', `rgba(${r},${g},${b},${mode === 'light' ? 0.22 : 0.3})`)
}
