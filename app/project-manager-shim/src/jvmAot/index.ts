/**
 * @file The per-user JDK AOT cache (spec, stage 1d "The AOT cache lifecycle"): trained in the
 * background at app launch when the JVM is the default engine, killed by any open and restarted
 * 60 s after the last one was answered, used by every JVM engine once it exists, and deleted when a
 * JVM says it does not match.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { aotKey, enginePaths, isTranslocated, readJvmOptionsText } from './key.js'
import { acquireTrainingLock, LOCK_FILE_NAME } from './lock.js'
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
export { aotKey, enginePaths, isTranslocated, readJvmOptionsText } from './key.js'
export { acquireTrainingLock } from './lock.js'
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
}

const CACHE_FILE = 'enso.aot'
const USE_LOG_FILE = 'use.log'
/** The trainer's scratch project, beside the key directories. */
const SCRATCH_DIRECTORY = 'train'

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

  /** The trainer defaults to an {@link EngineTrainer} with its scratch project in `<root>/train`. */
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
   * engine (a development build with no bundled runtime, or a macOS translocated app).
   */
  keyDirectory(): Promise<string | undefined> {
    this.keyDirectoryPromise ??= (async () => {
      const paths = await enginePaths(this.settings.ensoExecutable)
      if (paths == null || isTranslocated(paths.engineRoot)) return undefined
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
    const cache = await this.cacheFile()
    if (cache == null || (await exists(cache))) return
    this.wanted = true
    await this.beginTraining()
  }

  /** Start a training, unless one runs, an open is in flight, or another process holds the lock. */
  private beginTraining(): Promise<void> {
    this.starting ??= this.tryBeginTraining().finally(() => (this.starting = undefined))
    return this.starting
  }

  private async tryBeginTraining(): Promise<void> {
    if (this.disposed || !this.wanted || this.training != null || this.opensInFlight > 0) return
    const directory = await this.keyDirectory()
    if (directory == null) return
    const cache = path.join(directory, CACHE_FILE)
    const release = await acquireTrainingLock(this.settings.rootDirectory)
    if (release == null) {
      console.info('JDK AOT cache: another IDE process is training it.')
      return
    }
    // Another process may have finished while this one waited; or an open started meanwhile.
    if ((await exists(cache)) || this.disposed || this.opensInFlight > 0) {
      if (await exists(cache)) this.wanted = false
      await release()
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
          await this.deleteOtherKeys(directory)
        },
        (error: unknown) => {
          if (isAbortError(error)) console.info('JDK AOT cache: training stopped for an open.')
          else console.error('JDK AOT cache: training failed:', error)
        },
      )
      .finally(async () => {
        this.training = undefined
        await release().catch(() => undefined)
      })
    this.training = { controller, done }
  }

  /** After a training: every other key's directory goes (an upgrade changed the key). */
  private async deleteOtherKeys(keep: string): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.settings.rootDirectory)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === path.basename(keep) || entry === LOCK_FILE_NAME) continue
      await fs
        .rm(path.join(this.settings.rootDirectory, entry), { recursive: true, force: true })
        .catch((error: unknown) => console.warn(`JDK AOT cache: could not delete ${entry}:`, error))
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
    if (this.opensInFlight > 0 || !this.wanted || this.disposed) return
    clearTimeout(this.retrainTimer)
    this.retrainTimer = setTimeout(() => {
      this.retrainTimer = undefined
      void this.beginTraining()
    }, this.settings.retrainDelayMs ?? 60_000)
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
      `-Xlog:aot=warning,cds=warning:file="${path.join(directory, USE_LOG_FILE)}"`,
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

  /** Stop: no new training, and a running one is killed. */
  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.retrainTimer)
    this.retrainTimer = undefined
    await this.starting
    const training = this.training
    training?.controller.abort()
    await training?.done
  }
}
