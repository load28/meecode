import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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

/** Path to the compiled Rust sidecar binary (bundled as an extra resource in
 * packaged builds; the cargo debug output in dev). */
function sidecarBinPath(): string {
  const exe = process.platform === 'win32' ? 'meecode-sidecar.exe' : 'meecode-sidecar'
  return app.isPackaged
    ? join(process.resourcesPath, exe)
    : join(app.getAppPath(), 'sidecar', 'target', 'debug', exe)
}

/** Replicates Tauri's invoke convention: top-level argument keys are converted
 * camelCase → snake_case to match the Rust command params (nested object fields
 * are left untouched, exactly as Tauri does). */
function camelToSnakeTopLevel(args: unknown): unknown {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return args
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())] = v
  }
  return out
}

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
  sidecar = new Sidecar(sidecarBinPath(), [], (channel, payload) => {
    if (channel === 'sidecar:ready') sidecarReadyEvt = payload
    // Broadcast backend events to every window (main + aux), mirroring Tauri's
    // app-global emit; each window filters to what it cares about.
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  })
  sidecar.start()

  ipcMain.handle('sidecar', async (_e, { cmd, args }: { cmd: string; args: unknown }) =>
    sidecar.request(cmd, camelToSnakeTopLevel(args)),
  )

  // Native dialog / shell — Tauri's plugin-dialog + opener equivalents. The
  // open dialog maps Tauri's `OpenDialogOptions` shape to Electron's and
  // returns `string | string[] | null` to match the old plugin-dialog `open`.
  ipcMain.handle('dialog:open', async (_e, opts: Record<string, unknown> | undefined) => {
    const o = opts ?? {}
    const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
    if (o.directory) properties.push('openDirectory')
    else properties.push('openFile')
    if (o.multiple) properties.push('multiSelections')
    const res = await dialog.showOpenDialog({
      properties,
      defaultPath: typeof o.defaultPath === 'string' ? o.defaultPath : undefined,
      title: typeof o.title === 'string' ? o.title : undefined,
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return o.multiple ? res.filePaths : res.filePaths[0]
  })
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })

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
