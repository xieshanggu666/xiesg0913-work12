import { BrowserWindow, app, dialog, ipcMain, session } from 'electron'
import { basename, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  deleteExperiment,
  deletePreset,
  deleteSnapshot,
  insertExperiment,
  insertPreset,
  insertSnapshot,
  listExperiments,
  listPresets,
  listSnapshots,
  openDatabase,
  updateExperimentConclusion
} from './db'
import type { ExportResult, ImportFileResult } from '../shared/types'
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0d11',
    title: '琉璃工房 Glass Forge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('pn:snapshots:list', () => listSnapshots())
  ipcMain.handle('pn:snapshots:save', (_e, record) => insertSnapshot(record))
  ipcMain.handle('pn:snapshots:delete', (_e, id: number) => deleteSnapshot(id))
  ipcMain.handle('pn:presets:list', () => listPresets())
  ipcMain.handle('pn:presets:save', (_e, record) => insertPreset(record))
  ipcMain.handle('pn:presets:delete', (_e, id: number) => deletePreset(id))
  ipcMain.handle('pn:experiments:list', () => listExperiments())
  ipcMain.handle('pn:experiments:save', (_e, record) => insertExperiment(record))
  ipcMain.handle(
    'pn:experiments:conclusion',
    (_e, id: number, conclusion: string) => updateExperimentConclusion(id, conclusion)
  )
  ipcMain.handle('pn:experiments:delete', (_e, id: number) => deleteExperiment(id))
  ipcMain.handle(
    'pn:storyboard:export',
    async (_e, dataUrl: string, defaultName: string): Promise<ExportResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '导出制作分镜',
        defaultPath: join(app.getPath('pictures'), defaultName),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true, error: '已取消' }
      try {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
        writeFileSync(filePath, Buffer.from(base64, 'base64'))
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle(
    'pn:trajectory:export',
    async (_e, json: string, defaultName: string): Promise<ExportResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '导出成形轨迹',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'JSON 轨迹', extensions: ['json'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true, error: '已取消' }
      try {
        writeFileSync(filePath, json, 'utf8')
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle('pn:trajectory:import', async (): Promise<ImportFileResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: '导入成形轨迹',
      filters: [{ name: 'JSON 轨迹', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }
    const filePath = filePaths[0]
    try {
      const text = readFileSync(filePath, 'utf8')
      return { ok: true, name: basename(filePath), text }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle(
    'pn:annotations:export',
    async (_e, json: string, defaultName: string): Promise<ExportResult> => {
      const win = BrowserWindow.getFocusedWindow() ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '导出帧标注',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'JSON 标注', extensions: ['json'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true, error: '已取消' }
      try {
        writeFileSync(filePath, json, 'utf8')
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle('pn:annotations:import', async (): Promise<ImportFileResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: '导入帧标注',
      filters: [{ name: 'JSON 标注', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true }
    const filePath = filePaths[0]
    try {
      const text = readFileSync(filePath, 'utf8')
      return { ok: true, name: basename(filePath), text }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

function registerCsp(): void {
  // 生产严格 CSP；开发态放行 vite HMR（ws + unsafe-eval）
  const prod =
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
  const dev =
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; connect-src 'self' ws:"
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [app.isPackaged ? prod : dev]
      }
    })
  })
}

app.whenReady().then(() => {
  registerCsp()
  openDatabase()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
