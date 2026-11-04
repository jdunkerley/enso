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
  /** Which pass of {@link check} is running; see {@link checkWithStableFallback}. */
  private pass: 'single' | 'prerelease' | 'stable' = 'single'

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
      // A prerelease pass that finds nothing is followed by the stable pass, which decides.
      if (this.pass === 'prerelease') return
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
      // A downloaded update installs on quit whatever happens afterwards.
      if (this.current.state === 'ready') return
      // The passes of a prerelease check report through the rejection, which
      // `checkWithStableFallback` weighs: a failed pass is not yet an error, and a failed stable
      // fallback is `none`.
      if (this.pass !== 'single') return
      // A repository with no stable release is simply up to date; `check` sets `none`.
      if (isNothingPublished(error)) return
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
    if (
      this.current.state === 'checking' ||
      this.current.state === 'downloading' ||
      this.current.state === 'ready'
    )
      return this.current
    this.set({ state: 'checking' })
    try {
      if (allowPrerelease) await this.checkWithStableFallback()
      else {
        this.deps.autoUpdater.allowPrerelease = false
        await this.deps.autoUpdater.checkForUpdates()
      }
      // No event fires when the updater is inactive.
      if (this.status().state === 'checking') this.set({ state: 'none' })
    } catch (error) {
      if (isNothingPublished(error)) this.set({ state: 'none' })
      else this.fail(error, null)
    }
    return this.current
  }

  /**
   * Checks including prereleases, then, if that finds nothing or throws, for stable releases only.
   *
   * `electron-updater`'s GitHub provider takes the channel from the current version, so an
   * `rc` install with `allowPrerelease` matches only `rc` tags and is never offered a stable
   * release. Without `allowPrerelease` it asks GitHub for `/releases/latest`, which is the newest
   * stable release. Setting `channel` instead would also enable `allowDowngrade`.
   *
   * The prerelease pass can throw (`ERR_UPDATER_NO_PUBLISHED_VERSIONS`, say), which must not hide
   * a stable release. The check fails only when both passes do: the stable pass failing for a
   * reason other than there being no stable release (see {@link isNothingPublished}), after the
   * prerelease pass threw as well. A stable pass failing after a clean prerelease pass is `none`.
   */
  private async checkWithStableFallback() {
    const autoUpdater = this.deps.autoUpdater
    let prereleaseError: unknown = null
    autoUpdater.allowPrerelease = true
    this.pass = 'prerelease'
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      prereleaseError = error
      console.info('[Updater] The prerelease check failed:', messageOf(error))
    } finally {
      this.pass = 'single'
    }
    if (this.current.state !== 'checking') return
    autoUpdater.allowPrerelease = false
    this.pass = 'stable'
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // A fork with no stable release yet answers 404; there is simply nothing newer.
      console.info('[Updater] The stable-release check failed:', messageOf(error))
      if (prereleaseError != null && !isNothingPublished(error)) throw prereleaseError
    } finally {
      this.pass = 'single'
      autoUpdater.allowPrerelease = true
    }
  }

  /** Downloads the available update; the outcome arrives as a status. Never throws. */
  async download(): Promise<void> {
    if (this.mode === 'manual') return
    const version = this.version()
    if (version == null) return
    if (this.current.state !== 'available' && this.current.state !== 'error') return
    this.set({ state: 'downloading', version, percent: 0 })
    try {
      await this.deps.autoUpdater.downloadUpdate()
    } catch (error) {
      this.fail(error, version)
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

  /** Publishes a rejection, unless the `error` event already did. */
  private fail(error: unknown, version: string | null) {
    const message = messageOf(error)
    if (this.current.state === 'ready') return
    if (this.current.state === 'error' && this.current.message === message) return
    this.set({ state: 'error', message, version })
  }

  private set(status: UpdateStatus) {
    this.current = status
    this.deps.onStatus(status)
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a check failed because the repository has nothing to offer, which is "no update", not a
 * failure: no published versions at all, or (the stable feed asks `/releases/latest`) no stable
 * release, which GitHub answers with 404. `electron-updater` wraps every failure of that request in
 * `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`, so an offline machine is told apart by the missing 404.
 */
function isNothingPublished(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = 'code' in error ? error.code : undefined
  return (
    code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' ||
    (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' && /\b404\b/.test(error.message))
  )
}
