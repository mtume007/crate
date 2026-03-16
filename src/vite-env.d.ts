/// <reference types="vite/client" />

interface ElectronAPI {
  minimise: () => void
  maximise: () => void
  close: () => void
  assetUrl: (filePath: string) => string
  platform: string
}

declare interface Window {
  electronAPI: ElectronAPI
}
