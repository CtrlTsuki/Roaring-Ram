import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatBytes, formatPercent } from '../shared/format'
import type { RoaringRequest, SealInput, Snapshot } from '../shared/ipc'
import { Engine } from './engine'
import { loadPlatform, type Platform } from './platform'
import { Store } from './store'

const VISIBLE_MS = 2000
const HIDDEN_MS = 4000

let win: BrowserWindow | null = null
let tray: Tray | null = null
let engine: Engine
let platform: Platform
let quitting = false

const shotsDir = !app.isPackaged ? process.env.RR_SHOTS : undefined
// RR_SMOKE=<file>: start, take one reading, write a short report there and quit. Read-only; used to
// check a packaged build really loads its native code and can read memory.
const smokeFile = process.env.RR_SMOKE
// Screenshot runs keep their own settings, so they never touch the person's seals or log.
if (shotsDir) app.setPath('userData', path.join(os.tmpdir(), 'rr-shots', 'user-data'))
if (smokeFile) app.setPath('userData', path.join(os.tmpdir(), 'rr-smoke', 'user-data'))

if (!app.requestSingleInstanceLock()) {
  // A second R.R. would fight the first over the same seals.
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(boot)
}

async function boot(): Promise<void> {
  app.setAppUserModelId('com.roaringram.rr')
  platform = await loadPlatform()
  const store = new Store(path.join(app.getPath('userData'), 'rr-state.json'))
  engine = new Engine(platform, store, () => new Set(app.getAppMetrics().map((m) => m.pid)))
  engine.onSnapshot(push)
  registerIpc()
  createWindow()
  createTray()
  engine.start(VISIBLE_MS)
  if (smokeFile) {
    setTimeout(async () => {
      const s = engine.snapshot()
      const report = { ok: !s.error, error: s.error, platform: platform.caps.platformName, totalPhys: s.sys.totalPhys, used: s.sys.used, processes: s.processCount, apps: s.apps.length, packaged: app.isPackaged }
      fs.writeFileSync(smokeFile, JSON.stringify(report))
      // A picture of the window too, to confirm the interface itself loaded.
      if (win) fs.writeFileSync(smokeFile.replace(/\.json$/i, '') + '.png', (await win.webContents.capturePage()).toPNG())
      quit()
    }, 5000)
  }
  if (shotsDir && win) {
    const target = win
    target.webContents.once('did-finish-load', async () => {
      const { runShots } = await import('./devshots')
      await runShots(target, shotsDir).catch((e) => console.error('shots failed', e))
      engine.prepareQuit(true)
      quit()
    })
  }
}

function iconPath(file: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'), file)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0c0e',
    title: 'R.R.',
    icon: iconPath('icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0c0e', symbolColor: '#c9ccd1', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win?.show())
  win.on('show', () => engine.start(VISIBLE_MS))
  win.on('restore', () => engine.start(VISIBLE_MS))
  win.on('hide', () => engine.start(HIDDEN_MS))
  win.on('minimize', () => engine.start(HIDDEN_MS))
  // Windows is logging off or shutting down: no dialog, just record what stays in force.
  win.on('session-end', () => {
    engine.prepareQuit(false)
    quitting = true
  })
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    void requestQuit()
  })
  // External links open in the browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath('tray.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('R.R.')
  tray.on('click', showWindow)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open R.R.', click: showWindow },
      { type: 'separator' },
      { label: 'Quit R.R.', click: () => void requestQuit() }
    ])
  )
}

/**
 * Quitting with caps in force needs a decision: Windows keeps a job's cap on its processes after
 * R.R. closes its handle, and R.R. can't reach that job again once it has quit.
 */
async function requestQuit(): Promise<void> {
  const prompt = engine.quitPrompt()
  if (prompt.caps.length === 0) {
    engine.prepareQuit(false)
    return quit()
  }
  const list = prompt.caps.map((c) => `${c.name} (${formatBytes(c.bytes)})`).join(', ')
  const { response } = await dialog.showMessageBox(win!, {
    type: 'question',
    title: 'Caps stay in force after R.R. quits',
    message: 'Keep R.R. running so you can still change your caps?',
    detail:
      `Windows keeps these caps on the running apps after R.R. quits: ${list}.\n\n` +
      'Once R.R. has quit, it cannot change or lift them until those apps restart.',
    buttons: ['Keep R.R. in the tray', 'Lift caps and quit', 'Quit and keep caps'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  if (response === 0) {
    win?.hide()
    return
  }
  engine.prepareQuit(response === 1)
  quit()
}

function quit(): void {
  quitting = true
  engine.dispose()
  tray?.destroy()
  app.quit()
}

function push(s: Snapshot): void {
  if (tray && s.sys.totalPhys) {
    tray.setToolTip(`R.R.: ${formatBytes(s.sys.used)} in use (${formatPercent(s.sys.used / s.sys.totalPhys)})`)
  }
  if (win && !win.isDestroyed()) win.webContents.send('rr:snapshot', s)
}

/** Only R.R.'s own page may call into the main process. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? ''
  const dev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  return e.sender === win?.webContents && (url.startsWith('file://') || (!!dev && url.startsWith(dev)))
}

function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Refused: not R.R.’s window.')
    return fn(...args)
  })
}

function registerIpc(): void {
  handle('rr:caps', () => platform.caps)
  handle('rr:snapshot', () => engine.snapshot())
  handle('rr:detail', (key: string) => engine.appDetail(key))
  handle('rr:roaring:preview', () => engine.previewRoaring())
  handle('rr:roaring:run', (req: RoaringRequest) => engine.runRoaring(req))
  handle('rr:titan', (key: string) => engine.runTitan(key))
  handle('rr:close', (key: string) => engine.askToClose(key))
  handle('rr:seal:save', (input: SealInput) => engine.saveSeal(input))
  handle('rr:seal:remove', (key: string) => engine.removeSeal(key))
  handle('rr:seal:enabled', (key: string, enabled: boolean) => engine.setSealEnabled(key, enabled))
  handle('rr:waterline', (bytes: number | null) => engine.setWaterline(bytes))
  handle('rr:echoes:clear', () => engine.clearEchoes())
  handle('rr:icon', async (key: string) => {
    const file = engine.appPath(key)
    if (!file) return null
    try {
      return (await app.getFileIcon(file, { size: 'normal' })).toDataURL()
    } catch {
      return null
    }
  })
}

app.on('window-all-closed', () => {
  if (quitting) app.quit()
})
