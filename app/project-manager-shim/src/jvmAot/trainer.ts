/**
 * @file The AOT trainer (spec, stage 1d "Training"): a scratch project from the bundled template,
 * a JVM engine recording its AOT configuration, the headless driver playing an open on it, the
 * engine's clean exit, which writes the configuration, and the bundled `java` creating the cache
 * from it (Note [The Cache Is Created In Two Steps]).
 */
import * as childProcess from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as portfinder from 'portfinder'
import { killTree } from '../childProcess/killTree.js'
import { renameWithRetry } from '../localMetadata/jsonFile.js'
import { aotCreateArguments, jvmOptionsValue } from '../projectService/jvmOptions.js'
import { newChannelToken } from '../projectService/ydocHost.js'
import { driveOpen } from './driver.js'
import { enginePaths, readJvmOptionsText } from './key.js'

/* Note [The Cache Is Created In Two Steps]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * JEP 514's one step (`-XX:AOTCacheOutput=`) creates the cache in a child JVM that the training
 * JVM forks as it exits, with what it can reconstruct of its own command line. The launcher starts
 * its JVM through JNI, and that child does not get the same modules: on the Windows bundle it
 * failed with `Mismatched values for property jdk.module.addmods: jdk.internal.vm.ci` and
 * `NoClassDefFoundError: jdk/vm/ci/services/Services`, leaving only the `.config` (2026-11-05). So
 * the training engine records (`-XX:AOTMode=record -XX:AOTConfiguration=`), and the bundled `java`
 * then creates the cache with the options the launcher gives its JVM (`aotCreateArguments`), as
 * the open-time harness did when it made its own caches (it now measures this one instead).
 */

/** Trains a cache into `output`; rejects (with an `AbortError` on `signal`) and leaves no file on failure. */
export interface Trainer {
  train(output: string, signal: AbortSignal): Promise<void>
}

export interface EngineTrainerOptions {
  readonly ensoExecutable: string
  /** Deleted and recreated for each training; it holds the scratch project. Deleted at the end. */
  readonly scratchRoot: string
  /** Where the search for the engine's RPC port starts. */
  readonly firstPort?: number
  /** How long the engine has to pass `/_health`: 180 s (spec, "Timeouts"). */
  readonly startupTimeoutMs?: number
  /** How long the driven open may take: 5 minutes. */
  readonly driveTimeoutMs?: number
  /**
   * How long the engine has to write its configuration and exit after the stdin newline, and
   * `java` to create the cache: 5 minutes each.
   */
  readonly exitTimeoutMs?: number
  /** The `java` that creates the cache; the bundled runtime's when omitted (tests replace it). */
  readonly javaExecutable?: string
}

const DEFAULT_FIRST_PORT = 30616
const TRAINING_PROJECT = 'Train'
const HEALTH_FAST_INTERVAL_MS = 25
const HEALTH_FAST_PERIOD_MS = 1000
const HEALTH_INTERVAL_MS = 250
/** How much of the engine's output is kept, to say why a training failed. */
const OUTPUT_TAIL_LENGTH = 4096

function abortError(): DOMException {
  return new DOMException('The AOT training was aborted', 'AbortError')
}

/** A child and what is known about its end. */
interface Engine {
  readonly child: childProcess.ChildProcess
  readonly exited: Promise<number | null>
  readonly output: () => string
}

/** Implementation of {@link Trainer} with the bundled engine. */
export class EngineTrainer implements Trainer {
  /** A trainer for the engine whose launcher is `options.ensoExecutable`. */
  constructor(private readonly options: EngineTrainerOptions) {}

  private spawn(
    executable: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): Engine {
    const [command, commandArgs] =
      executable.endsWith('.bat') ?
        ['cmd.exe', ['/c', executable, ...args]]
      : [executable, [...args]]
    const child = childProcess.spawn(command, commandArgs, {
      env,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    // A write to an exited child fails asynchronously (shim CLAUDE.md, "Child processes").
    child.stdin?.on('error', () => {})
    let tail = ''
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-OUTPUT_TAIL_LENGTH)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code))
    })
    exited.catch(() => undefined)
    return { child, exited, output: () => tail }
  }

  /** Wait for `engine` to exit, for at most `timeoutMs`; `undefined` when it did not. */
  private async waitForExit(engine: Engine, timeoutMs: number): Promise<number | null | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        engine.exited,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Poll `/_health` (25 ms for the first second, then 250 ms) until it passes. */
  private async waitForHealth(port: number, engine: Engine, signal: AbortSignal): Promise<void> {
    const timeoutMs = this.options.startupTimeoutMs ?? 180_000
    const started = Date.now()
    let exited = false
    void engine.exited.then(
      () => (exited = true),
      () => (exited = true),
    )
    while (true) {
      if (signal.aborted) throw abortError()
      if (exited) {
        throw new Error(`The training engine exited while starting:\n${engine.output()}`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/_health`, { signal })
        if (response.ok) return
      } catch {
        // Not listening yet.
      }
      const elapsed = Date.now() - started
      if (elapsed > timeoutMs) {
        throw new Error(`The training engine did not start in ${timeoutMs} ms`)
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          elapsed < HEALTH_FAST_PERIOD_MS ? HEALTH_FAST_INTERVAL_MS : HEALTH_INTERVAL_MS,
        ),
      )
    }
  }

  /** Lower a child's priority; best effort: a training at normal priority is still a training. */
  private static lowerPriority(engine: Engine): void {
    if (engine.child.pid == null) return
    try {
      os.setPriority(engine.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // See above.
    }
  }

  /** Train into `output` (see the file comment); an abort kills the engine and deletes the files. */
  async train(output: string, signal: AbortSignal): Promise<void> {
    const temporary = `${output}.tmp`
    const config = `${output}.aotconf`
    const scratchRoot = this.options.scratchRoot
    const ensoExecutable = this.options.ensoExecutable
    let engine: Engine | undefined
    const onAbort = () => {
      if (engine) killTree(engine.child, 'JDK AOT cache')
    }
    signal.addEventListener('abort', onAbort)
    try {
      if (signal.aborted) throw abortError()
      const paths = await enginePaths(ensoExecutable)
      if (paths == null) throw new Error(`No bundled runtime beside ${ensoExecutable}`)
      const java =
        this.options.javaExecutable ??
        path.join(paths.runtimeRoot, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      await fs.rm(scratchRoot, { recursive: true, force: true })
      await fs.mkdir(scratchRoot, { recursive: true })
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.rm(temporary, { force: true })
      await fs.rm(config, { force: true })
      const projectRoot = path.join(scratchRoot, TRAINING_PROJECT)

      // The scratch project: `enso --new`, native, from the bundled (welcome) template.
      engine = this.spawn(
        ensoExecutable,
        ['--new', projectRoot, '--new-project-name', TRAINING_PROJECT],
        process.env,
        scratchRoot,
      )
      engine.child.stdin?.end()
      const created = await engine.exited
      if (signal.aborted) throw abortError()
      if (created !== 0) {
        throw new Error(`enso --new exited with ${created}:\n${engine.output()}`)
      }

      const port = await portfinder.getPortPromise({
        port: this.options.firstPort ?? DEFAULT_FIRST_PORT,
      })
      if (signal.aborted) throw abortError()
      const token = newChannelToken()
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ENSO_JVM_OPTIONS: jvmOptionsValue(process.env.ENSO_JVM_OPTIONS, [
          '-XX:AOTMode=record',
          `-XX:AOTConfiguration=${config}`,
        ]),
        LANGUAGE_SERVER_CHANNEL_TOKEN: token,
      }
      // The channel socket replaces the embedded ydoc server, which the training does not need.
      delete env.LANGUAGE_SERVER_YDOC_PORT
      engine = this.spawn(
        ensoExecutable,
        [
          '--jvm',
          '--server',
          '--root-id',
          crypto.randomUUID(),
          '--project-id',
          crypto.randomUUID(),
          '--path',
          projectRoot,
          '--interface',
          '127.0.0.1',
          '--rpc-port',
          String(port),
        ],
        env,
        scratchRoot,
      )
      EngineTrainer.lowerPriority(engine)
      await this.waitForHealth(port, engine, signal)
      const driving = engine
      await driveOpen({
        rpcPort: port,
        token,
        projectRoot,
        timeoutMs: this.options.driveTimeoutMs ?? 300_000,
        signal,
      }).catch((error: unknown) => {
        if (signal.aborted) throw error
        // What the engine said is what tells why the open failed.
        const said = driving.output()
        throw new Error(`${String(error)}\nThe training engine's output:\n${said}`, {
          cause: error,
        })
      })

      // The recording JVM writes its configuration as it exits.
      engine.child.stdin?.write('\n')
      const exitTimeoutMs = this.options.exitTimeoutMs ?? 300_000
      const code = await this.waitForExit(engine, exitTimeoutMs)
      if (signal.aborted) throw abortError()
      if (code === undefined) {
        throw new Error(`The training engine did not exit in ${exitTimeoutMs} ms`)
      }
      if (code !== 0) {
        throw new Error(`The training engine exited with ${code}:\n${engine.output()}`)
      }
      if (!(await exists(config))) {
        throw new Error(`The training engine exited without writing ${config}`)
      }

      // Note [The Cache Is Created In Two Steps]
      engine = this.spawn(
        java,
        aotCreateArguments({
          config,
          cache: temporary,
          component: path.join(paths.engineRoot, 'component'),
          optionsFile: await readJvmOptionsText(paths.engineRoot),
          jvmOptions: process.env.ENSO_JVM_OPTIONS ?? '',
        }),
        process.env,
        scratchRoot,
      )
      engine.child.stdin?.end()
      EngineTrainer.lowerPriority(engine)
      const createCode = await this.waitForExit(engine, exitTimeoutMs)
      if (signal.aborted) throw abortError()
      if (createCode !== 0 || !(await exists(temporary))) {
        throw new Error(
          `Creating the AOT cache failed (${createCode ?? 'timed out'}):\n${engine.output()}`,
        )
      }
      await renameWithRetry(temporary, output)
    } catch (error) {
      if (engine) {
        killTree(engine.child, 'JDK AOT cache')
        await this.waitForExit(engine, 10_000)
      }
      await fs
        .rm(temporary, { force: true, maxRetries: 10, retryDelay: 200 })
        .catch(() => undefined)
      throw signal.aborted ? abortError() : error
    } finally {
      signal.removeEventListener('abort', onAbort)
      await fs.rm(config, { force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined)
      await fs
        .rm(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        .catch(() => undefined)
    }
  }
}

/** Whether `file` exists. */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
