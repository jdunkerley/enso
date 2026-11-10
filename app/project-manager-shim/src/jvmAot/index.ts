/**
 * @file The per-user JDK AOT cache (spec, stage 1d "The AOT cache lifecycle"): trained in the
 * background at app launch when the JVM is the default engine, killed by any open and restarted
 * 60 s after the last one was answered, used by every JVM engine once it exists, and deleted when a
 * JVM says it does not match.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { aotKey, enginePaths, isAppImageMount, isTranslocated, readJvmOptionsText } from './key.js'
import { acquireTrainingLock } from './lock.js'
import { EngineTrainer, type Trainer } from './trainer.js'
import { aotRejection } from './useLog.js'

export {
  aotCreateArguments,
  jvmOptionsValue,
  LAUNCHER_JVM_OPTIONS,
  parseJvmOptionsFile,
  splitJvmOptions,
} from '../projectService/jvmOptions.js'
export { driveOpen, welcomeNodeId } from './driver.js'
export { aotKey, enginePaths, isAppImageMount, isTranslocated, readJvmOptionsText } from './key.js'
export { acquireTrainingLock } from './lock.js'
export {
  readyStableEngine,
  stableEnginePath,
  SYSTEM_HOOKS,
  type StableEngineHooks,
  type StableEngineOptions,
} from './stableEngine.js'
export { EngineTrainer, type Trainer } from './trainer.js'
export { aotRejection } from './useLog.js'

export interface JvmAotCacheSettings {
  /** `<userData>/jvm-aot`, or `ENSO_JVM_AOT_DIR`. */
  readonly rootDirectory: string
  readonly appVersion: string
  /** The bundled engine's launcher (`<resources>/enso/dist/<version>/bin/enso`). */
  readonly ensoExecutable: string
  /** Whether the JVM is the resolved default engine (`resolveDefaultEngineMode`). */
  readonly isJvmDefault: () => boolean
  /** How long after the last open was answered a killed training restarts: 60 s. */
  readonly retrainDelayMs?: number
  /**
   * Told once `start()` has found that a training is needed (no cache for the key): from then on
   * the cache is being prepared, through any open that stops the training, until
   * `onTrainingEnded`. Not told when the cache is already there.
   */
  readonly onTrainingStarted?: () => void
  /**
   * Told when a training has ended, with the cache written (`trained`, also when another process
   * made it) or failed, but not when an open stopped it: no spare engine starts while one runs
   * (`isTraining`), so it is refreshed then.
   */
  readonly onTrainingEnded?: (outcome: JvmAotTrainingOutcome) => void
}

/** How a training ended: a cache was made (here or by another process), or none will be this launch. */
export type JvmAotTrainingOutcome = 'trained' | 'failed'

const CACHE_FILE = 'enso.aot'
const USE_LOG_FILE = 'use.log'
/** The trainer's scratch project, beside the key directories. */
const SCRATCH_DIRECTORY = 'enso-aot-training'
/** A key directory's name (`aotKey`). Nothing else in the root is ever deleted. */
const KEY_DIRECTORY = /^[0-9a-f]{16}$/
/**
 * How many key directories a finished training keeps: its own and the most recently used other
 * one, so two installs that share `userData` (a release and a nightly) do not delete each other's
 * cache at every launch.
 */
const KEYS_KEPT = 2

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * When the key directory was last used: its `use.log` (rewritten by every JVM that used the cache)
 * or, failing that, its `enso.aot`.
 */
async function lastUsed(directory: string): Promise<number> {
  for (const file of [USE_LOG_FILE, CACHE_FILE]) {
    try {
      return (await fs.stat(path.join(directory, file))).mtimeMs
    } catch {
      // Try the next.
    }
  }
  return (await fs.stat(directory)).mtimeMs
}

/** The cache of one installation for one user. */
export class JvmAotCache {
  private readonly trainer: Trainer
  private keyDirectoryPromise: Promise<string | undefined> | undefined
  /** Training is needed: started at launch, and not yet finished. */
  private wanted = false
  private training:
    { readonly controller: AbortController; readonly done: Promise<void> } | undefined
  /** A training being started (waiting for the lock): an open in between must stop it too. */
  private starting: Promise<void> | undefined
  private opensInFlight = 0
  private retrainTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /** `start()` is looking for the cache: a training may follow. */
  private checkingAtLaunch = false

  /** The trainer defaults to an {@link EngineTrainer} with its scratch project in `<root>/enso-aot-training`. */
  constructor(
    private readonly settings: JvmAotCacheSettings,
    trainer?: Trainer,
  ) {
    this.trainer =
      trainer ??
      new EngineTrainer({
        ensoExecutable: settings.ensoExecutable,
        scratchRoot: path.join(settings.rootDirectory, SCRATCH_DIRECTORY),
      })
  }

  /**
   * The current key's directory: `<root>/<key>`, or `undefined` when there is no cache for this
   * engine (a development build with no bundled runtime, a macOS translocated app, or an engine
   * in a Linux AppImage's mount).
   */
  keyDirectory(): Promise<string | undefined> {
    this.keyDirectoryPromise ??= (async () => {
      const paths = await enginePaths(this.settings.ensoExecutable)
      if (paths == null || isTranslocated(paths.engineRoot) || isAppImageMount(paths.engineRoot)) {
        return undefined
      }
      const key = aotKey({
        appVersion: this.settings.appVersion,
        engineRoot: paths.engineRoot,
        runtimeRoot: paths.runtimeRoot,
        jvmOptionsText: await readJvmOptionsText(paths.engineRoot),
      })
      return path.join(this.settings.rootDirectory, key)
    })()
    return this.keyDirectoryPromise
  }

  private async cacheFile(): Promise<string | undefined> {
    const directory = await this.keyDirectory()
    return directory != null ? path.join(directory, CACHE_FILE) : undefined
  }

  /** At app launch: train when JVM is the default, there is no cache for the key, and no other window trains. */
  async start(): Promise<void> {
    if (this.disposed || !this.settings.isJvmDefault()) return
    this.checkingAtLaunch = true
    try {
      const cache = await this.cacheFile()
      if (cache == null) return
      // A training interrupted by a quit can leave its files (the next training deletes them too).
      await this.deleteLeftovers(cache)
      if (await exists(cache)) return
      this.wanted = true
    } finally {
      this.checkingAtLaunch = false
    }
    this.settings.onTrainingStarted?.()
    await this.beginTraining()
  }

  /** Start a training, unless one runs, an open is in flight, or another process holds the lock. */
  private beginTraining(): Promise<void> {
    this.starting ??= this.tryBeginTraining()
      .catch((error: unknown) => this.startFailed(error))
      .finally(() => (this.starting = undefined))
    return this.starting
  }

  /**
   * A training that could not start (a lock release or a file check threw) ends like a failed one,
   * so that `onTrainingEnded` still comes after `onTrainingStarted`. Nothing to do when a training
   * runs (its own end is announced) or the end was already announced.
   */
  private startFailed(error: unknown): void {
    if (this.training != null || !this.wanted) return
    this.wanted = false
    console.error(
      'JDK AOT cache: training could not start; trying again at the next launch:',
      error,
    )
    if (!this.disposed) this.announceEnded('failed')
  }

  private async tryBeginTraining(): Promise<void> {
    if (this.disposed || !this.wanted || this.training != null || this.opensInFlight > 0) return
    const directory = await this.keyDirectory()
    if (directory == null) return
    const cache = path.join(directory, CACHE_FILE)
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquireTrainingLock(this.settings.rootDirectory)
    } catch (error) {
      // Like a failed training: not tried again until the next launch, and the spare is free to go.
      this.wanted = false
      console.error(
        'JDK AOT cache: could not take the training lock; trying again at the next launch:',
        error,
      )
      this.announceEnded('failed')
      return
    }
    if (release == null) {
      console.info('JDK AOT cache: another IDE process is training it; checking again later.')
      this.scheduleRetrain()
      return
    }
    // Another process may have finished while this one waited; or an open started meanwhile.
    if ((await exists(cache)) || this.disposed || this.opensInFlight > 0) {
      await release()
      if (await exists(cache)) {
        this.wanted = false
        if (!this.disposed) this.announceEnded('trained')
      }
      return
    }
    const controller = new AbortController()
    console.info(`JDK AOT cache: training ${cache}.`)
    const started = Date.now()
    const done = this.trainer
      .train(cache, controller.signal)
      .then(
        async () => {
          this.wanted = false
          console.info(`JDK AOT cache: trained in ${Date.now() - started} ms.`)
          this.training = undefined
          this.announceEnded('trained')
          await this.deleteOtherKeys(directory)
        },
        (error: unknown) => {
          if (isAbortError(error)) {
            this.training = undefined
            console.info('JDK AOT cache: training stopped.')
          } else {
            // Not retried after every open: a failure that repeats would cost a JVM start, an
            // open and a cache creation each time. The next launch tries again.
            this.wanted = false
            console.error('JDK AOT cache: training failed; trying again at the next launch:', error)
            this.training = undefined
            this.announceEnded('failed')
          }
        },
      )
      .finally(async () => {
        await release().catch(() => undefined)
      })
    this.training = { controller, done }
  }

  /**
   * Tell `onTrainingEnded`, once `isTraining` says so: a training being started counts as one, so
   * from within it the call waits for that to settle.
   */
  private announceEnded(outcome: JvmAotTrainingOutcome): void {
    const announce = () => this.settings.onTrainingEnded?.(outcome)
    const starting = this.starting
    if (starting != null) void starting.then(announce, announce)
    else announce()
  }

  /** A training's files that an interrupted one (a quit) can leave: `.tmp` and `.aotconf`. */
  private async deleteLeftovers(cache: string): Promise<void> {
    const release = await acquireTrainingLock(this.settings.rootDirectory).catch(() => undefined)
    if (release == null) return
    try {
      for (const file of [`${cache}.tmp`, `${cache}.aotconf`]) {
        await fs.rm(file, { force: true }).catch(() => undefined)
      }
    } finally {
      await release().catch(() => undefined)
    }
  }

  /**
   * After a training: the key directories beyond the {@link KEYS_KEPT} most recently used go (an
   * upgrade changed the key). Only directories named like a key are touched: `ENSO_JVM_AOT_DIR`
   * may name a directory that holds other things.
   */
  private async deleteOtherKeys(keep: string): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.settings.rootDirectory)
    } catch {
      return
    }
    const others: { name: string; usedAt: number }[] = []
    for (const name of entries) {
      if (name === path.basename(keep) || !KEY_DIRECTORY.test(name)) continue
      const directory = path.join(this.settings.rootDirectory, name)
      try {
        if (!(await fs.stat(directory)).isDirectory()) continue
        others.push({ name, usedAt: await lastUsed(directory) })
      } catch {
        // Gone meanwhile.
      }
    }
    others.sort((a, b) => b.usedAt - a.usedAt)
    for (const { name } of others.slice(KEYS_KEPT - 1)) {
      await fs
        .rm(path.join(this.settings.rootDirectory, name), { recursive: true, force: true })
        .catch((error: unknown) => console.warn(`JDK AOT cache: could not delete ${name}:`, error))
    }
  }

  /** An open started: kill a running training (its files are deleted). */
  openStarted(): void {
    this.opensInFlight += 1
    clearTimeout(this.retrainTimer)
    this.retrainTimer = undefined
    this.training?.controller.abort()
  }

  /** An open was answered: restart training `retrainDelayMs` after the last one, if still needed. */
  openAnswered(): void {
    this.opensInFlight = Math.max(0, this.opensInFlight - 1)
    this.scheduleRetrain()
  }

  /**
   * Try training again `retrainDelayMs` from now, if it is still needed and no open is in flight
   * (the last open's answer schedules it then).
   */
  private scheduleRetrain(): void {
    if (this.opensInFlight > 0 || !this.wanted || this.disposed) return
    clearTimeout(this.retrainTimer)
    this.retrainTimer = setTimeout(() => {
      this.retrainTimer = undefined
      this.beginTraining().catch((error: unknown) =>
        console.error('JDK AOT cache: training could not start:', error),
      )
    }, this.settings.retrainDelayMs ?? 60_000)
  }

  /**
   * Whether a training is still to come or running: from `start()` looking for the cache until a
   * training has made one or failed, an aborted one waiting to restart included. No spare meanwhile.
   */
  isTraining(): boolean {
    if (this.disposed) return false
    return this.checkingAtLaunch || this.wanted || this.training != null || this.starting != null
  }

  /**
   * The options for a JVM engine: the cache and its use log (one option each, the log's path
   * quoted, so a `:` in a Windows path does not end the option; ruling 2 of the plan), or `[]` (no
   * cache yet, a translocated app, a development build).
   */
  async jvmOptions(): Promise<readonly string[]> {
    const directory = await this.keyDirectory()
    if (directory == null) return []
    const cache = path.join(directory, CACHE_FILE)
    if (!(await exists(cache))) return []
    return [
      `-XX:AOTCache=${cache}`,
      // `filecount=0`: one log, rewritten at each start, instead of five rotated ones.
      `-Xlog:aot=warning,cds=warning:file="${path.join(directory, USE_LOG_FILE)}"::filecount=0`,
    ]
  }

  /** After an open: a `use.log` that names a mismatch deletes the cache (it retrains next launch). */
  async checkUseLog(): Promise<void> {
    const directory = await this.keyDirectory()
    if (directory == null) return
    let log: string
    try {
      log = await fs.readFile(path.join(directory, USE_LOG_FILE), 'utf8')
    } catch {
      return
    }
    const rejection = aotRejection(log)
    if (rejection == null) return
    console.warn(`JDK AOT cache: the JVM did not use it (${rejection.trim()}); deleting it.`)
    await fs
      .rm(path.join(directory, CACHE_FILE), { force: true })
      .catch((error: unknown) => console.warn('JDK AOT cache: could not delete it:', error))
  }

  /**
   * Stop: no new training, and a running one is killed at once (its engine or `java`), before
   * anything is awaited, since the app may exit without waiting for this.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.retrainTimer)
    this.retrainTimer = undefined
    // Held here: a stopped training clears `training` before its lock is released (`done`).
    const running = this.training
    running?.controller.abort()
    // A training being started checks `disposed` once it has the lock.
    await this.starting
    const started = this.training
    started?.controller.abort()
    await running?.done
    await started?.done
  }
}
