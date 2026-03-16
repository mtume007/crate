import { app, BrowserWindow, protocol, net, ipcMain, session, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

// Must be called before app is ready — registers crate-asset:// as a
// privileged scheme with streaming support (required for audio range requests)
protocol.registerSchemesAsPrivileged([
  { scheme: 'crate-asset', privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

let mainWindow = null

// ---------------------------------------------------------------------------
// Custom protocol: crate-asset://  (replaces Tauri's asset protocol)
// Allows the renderer to load local audio/image files securely.
// ---------------------------------------------------------------------------
function registerAssetProtocol() {
  protocol.handle('crate-asset', (request) => {
    const filePath = decodeURIComponent(request.url.replace('crate-asset://', ''))
    return net.fetch(`file://${filePath}`)
  })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: '#080808',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Allow crate-asset:// and localhost in CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:8000; " +
          "media-src crate-asset: blob: http://localhost:8000; " +
          "img-src 'self' data: http://localhost:8000 crate-asset:; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "connect-src 'self' ws://localhost:* http://localhost:*;"
        ],
      },
    })
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:1420')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Open all external https:// links in the system browser, not a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ---------------------------------------------------------------------------
// IPC — window controls
// ---------------------------------------------------------------------------
ipcMain.on('window-minimise', () => mainWindow?.minimize())
ipcMain.on('window-maximise', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window-close', () => mainWindow?.close())

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  registerAssetProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
