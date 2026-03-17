import { app, BrowserWindow, protocol, net, ipcMain, session, shell, dialog } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'

// ---------------------------------------------------------------------------
// Backend — spawn Python/uvicorn in production
// ---------------------------------------------------------------------------
let backendProcess = null

async function startBackend() {
  if (isDev) return // dev mode: start.sh handles it

  // If something is already on 8000, just use it
  try {
    await net.fetch('http://127.0.0.1:8000/health')
    console.log('[backend] already running, skipping spawn')
    return
  } catch (_) {}

  const homeDir = app.getPath('home')
  const backendDir = path.join(homeDir, 'crate', 'src-python')
  const python = path.join(homeDir, 'crate', 'src-python', 'venv', 'bin', 'python')

  backendProcess = spawn(python, [
    '-m', 'uvicorn',
    'crate.main:app',
    '--port', '8000',
    '--host', '127.0.0.1',
  ], {
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONPATH: backendDir,
      VIRTUAL_ENV: path.join(backendDir, 'venv'),
      PATH: `${path.join(backendDir, 'venv', 'bin')}:${process.env.PATH}`,
    },
  })

  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString()))
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString()))
  backendProcess.on('exit', code => console.log('[backend] exited', code))
}

function waitForBackend(retries = 30) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      net.fetch('http://127.0.0.1:8000/health')
        .then(() => resolve())
        .catch(() => {
          if (n <= 0) reject(new Error('Backend never started'))
          else setTimeout(() => check(n - 1), 500)
        })
    }
    check(retries)
  })
}

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
      webSecurity: isDev, // allow file:// → localhost fetches in production
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
          "img-src 'self' data: http://localhost:8000 crate-asset: https://*.discogs.com https://*.discogs-cdn.com; " +
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
// IPC — window controls + folder picker
// ---------------------------------------------------------------------------
ipcMain.on('window-minimise', () => mainWindow?.minimize())
ipcMain.on('window-maximise', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window-close', () => mainWindow?.close())

ipcMain.on('show-in-finder', (_, filePath) => {
  if (filePath) shell.showItemInFolder(filePath)
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose your music folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  registerAssetProtocol()
  await startBackend()
  if (!isDev) {
    try { await waitForBackend() } catch (e) { console.error(e) }
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
