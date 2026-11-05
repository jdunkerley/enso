/**
 * @file The AOT trainer (spec, stage 1d "Training"): a scratch project from the bundled template,
 * a JVM engine recording with JEP 514's one-step `-XX:AOTCacheOutput=`, the headless driver
 * playing an open on it, and the engine's clean exit, which writes the cache.
 */
import * as childProcess from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as portfinder from 'portfinder'
import { renameWithRetry } from '../localMetadata/jsonFile.js'
import { jvmOptionsValue } from '../projectService/jvmOptions.js'
import { driveOpen } from './driver.js'

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
  /** How long the engine has to write the cache and exit after the stdin newline: 5 minutes. */
  readonly exitTimeoutMs?: number
}

const DEFAULT_FIRST_PORT = 30616
const TRAINING_PROJECT = 'Train'
const HEALTH_FAST_INTERVAL_MS = 25
const HEALTH_FAST_PERIOD_MS = 1000
const HEALTH_INTERVAL_MS = 250
/** How much of the engine's output is kept, to say why a training failed. */
const OUTPUT_TAIL_LENGTH = 4096

/** A fresh `LANGUAGE_SERVER_CHANNEL_TOKEN`: 32 random bytes as hex. */
function newToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function abortError(): DOMException {
  return new DOMException('The AOT training was aborted', 'AbortError')
}

/** A child and what is known about its end. */
interface Engine {
  readonly child: childProcess.ChildProcess
  readonly exited: Promise<number | null>
  readonly output: () => string
}

/** Kill `child` and everything it started (on Windows a `.bat` launcher's `cmd.exe` has a child). */
function killTree(child: childProcess.ChildProcess): void {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    childProcess.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    child.kill('SIGKILL')
  }
}

/** Implementation of {@link Trainer} with the bundled engine. */
export class EngineTrainer implements Trainer {
  constructor(private readonly options: EngineTrainerOptions) {}

  private spawn(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Engine {
    const [command, commandArgs] =
      this.options.ensoExecutable.endsWith('.bat') ?
        ['cmd.exe', ['/c', this.options.ensoExecutable, ...args]]
      : [this.options.ensoExecutable, [...args]]
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

  async train(output: string, signal: AbortSignal): Promise<void> {
    const temporary = `${output}.tmp`
    const scratchRoot = this.options.scratchRoot
    let engine: Engine | undefined
    const onAbort = () => {
      if (engine) killTree(engine.child)
    }
    signal.addEventListener('abort', onAbort)
    try {
      if (signal.aborted) throw abortError()
      await fs.rm(scratchRoot, { recursive: true, force: true })
      await fs.mkdir(scratchRoot, { recursive: true })
      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.rm(temporary, { force: true })
      const projectRoot = path.join(scratchRoot, TRAINING_PROJECT)

      // The scratch project: `enso --new`, native, from the bundled (welcome) template.
      engine = this.spawn(
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
      const token = newToken()
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ENSO_JVM_OPTIONS: jvmOptionsValue(process.env.ENSO_JVM_OPTIONS, [
          `-XX:AOTCacheOutput=${temporary}`,
        ]),
        LANGUAGE_SERVER_CHANNEL_TOKEN: token,
      }
      // The channel socket replaces the embedded ydoc server, which the training does not need.
      delete env.LANGUAGE_SERVER_YDOC_PORT
      engine = this.spawn(
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
      if (engine.child.pid != null) {
        try {
          os.setPriority(engine.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
        } catch {
          // Best effort: a training at normal priority is still a training.
        }
      }
      await this.waitForHealth(port, engine, signal)
      await driveOpen({
        rpcPort: port,
        token,
        projectRoot,
        timeoutMs: this.options.driveTimeoutMs ?? 300_000,
        signal,
      })

      // The recording JVM writes the cache as it exits.
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
      try {
        await fs.access(temporary)
      } catch {
        throw new Error(`The training engine exited without writing ${temporary}`)
      }
      await renameWithRetry(temporary, output)
    } catch (error) {
      if (engine) {
        killTree(engine.child)
        await this.waitForExit(engine, 10_000)
      }
      await fs
        .rm(temporary, { force: true, maxRetries: 10, retryDelay: 200 })
        .catch(() => undefined)
      throw signal.aborted ? abortError() : error
    } finally {
      signal.removeEventListener('abort', onAbort)
      await fs
        .rm(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        .catch(() => undefined)
    }
  }
}
