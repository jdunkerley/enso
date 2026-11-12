/**
 * @file Where the JDK AOT cache lives, when it trains, and which engine a Linux AppImage runs: kept
 * free of `electron` so it can be tested.
 */
import { PRODUCT_NAME } from 'enso-common/src/constants'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { readyStableEngine, stableEnginePath } from 'project-manager-shim/jvmAot'

/** The slice of the environment the cache's location depends on. */
type Env = Readonly<Record<string, string | undefined>>

/**
 * `ENSO_JVM_AOT_DIR` when it is set and not empty, else `jvm-aot` in the platform's local cache
 * directory, not Electron's `userData`: the cache is machine-specific and regenerable, and on
 * Windows `userData` is the roaming profile, which a domain would sync at every sign-in (#682).
 * Windows `%LOCALAPPDATA%\Enso`, macOS `~/Library/Caches/Enso`, else `$XDG_CACHE_HOME/enso` or
 * `~/.cache/enso`.
 */
export function jvmAotRootDirectory(
  env: Env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.ENSO_JVM_AOT_DIR) return env.ENSO_JVM_AOT_DIR
  switch (platform) {
    case 'win32':
      return path.win32.join(
        env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
        PRODUCT_NAME,
        'jvm-aot',
      )
    case 'darwin':
      return path.posix.join(home, 'Library', 'Caches', PRODUCT_NAME, 'jvm-aot')
    default:
      return path.posix.join(
        env.XDG_CACHE_HOME || path.posix.join(home, '.cache'),
        PRODUCT_NAME.toLowerCase(),
        'jvm-aot',
      )
  }
}

/**
 * Removes the cache an earlier IDE kept at `<userData>/jvm-aot` (#682), unless that is where the
 * cache now is (`ENSO_JVM_AOT_DIR` names it). Best effort: a failure is logged, never thrown.
 * Answers whether a directory was removed.
 */
export async function removeLeftoverJvmAotCache(
  env: Env,
  userData: string,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): Promise<boolean> {
  try {
    const leftover = path.join(userData, 'jvm-aot')
    if (path.resolve(leftover) === path.resolve(jvmAotRootDirectory(env, platform, home))) {
      return false
    }
    const stat = await fs.stat(leftover).catch(() => undefined)
    if (stat == null) return false
    await fs.rm(leftover, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    console.info(`JDK AOT cache: removed the old cache at ${leftover}; it now lives elsewhere.`)
    return true
  } catch (error) {
    console.info('JDK AOT cache: could not remove the old cache:', error)
    return false
  }
}

/**
 * Whether the IDE keeps a JDK AOT cache at all: `ENSO_JVM_AOT=0` turns it off (no training, no
 * cache used), as `ENSO_SPARE_ENGINE=0` does the spare engine. The package tests set it: a training
 * on CI's two CPUs slows every open, and each open kills it, so it would never finish anyway.
 */
export function isJvmAotEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.ENSO_JVM_AOT !== '0'
}

/** What a Linux AppImage does about its engine at launch ({@link appImageEngine}). */
export interface AppImageEngine {
  /** The copy's launcher, for the project service and the AOT cache, when a complete copy exists. */
  readonly enginePath?: string
  /** Makes the copy, used from the next launch on; called once the window is up. */
  readonly startCopy?: () => Promise<string>
}

/**
 * Whether `enginePath` is inside one of this IDE's own engine copies (`<userData>/engine/`). Such
 * an `ENSO_ENGINE_PATH` is not the user's: an earlier IDE that put its copy in the environment
 * passed it on to the relaunch after an in-app update, where it would run the old version's engine.
 */
export function isEngineCopyPath(enginePath: string, userData: string): boolean {
  const relative = path.relative(path.join(userData, 'engine'), enginePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Under a Linux AppImage (`APPIMAGE` set), with no `ENSO_ENGINE_PATH` of the user's, the engine to run is a copy of
 * the bundled one at `<userData>/engine/<version>/` (an `ENSO_ENGINE_PATH` inside
 * `<userData>/engine/` is inherited, not the user's: {@link isEngineCopyPath}), whose path, unlike the AppImage's mount, is
 * the same at every launch (`project-manager-shim/jvmAot`, `stableEngine.ts`). When there is no
 * complete copy of this build yet, this launch runs the mounted engine (without an AOT cache) and
 * `startCopy` makes the copy in the background, so the window does not wait for 1.8 GB.
 *
 * The path is returned, never put in the environment: an in-app update relaunches the new
 * AppImage with this process's environment, and the new version would run this one's copy.
 */
export async function appImageEngine(
  env: Readonly<Record<string, string | undefined>>,
  settings: { readonly resourcesPath: string; readonly userData: string; readonly version: string },
): Promise<AppImageEngine> {
  const usersEngine =
    env.ENSO_ENGINE_PATH && !isEngineCopyPath(env.ENSO_ENGINE_PATH, settings.userData)
  if (!env.APPIMAGE || usersEngine) return {}
  const options = {
    userData: settings.userData,
    version: settings.version,
    bundleRoot: path.join(settings.resourcesPath, 'enso'),
  }
  const enginePath = await readyStableEngine(options)
  if (enginePath != null) return { enginePath }
  return { startCopy: () => stableEnginePath(options) }
}

/**
 * Holds a task (a Linux AppImage's engine copy, 1.8 GB read through the AppImage's mount) back
 * until the first project open has been answered, or `delayMs` after it is scheduled when no open
 * has started by then, and never while an open is in flight, so that the copy does not compete with
 * the first open for the AppImage's mount (PR #612's review, I3). It runs at most once.
 */
export class AfterFirstOpen {
  private inFlight = 0
  private answered = false
  private delayed = false
  private task: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  /** `delayMs`: how long to wait for a first open. */
  constructor(private readonly delayMs: number) {}

  /** Run `task` once the conditions above hold. */
  schedule(task: () => void): void {
    this.task = task
    this.timer = setTimeout(() => {
      this.delayed = true
      this.runIfIdle()
    }, this.delayMs)
    this.runIfIdle()
  }

  /** An open started: the task waits for it. */
  openStarted(): void {
    this.inFlight += 1
  }

  /** An open was answered (or failed): the task may run. */
  openAnswered(): void {
    this.inFlight = Math.max(0, this.inFlight - 1)
    this.answered = true
    this.runIfIdle()
  }

  private runIfIdle(): void {
    if (this.task == null || this.inFlight > 0 || !(this.answered || this.delayed)) return
    const task = this.task
    this.task = undefined
    clearTimeout(this.timer)
    task()
  }
}
