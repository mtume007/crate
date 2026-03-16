import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimise: () => ipcRenderer.send('window-minimise'),
  maximise: () => ipcRenderer.send('window-maximise'),
  close:    () => ipcRenderer.send('window-close'),

  // Convert a local file path → crate-asset:// URL (replaces Tauri's convertFileSrc)
  assetUrl: (filePath) => {
    if (!filePath) return ''
    return `crate-asset://${filePath.replace(/\\/g, '/')}`
  },

  platform: process.platform,
})
