/**
 * @file Automatic updates through `electron-updater`, with GitHub Releases as the feed.
 *
 * The user is asked before anything downloads; a downloaded update installs on restart, or on the
 * next quit. See `docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md`.
 */
import type { AppUpdater } from 'electron-updater'
import { UPDATE_REPOSITORY, type UpdateMode, type UpdateStatus } from 'enso-common/src/updater'

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
  /**
   * Whether the repository has no stable release, for a stable check that failed in a way that
   * could mean so ({@link mayMeanNoStableRelease}); see {@link confirmNoStableRelease}, the default.
   */
  readonly confirmNoStableRelease?: (allowCached: boolean) => Promise<boolean>
  /**
   * Awaited before the installer starts: on Windows it starts before the app quits, and must not
   * meet a spare engine that still holds the engine's files (`stopSpareEngine`). Its failure does
   * not stop the install.
   */
  readonly beforeInstall?: () => Promise<void>
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
      if (mayMeanNoStableRelease(error)) return
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
      if (await this.isNoStableRelease(error)) this.set({ state: 'none' })
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
   * a stable release. The check fails only when both passes do:
   *
   * - a stable pass that finds no stable release ({@link isNoStableRelease}) is not a failure;
   * - after a prerelease failure, a stable failure is an error: the prerelease one, unless that
   *   only said nothing was published, when it is the stable one;
   * - a prerelease failure that is a real one (a broken release, say) followed by "no stable
   *   release" ends as `none`, with a warning in the log, since the stable feed had nothing to add;
   * - a stable failure after a clean prerelease pass is `none`.
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
      console.info('[Updater] The stable-release check failed:', messageOf(error))
      if (await this.isNoStableRelease(error)) {
        if (prereleaseError != null && !isNothingPublished(prereleaseError))
          console.warn(
            '[Updater] No stable release, and the prerelease check failed:',
            messageOf(prereleaseError),
          )
      } else if (prereleaseError != null)
        throw isNothingPublished(prereleaseError) ? error : prereleaseError
    } finally {
      this.pass = 'single'
      autoUpdater.allowPrerelease = true
    }
  }

  /**
   * Whether a failed stable check means the repository has no stable release, which is "no
   * update", not a failure. `electron-updater` wraps every failure of its `/releases/latest`
   * request alike, and on github.com that request does not even answer 404 when there is no stable
   * release (a redirect to a page that answers 406), so the status in the message proves nothing:
   * the GitHub API is asked, and only its 404 counts.
   */
  private async isNoStableRelease(error: unknown) {
    if (!mayMeanNoStableRelease(error)) return false
    try {
      // An answer from a minute ago stands only for the same kind of failure: a feed that was
      // not found. Anything else (offline, say) is looked at afresh, and without an answer is an error.
      return await (this.deps.confirmNoStableRelease ?? confirmNoStableRelease)(
        isFeedNotFound(error),
      )
    } catch {
      return false
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

  /**
   * Quits through the normal quit path, installs silently, then relaunches; once
   * {@link UpdaterDeps.beforeInstall} has settled.
   */
  async quitAndInstall(): Promise<void> {
    if (this.mode === 'manual') return
    console.info('[Updater] Restarting to install the update.')
    try {
      await this.deps.beforeInstall?.()
    } catch (error) {
      console.warn('[Updater] Preparing the install failed; installing anyway:', error)
    }
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

/** The codes of the errors `electron-updater` throws when a feed holds no release for it. */
const NOTHING_PUBLISHED_CODES = [
  // The prerelease feed has entries, but none of the current channel.
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  // The prerelease feed has no entry at all (`feed.element('entry', false, 'No published versions…')`).
  'ERR_XML_MISSED_ELEMENT',
]

function codeOf(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

/** Whether a prerelease check failed only because the feed has nothing for this channel. */
function isNothingPublished(error: unknown) {
  return NOTHING_PUBLISHED_CODES.includes(codeOf(error) as string)
}

/**
 * Whether a failed stable check is the feed not being found: the request got an HTTP error answer
 * (`HttpError: 406 Not Acceptable`), not a network failure such as `ENOTFOUND`.
 */
function isFeedNotFound(error: unknown) {
  return (
    (codeOf(error) === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
      codeOf(error) === 'ERR_UPDATER_INVALID_RELEASE_FEED') &&
    error instanceof Error &&
    /HttpError: \d{3}\b/.test(error.message)
  )
}

/**
 * Whether a failed stable check could be down to there being no stable release: the code
 * `electron-updater` gives every failure of the `/releases/latest` request, or a feed with
 * nothing in it. Whether it is must be confirmed, see {@link Updater.isNoStableRelease}.
 */
function mayMeanNoStableRelease(error: unknown) {
  return (
    isNothingPublished(error) ||
    // What a stable check of a fork with no stable release really throws on github.com: the
    // `/releases/latest` request fails with a 406, which the provider wraps as the first, and
    // then, as it parses the feed it gets in the same `try`, as the second.
    codeOf(error) === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ||
    codeOf(error) === 'ERR_UPDATER_INVALID_RELEASE_FEED'
  )
}

const NO_STABLE_RELEASE_CACHE_MS = 10 * 60 * 1000
let noStableReleaseConfirmedAt = 0

/**
 * Asks the GitHub API whether the repository has a stable release: `true` when
 * `/releases/latest` answers 404, `false` for any other answer or no answer (offline,
 * rate-limited). With `allowCached`, a 404 seen in the last ten minutes stands, so that repeated
 * checks cost one request; a stable release published since is found by the next check after that.
 */
export async function confirmNoStableRelease(allowCached = false): Promise<boolean> {
  if (allowCached && Date.now() - noStableReleaseConfirmedAt < NO_STABLE_RELEASE_CACHE_MS)
    return true
  const response = await fetchThroughElectron(
    `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`,
    {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    },
  )
  const answer = response.status === 404
  noStableReleaseConfirmedAt = answer ? Date.now() : 0
  return answer
}

/**
 * `fetch` through Electron's network stack, which honours the system proxy as `electron-updater`
 * does; plain `fetch` outside Electron (tests).
 */
async function fetchThroughElectron(url: string, init: RequestInit) {
  let electronNet: typeof import('electron').net | undefined
  try {
    electronNet = (await import('electron')).net
  } catch {
    // Not running in Electron.
  }
  return electronNet?.fetch != null ? electronNet.fetch(url, init) : fetch(url, init)
}
