const { contextBridge, ipcRenderer } = require('electron')

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

  // Open a native folder picker — returns the selected path or null
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  platform: process.platform,

  // Show a file or folder in Finder / Explorer
  showInFinder: (filePath) => ipcRenderer.send('show-in-finder', filePath),
})
