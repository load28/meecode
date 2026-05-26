import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Sidecar } from './sidecar'

// Headless/container hardening: Chromium's setuid sandbox and real GPU aren't
// available under xvfb in CI containers. (Production builds drop these.)
if (process.env.MEECODE_HEADLESS) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-dev-shm-usage')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.disableHardwareAcceleration()
}

let mainWindow: BrowserWindow
let childWindow: BrowserWindow | null = null
let sidecar: Sidecar
let sidecarReadyEvt: unknown = null
const captured: string[] = []

const out = (name: string) => join(app.getAppPath(), 'out', name)

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  // Allow window.open child windows — the VSCode-style shared-renderer aux window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))
  win.webContents.on('did-create-window', (child) => {
    childWindow = child
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  sidecar = new Sidecar(
    join(app.getAppPath(), 'electron/main/stub-sidecar.mjs'),
    (channel, payload) => {
      if (channel === 'sidecar:ready') sidecarReadyEvt = payload
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload)
      }
    },
  )
  sidecar.start()

  ipcMain.handle('sidecar', async (_e, { cmd, args }: { cmd: string; args: unknown }) =>
    sidecar.request(cmd, args),
  )

  // spike-only: capture both windows once the renderer reports it has opened the
  // child window and triggered completion, then write a result file and quit.
  ipcMain.on('spike-report', async (_e, data: unknown) => {
    try {
      mkdirSync(join(app.getAppPath(), 'out'), { recursive: true })
    } catch {
      /* exists */
    }
    await new Promise((r) => setTimeout(r, 400))
    try {
      const mainImg = await mainWindow.webContents.capturePage()
      writeFileSync(out('spike-main.png'), mainImg.toPNG())
      captured.push('spike-main.png')
    } catch (e) {
      captured.push(`main-capture-failed: ${String(e)}`)
    }
    if (childWindow && !childWindow.isDestroyed()) {
      try {
        const childImg = await childWindow.webContents.capturePage()
        writeFileSync(out('spike-child.png'), childImg.toPNG())
        captured.push('spike-child.png')
      } catch (e) {
        captured.push(`child-capture-failed: ${String(e)}`)
      }
    }
    writeFileSync(
      out('spike-result.json'),
      JSON.stringify(
        {
          report: data,
          sidecarReadyEvt,
          childWindowExists: !!childWindow,
          captured,
        },
        null,
        2,
      ),
    )
    setTimeout(() => app.quit(), 300)
  })

  mainWindow = createMainWindow()
})

app.on('window-all-closed', () => {
  sidecar?.stop()
  app.quit()
})
