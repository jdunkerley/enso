/**
 * @file Automatic updates through `electron-updater`, with GitHub Releases as the feed.
 *
 * The user is asked before anything downloads; a downloaded update installs on restart, or on the
 * next quit. See `docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md`.
 */
import type { AppUpdater } from 'electron-updater'
import type { UpdateMode, UpdateStatus } from 'enso-common/src/updater'

/** The slice of `electron-updater`'s `AppUpdater` the updater uses. */
export type AutoUpdaterLike = Pick<
  AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowPrerelease' | 'logger' | 'on'
> & {
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
}

/** What the {@link Updater} needs. */
export interface UpdaterDeps {
  readonly autoUpdater: AutoUpdaterLike
  readonly mode: UpdateMode
  /** Called on every status change, to forward it to the GUI. */
  readonly onStatus: (status: UpdateStatus) => void
}

/** Whether this run can update itself; see {@link UpdateMode}. */
export function resolveUpdateMode(
  buildMode: UpdateMode,
  environment: {
    isPackaged: boolean
    platform: NodeJS.Platform
    appImage: string | undefined
  },
): UpdateMode {
  if (buildMode === 'manual' || !environment.isPackaged) return 'manual'
  // On Linux only an AppImage can replace itself.
  if (environment.platform === 'linux' && environment.appImage == null) return 'manual'
  return 'auto'
}

/** Drives `electron-updater` and reports its progress as an {@link UpdateStatus}. */
export class Updater {
  readonly mode: UpdateMode
  private current: UpdateStatus = { state: 'idle' }

  /** Configures `autoUpdater` and subscribes to its events. */
  constructor(private readonly deps: UpdaterDeps) {
    this.mode = deps.mode
    const updater = deps.autoUpdater
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.logger = console
    updater.on('update-available', (info) => {
      this.set({
        state: 'available',
        version: info.version,
        releaseDate: info.releaseDate,
      })
    })
    updater.on('update-not-available', () => {
      this.set({ state: 'none' })
    })
    updater.on('download-progress', (progress) => {
      this.set({
        state: 'downloading',
        version: this.version() ?? '',
        percent: progress.percent,
      })
    })
    updater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version })
    })
    updater.on('error', (error) => {
      this.set({
        state: 'error',
        message: error.message,
        version: this.version(),
      })
    })
  }

  /** The latest status. */
  status(): UpdateStatus {
    return this.current
  }

  /** Looks for a newer release; never throws. Does nothing while downloading or once ready. */
  async check(allowPrerelease: boolean): Promise<UpdateStatus> {
    if (this.mode === 'manual') return this.current
    if (this.current.state === 'downloading' || this.current.state === 'ready') return this.current
    this.deps.autoUpdater.allowPrerelease = allowPrerelease
    this.set({ state: 'checking' })
    try {
      await this.deps.autoUpdater.checkForUpdates()
    } catch (error) {
      this.set({ state: 'error', message: messageOf(error), version: null })
    }
    return this.current
  }

  /** Downloads the available update; the outcome arrives as a status. Never throws. */
  async download(): Promise<void> {
    if (this.mode === 'manual') return
    const version = this.version()
    if (version == null) return
    this.set({ state: 'downloading', version, percent: 0 })
    try {
      await this.deps.autoUpdater.downloadUpdate()
    } catch (error) {
      this.set({ state: 'error', message: messageOf(error), version })
    }
  }

  /** Quits through the normal quit path, installs silently, then relaunches. */
  quitAndInstall(): void {
    if (this.mode === 'manual') return
    console.info('[Updater] Restarting to install the update.')
    this.deps.autoUpdater.quitAndInstall(true, true)
  }

  private version(): string | null {
    return 'version' in this.current ? this.current.version : null
  }

  private set(status: UpdateStatus) {
    this.current = status
    this.deps.onStatus(status)
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
