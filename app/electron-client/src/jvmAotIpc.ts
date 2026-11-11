/**
 * @file Tells the GUI about the JDK AOT cache's training (`project-manager-shim/jvmAot`): a status
 * that a window can query when it loads, and a broadcast whenever it changes.
 */
import { Channel } from '@/ipc'
import { ipcMain, webContents } from 'electron'
import type { JvmAotTrainingStatus } from 'enso-common/src/jvmAot'

let status: JvmAotTrainingStatus = 'idle'

/** This launch's training status, as the GUI's query gets it. */
export function jvmAotTrainingStatus(): JvmAotTrainingStatus {
  return status
}

/** Record a new training status and send it to every window; a repeated status sends nothing. */
export function setJvmAotTrainingStatus(next: JvmAotTrainingStatus): void {
  if (next === status) return
  status = next
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    try {
      contents.send(Channel.jvmAotTrainingStatusChanged, next)
    } catch {
      // Renderer destroyed mid-send; it asks for the status when it loads again.
    }
  }
}

/** Register the query of the training status. */
export function initJvmAotIpc(): void {
  ipcMain.handle(Channel.jvmAotTrainingStatus, () => status)
}
