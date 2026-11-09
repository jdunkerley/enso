/**
 * @file The spare engine: a JVM engine started with `--standby` while no project is open, handed
 * to the next open (spec `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`).
 */
import type { ChildProcess } from 'node:child_process'
import * as childProcess from 'node:child_process'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import type { EngineMode } from './engineMode.js'

/**
 * The variables of one open: written on the spare's line, never part of its spawn key. The engine
 * accepts exactly these (`StandbyRequest` in engine/runner).
 */
export const LINE_VARIABLES: ReadonlySet<string> = new Set([
  'LANGUAGE_SERVER_CHANNEL_TOKEN',
  'LANGUAGE_SERVER_YDOC_PORT',
  'ENSO_LOCAL_PROJECT_ID',
  'ENSO_LOCAL_PROJECT_SESSION_ID',
])

/** The engine's `STANDBY READY <ms from its process start>` line. */
const STANDBY_READY = /STANDBY READY (-?\d+)/
/** How much of a spare's stderr is kept to find the ready line in. */
const STDERR_TAIL_LENGTH = 4096

/** What a spare is started with, beyond the executable: an open must start with the same. */
export interface SpawnKeyInputs {
  readonly mode: EngineMode
  readonly args: readonly string[]
  readonly jvmOptions: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/**
 * The spawn key: a hash, so the secrets key in `env` is neither kept nor logged as it is. The
 * environment is sorted, so its order does not matter.
 */
export function spawnKey(inputs: SpawnKeyInputs): string {
  const env = Object.entries(inputs.env).sort(([a], [b]) =>
    a < b ? -1
    : a > b ? 1
    : 0,
  )
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([inputs.mode, inputs.args, inputs.jvmOptions, env]))
    .digest('hex')
}

/** The argument line: `{"args":[...],"env":{...}}` and a newline. */
export function standbyLine(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): string {
  return `${JSON.stringify({ args, env })}\n`
}

/** How to start a spare: the command line already resolved (a `.bat` through `cmd.exe`). */
export interface SpareSpawn {
  readonly key: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/** A spare handed to an open. */
export interface TakenSpare {
  readonly child: ChildProcess
  readonly startedAt: number
  /** `undefined` while it was still warming up. */
  readonly readyAfterMs: number | undefined
}

export type TakeResult =
  | { readonly kind: 'taken'; readonly spare: TakenSpare }
  | { readonly kind: 'none'; readonly reason: string }

export type SpareState = 'none' | 'warming' | 'ready'

/** The engine log's line about an open's spare, so a slow open can be traced to it. */
export function spareNotice(result: TakeResult, now: number): string {
  if (result.kind === 'none') return `Engine: no pre-started spare (${result.reason})`
  const age = ((now - result.spare.startedAt) / 1000).toFixed(1)
  const ready =
    result.spare.readyAfterMs == null ?
      'still warming up'
    : `ready after ${(result.spare.readyAfterMs / 1000).toFixed(1)} s`
  return `Engine: pre-started spare used (started ${age} s before the open, ${ready})`
}

export interface SpareEngineOptions {
  /** Where a spare's stderr goes besides the ready check: the runner's echo to its own stderr. */
  readonly echo?: (chunk: Buffer) => void
  /** `Spare engine: …` lines; `console.info` by default. */
  readonly log?: (message: string) => void
  readonly now?: () => number
}

interface Running {
  readonly child: ChildProcess
  readonly key: string
  readonly startedAt: number
  readyAfterMs: number | undefined
  readonly onStderr: (chunk: Buffer) => void
  readonly onExit: () => void
}

/**
 * At most one spare engine. A spare warms up, prints `STANDBY READY <ms>` on stderr, and waits for
 * one line on stdin, the arguments `project/open` would have passed it (engine/runner CLAUDE.md,
 * "Standby mode"); from then on it is an ordinary engine. `EnsoRunner` owns one and hands its
 * process to an open; `ProjectService` decides when one is wanted.
 */
export class SpareEngine {
  private running: Running | undefined
  /** The key of the last spare that failed: not started again until {@link clearFailure}. */
  private failedKey: string | undefined
  private readonly echo: (chunk: Buffer) => void
  private readonly log: (message: string) => void
  private readonly now: () => number

  /** Manage spares with the given log, stderr echo and clock. */
  constructor(options: SpareEngineOptions = {}) {
    this.echo = options.echo ?? (() => {})
    this.log = options.log ?? ((message) => console.info(`Spare engine: ${message}`))
    this.now = options.now ?? Date.now
  }

  /** Whether a spare runs, and whether it has printed its ready line. */
  get state(): SpareState {
    const running = this.running
    if (running == null) return 'none'
    return running.readyAfterMs == null ? 'warming' : 'ready'
  }

  /** The running spare's process id (that of `cmd.exe` when a `.bat` runs through it). */
  get pid(): number | undefined {
    return this.running?.child.pid
  }

  /**
   * Start a spare, unless one with the same key runs. One with another key is stopped first. No
   * spare is started for a key whose last spare failed (spec: no retry loop).
   */
  start(spawn: SpareSpawn): void {
    const current = this.running
    if (current?.key === spawn.key) return
    if (current != null) this.stop('its settings changed')
    if (this.failedKey === spawn.key) {
      this.log('not started: the last one with these settings failed; the next close tries again')
      return
    }
    this.failedKey = undefined
    let child: ChildProcess
    try {
      child = childProcess.spawn(spawn.command, [...spawn.args], {
        env: spawn.env,
        cwd: os.tmpdir(),
        stdio: ['pipe', 'inherit', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      this.failedKey = spawn.key
      this.log(`could not be started: ${String(error)}`)
      return
    }
    const startedAt = this.now()
    // A write to an exited child fails asynchronously (project-manager-shim CLAUDE.md, "Child
    // processes"); the open that takes it attaches its own listener as well.
    child.stdin?.on('error', () => {})
    let tail = ''
    const running: Running = {
      child,
      key: spawn.key,
      startedAt,
      readyAfterMs: undefined,
      onStderr: (chunk: Buffer) => {
        this.echo(chunk)
        if (running.readyAfterMs != null) return
        tail = (tail + chunk.toString()).slice(-STDERR_TAIL_LENGTH)
        const match = STANDBY_READY.exec(tail)
        if (match == null) return
        running.readyAfterMs = this.now() - startedAt
        this.log(`ready after ${running.readyAfterMs} ms (${match[1]} ms from its own start)`)
      },
      onExit: () => {
        if (this.running !== running) return
        this.running = undefined
        this.failedKey = spawn.key
        this.log('exited before it was used; dropped until the next close')
      },
    }
    child.stderr?.on('data', running.onStderr)
    child.once('exit', running.onExit)
    child.once('error', running.onExit)
    this.running = running
    this.log(`started (pid ${child.pid})`)
  }

  /**
   * Hand the spare to an open that would start an engine with `key`. One with another key is
   * stopped. A taken spare's stderr is no longer read here: the open attaches its own reader in the
   * same turn of the event loop (`OpenedProject.captureStderr`), so no chunk is lost.
   */
  take(key: string): TakeResult {
    const running = this.running
    if (running == null) {
      return {
        kind: 'none',
        reason: this.failedKey != null ? 'the last spare failed' : 'no spare was running',
      }
    }
    if (running.child.exitCode != null || running.child.signalCode != null) {
      // Its 'exit' event has not run yet: drop it as that would have.
      this.running = undefined
      this.failedKey = running.key
      this.detach(running)
      return { kind: 'none', reason: 'the spare had exited' }
    }
    if (running.key !== key) {
      this.stop('the open needs other settings')
      return { kind: 'none', reason: 'the spare was started with other settings' }
    }
    this.running = undefined
    this.detach(running)
    const readiness =
      running.readyAfterMs == null ? 'still warming up' : `ready after ${running.readyAfterMs} ms`
    this.log(`used (pid ${running.child.pid}, ${readiness})`)
    return {
      kind: 'taken',
      spare: {
        child: running.child,
        startedAt: running.startedAt,
        readyAfterMs: running.readyAfterMs,
      },
    }
  }

  /** Stop the spare, if any: its stdin closes (it exits by itself) and it is killed. */
  stop(reason: string): void {
    const running = this.running
    if (running == null) return
    this.running = undefined
    this.detach(running)
    // Read to the end, so a full pipe never holds up its exit.
    running.child.stderr?.resume()
    this.log(`stopped: ${reason}`)
    running.child.stdin?.end()
    running.child.kill()
  }

  /** No project is open again: a key whose spare failed may be tried once more. */
  clearFailure(): void {
    this.failedKey = undefined
  }

  private detach(running: Running): void {
    running.child.stderr?.off('data', running.onStderr)
    running.child.off('exit', running.onExit)
    running.child.off('error', running.onExit)
  }
}
