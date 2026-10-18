/** @file Exposes the {@link Updater} to the GUI over IPC. */
import { Channel } from '@/ipc'
import { resolveUpdateMode, Updater, type AutoUpdaterLike } from '@/updater'
import { app, ipcMain, webContents } from 'electron'
import type { UpdateMode, UpdateStatus } from 'enso-common/src/updater'

function broadcast(status: UpdateStatus) {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    try {
      contents.send(Channel.updaterStatus, status)
    } catch {
      // Renderer destroyed mid-send; the next status will skip it.
    }
  }
}

/** Creates the updater and registers its IPC handlers. `autoUpdater` is a parameter for tests. */
export function initUpdaterIpc(buildMode: UpdateMode, autoUpdater: AutoUpdaterLike) {
  const mode = resolveUpdateMode(buildMode, {
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
  })
  console.info(`[Updater] Mode: ${mode}.`)
  const updater = new Updater({ autoUpdater, mode, onStatus: broadcast })
  ipcMain.handle(Channel.updaterMode, () => updater.mode)
  ipcMain.handle(Channel.updaterCheck, (_event, allowPrerelease: boolean) =>
    updater.check(allowPrerelease === true),
  )
  ipcMain.handle(Channel.updaterDownload, () => updater.download())
  ipcMain.handle(Channel.updaterQuitAndInstall, () => {
    updater.quitAndInstall()
  })
}
