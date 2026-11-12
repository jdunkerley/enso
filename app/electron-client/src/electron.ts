import { initAiMcpServer, initClaudeAgentIpc } from '@/ai/claudeAgent'
import { Channel } from '@/ipc'
import { initJvmAotIpc } from '@/jvmAotIpc'
import { resolveLogFileToReveal } from '@/logFileReveal'
import * as paths from '@/paths'
import {
  getLocalSecrets,
  getSecretsKeySource,
  hasRunningProjects,
  refreshSpareEngine,
  stopSpareEngine,
} from '@/projectService'
import { resetSecrets, rotateSecretsKey } from '@/secretsKey'
import { initUpdaterIpc } from '@/updaterIpc'
import { clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { download } from 'electron-dl'
import electronUpdater from 'electron-updater'
import type { DownloadUrlOptions } from 'enso-common/src/download'
import { unlinkSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import {
  getEngineLogDirectory,
  importProjectFromPath,
  isProjectBundle,
  isProjectRoot,
} from 'project-manager-shim'
import BUILD_INFO from '../buildInfo'
import { toElectronFileFilter, type FileFilter } from './fileBrowser'

export type Electron = typeof import('electron')

/**
 * Set Chrome options based on the app configuration. For comprehensive list of available
 * Chrome options refer to: https://peter.sh/experiments/chromium-command-line-switches.
 */
export function setChromeOptions(electron: Electron) {
  // Note [The Packaged-IDE Tests Run Without GPU Acceleration].
  if (process.env.ENSO_TEST_DISABLE_GPU === '1') electron.app.disableHardwareAcceleration()
}

/* Note [The Packaged-IDE Tests Run Without GPU Acceleration]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The Windows CI runner has no GPU. The app then passed `ignore-gpu-blocklist`, so the GPU process
 * still accelerated, in software, and while the project view's spinners turned it used 1,300 to
 * 2,200 s of CPU in a ~12-minute try, against ~50 s for the engine's JVM, which then never finished
 * its first execution (#674: `Project Duplicate` hung in most runs, and the job hit its time limit).
 * With `disableHardwareAcceleration()` the same suite passed in 29 s. That switch is gone (#688):
 * Chromium's blocklist now decides, as in any browser, so a machine without a usable GPU (a VM, an
 * RDP session) should fall back to its cheaper software path by itself. The Playwright fixture
 * (`tests/electronTest.ts`) still sets `ENSO_TEST_DISABLE_GPU=1` for every spec, so the tests do
 * not depend on that; nothing else sets it.
 */

/** Register keyboard shortcuts that should be handled by Electron. */
export function registerShortcuts(electron: Electron) {
  electron.app.on('web-contents-created', (_webContentsCreatedEvent, webContents) => {
    webContents.on('before-input-event', (_beforeInputEvent, input) => {
      const { code, alt, control, shift, meta, type } = input
      if (type === 'keyDown') {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow()
        if (focusedWindow) {
          if (control && alt && shift && !meta && code === 'KeyI') {
            focusedWindow.webContents.toggleDevTools()
          }
          if (control && alt && shift && !meta && code === 'KeyR') {
            focusedWindow.reload()
          }
        }
      }
    })
  })
}

/**
 * Initialize Inter-Process Communication between the Electron application and the served
 * website.
 */
export function initIpc(
  window: BrowserWindow | null,
  electron: Electron | undefined,
  electronIsDev: boolean,
) {
  // The installer must not meet a spare engine still holding the engine's files.
  initUpdaterIpc(BUILD_INFO.updates, electronUpdater.autoUpdater, stopSpareEngine)
  initJvmAotIpc()
  // The key is written to the clipboard here, in main: it never crosses into the renderer.
  ipcMain.handle(Channel.secretsCopyKey, () => {
    const key = getSecretsKeySource().exportKey()
    if (key == null) return false
    clipboard.writeText(key)
    return true
  })
  // Both refuse while an engine runs: it holds the old key and could write under it afterwards.
  ipcMain.handle(Channel.secretsReset, () =>
    resetSecrets({
      keySource: getSecretsKeySource(),
      store: getLocalSecrets(),
      hasRunningProjects,
      afterKeyChange: refreshSpareEngine,
    }),
  )
  ipcMain.handle(Channel.secretsRotate, () =>
    rotateSecretsKey({
      keySource: getSecretsKeySource(),
      store: getLocalSecrets(),
      hasRunningProjects,
      afterKeyChange: refreshSpareEngine,
    }),
  )
  ipcMain.on(Channel.error, (_event, data) => {
    console.error(...data)
  })
  ipcMain.on(Channel.warn, (_event, data) => {
    console.warn(...data)
  })
  ipcMain.on(Channel.log, (_event, data) => {
    console.log(...data)
  })
  ipcMain.on(Channel.info, (_event, data) => {
    console.info(...data)
  })
  ipcMain.on(
    Channel.importProjectFromPath,
    (event, path: string, directory: string | null, title: string) => {
      const directoryParams = directory == null ? [] : [directory]
      const info = importProjectFromPath(path, ...directoryParams, title)
      event.reply(Channel.importProjectFromPath, path, info)
    },
  )
  ipcMain.handle(Channel.downloadURL, async (_event, options: DownloadUrlOptions) => {
    const { url, path, name, shouldUnpackProject, showFileDialog } = options
    // This should never happen, but we'll check for it anyway.
    if (!window) {
      throw new Error('Window is not available.')
    }

    await download(window, url, {
      ...(path != null ? { directory: path } : {}),
      ...(name != null ? { filename: name } : {}),
      saveAs: showFileDialog != null ? showFileDialog : path == null,
      onCompleted: (file) => {
        const path = file.path
        const filenameRaw = basename(path)

        try {
          if (isProjectBundle(path) || isProjectRoot(path)) {
            if (!shouldUnpackProject) {
              return
            }
            // in case we're importing a project bundle, we need to remove the extension
            // from the filename
            const filename = filenameRaw.replace(extname(filenameRaw), '')
            const directory = dirname(path)

            importProjectFromPath(path, directory, filename)
            unlinkSync(path)
          }
        } catch (error) {
          console.error('Error downloading URL', error)
        }
      },
    })

    return
  })
  ipcMain.on(Channel.showItemInFolder, (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath)
  })
  ipcMain.on(Channel.showLogFileInFolder, (_event, requested: unknown) => {
    const decision = resolveLogFileToReveal(requested, getEngineLogDirectory())
    if (decision.ok) shell.showItemInFolder(decision.file)
    else console.warn(`Refusing to reveal a log file (${decision.reason}):`, requested)
  })
  ipcMain.handle(
    Channel.openFileBrowser,
    async (
      _event,
      kind: 'default' | 'directory' | 'file' | 'filePath',
      defaultPath?: string,
      filters?: FileFilter[],
    ) => {
      console.log('Request for opening browser for ', kind, defaultPath, JSON.stringify(filters))
      let retval = null
      if (kind === 'filePath') {
        // "Accept", as the file won't be created immediately.
        const { canceled, filePath } = await dialog.showSaveDialog({
          buttonLabel: 'Accept',
          filters: filters?.map(toElectronFileFilter) ?? [],
          ...(defaultPath != null ? { defaultPath } : {}),
        })
        if (!canceled) {
          retval = [filePath]
        }
      } else {
        /** Helper for `showOpenDialog`, which has weird types by default. */
        type Properties = ('openDirectory' | 'openFile')[]
        const properties: Properties =
          kind === 'file' ? ['openFile']
          : kind === 'directory' ? ['openDirectory']
          : process.platform === 'darwin' ? ['openFile', 'openDirectory']
          : ['openFile']
        const { canceled, filePaths } = await dialog.showOpenDialog({
          properties,
          filters: filters?.map(toElectronFileFilter) ?? [],
          ...(defaultPath != null ? { defaultPath } : {}),
        })
        if (!canceled) {
          retval = filePaths
        }
      }
      return retval
    },
  )

  // Fire-and-forget: the MCP server's HTTP listener boots async, but startup must not block on it.
  void (async () => {
    const stdlibRoot = paths.stdlibRoot(electron, electronIsDev)
    const mcpConfigPath = await initAiMcpServer()
    initClaudeAgentIpc({ stdlibRoot, mcpConfigPath })
  })()

  // Handling navigation events from renderer process
  ipcMain.on(Channel.goBack, () => {
    window?.webContents.navigationHistory.goBack()
  })

  ipcMain.on(Channel.goForward, () => {
    window?.webContents.navigationHistory.goForward()
  })
}
