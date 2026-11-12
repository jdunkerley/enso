/**
 * @file The spare engine: a JVM engine started with `--standby` while no project is open, handed
 * to the next open (spec `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`).
 */
import type { ChildProcess } from 'node:child_process'
import * as childProcess from 'node:child_process'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import { killTree } from '../childProcess/killTree.js'

/**
 * The variables of one open: written on the spare's line, never part of its spawn key. The engine
 * accepts exactly these (`StandbyRequest` in engine/runner).
 */
export const LINE_VARIABLES: ReadonlySet<string> = new Set([
  'LANGUAGE_SERVER_CHANNEL_TOKEN',
  'ENSO_LOCAL_PROJECT_ID',
  'ENSO_LOCAL_PROJECT_SESSION_ID',
])

/** The engine's `STANDBY READY <ms from its process start>` line. */
const STANDBY_READY = /STANDBY READY (-?\d+)\r?\n/
/** How much of a spare's stderr is kept to find the ready line in. */
const STDERR_TAIL_LENGTH = 4096

/** What a spare is started with, beyond the executable: an open must start with the same. */
export interface SpawnKeyInputs {
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
    .update(JSON.stringify([inputs.args, inputs.jvmOptions, env]))
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

/**
 * What a take found. `idle` means no spare was running, for no reason this class knows: the service
 * did not start one (`EngineLaunch.spareIdleReason` says why).
 */
export type TakeResult =
  | { readonly kind: 'taken'; readonly spare: TakenSpare }
  | { readonly kind: 'none'; readonly reason: string; readonly idle?: boolean }

export type SpareState = 'none' | 'warming' | 'ready'

/**
 * The engine log's line about an open's spare, so a slow open can be traced to it. When no spare was
 * running, `idleReason` is why the service started none: `null` (spares are off) means no line.
 */
export function spareNotice(
  result: TakeResult,
  now: number,
  idleReason?: string | null,
): string | undefined {
  if (result.kind === 'none') {
    if (result.idle !== true || idleReason === undefined) {
      return `Engine: no pre-started spare (${result.reason})`
    }
    return idleReason == null ? undefined : `Engine: no pre-started spare (${idleReason})`
  }
  const age = ((now - result.spare.startedAt) / 1000).toFixed(1)
  const ready =
    result.spare.readyAfterMs == null ?
      'still warming up'
    : `ready after ${(result.spare.readyAfterMs / 1000).toFixed(1)} s`
  return `Engine: pre-started spare used (started ${age} s before the open, ${ready})`
}

/**
 * How long a spare's warm-up may still run after the line: the engine cancels it then (engine/runner
 * CLAUDE.md, "Standby mode"), so an open that takes a spare still warming up waits this much longer
 * for its engine to start.
 */
export const SPARE_WARM_UP_LIMIT_MS = 60_000

/** How long a stopped spare may take to exit by itself before its process tree is killed. */
export const SPARE_STOP_GRACE_MS = 10_000

/** How long a bounded stop waits for a killed spare's exit after its tree was killed. */
export const SPARE_KILL_WAIT_MS = 1000

/** A bounded stop: wait this long for the spare to exit, then kill its tree (quit, update). */
export interface SpareStopOptions {
  readonly waitMs?: number
}

export interface SpareEngineOptions {
  /** Where a spare's stderr goes besides the ready check: the runner's echo to its own stderr. */
  readonly echo?: (chunk: Buffer) => void
  /** `Spare engine: …` lines; `console.info` by default. */
  readonly log?: (message: string) => void
  readonly now?: () => number
  /** {@link SPARE_STOP_GRACE_MS} by default. */
  readonly stopGraceMs?: number
}

interface Running {
  readonly child: ChildProcess
  readonly key: string
  readonly startedAt: number
  readyAfterMs: number | undefined
  readonly onStderr: (chunk: Buffer) => void
  readonly onExit: () => void
}

/** `pid N, ` for a log line, or nothing when the process has no pid (it never started). */
function pidPhrase(child: ChildProcess): string {
  return child.pid == null ? '' : `pid ${child.pid}, `
}

/**
 * At most one spare engine. A spare warms up, prints `STANDBY READY <ms>` on stderr, and waits for
 * one line on stdin, the arguments `project/open` would have passed it (engine/runner CLAUDE.md,
 * "Standby mode"); from then on it is an ordinary engine. `EnsoRunner` owns one and hands its
 * process to an open; `ProjectService` decides when one is wanted.
 */
export class SpareEngine {
  private running: Running | undefined
  /** Stopped spares that have not exited yet, with what settles on their exit. */
  private readonly stopping = new Map<ChildProcess, Promise<void>>()
  /** Keys whose last spare failed: not started again until {@link clearFailure}. */
  private readonly failedKeys = new Set<string>()
  private readonly echo: (chunk: Buffer) => void
  private readonly log: (message: string) => void
  private readonly now: () => number
  private readonly stopGraceMs: number

  /** Manage spares with the given log, stderr echo, clock and grace period. */
  constructor(options: SpareEngineOptions = {}) {
    this.echo = options.echo ?? (() => {})
    this.log = options.log ?? ((message) => console.info(`Spare engine: ${message}`))
    this.now = options.now ?? Date.now
    this.stopGraceMs = options.stopGraceMs ?? SPARE_STOP_GRACE_MS
  }

  /** Whether a spare runs, and whether it has printed its ready line. */
  get state(): SpareState {
    const running = this.running
    if (running == null) return 'none'
    return running.readyAfterMs == null ? 'warming' : 'ready'
  }

  /** Whether a spare runs, or a stopped one has not exited yet. */
  get alive(): boolean {
    return this.running != null || this.stopping.size > 0
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
    if (current != null) void this.stop('its settings changed')
    if (this.failedKeys.has(spawn.key)) {
      this.log('not started: the last one with these settings failed; the next close tries again')
      return
    }
    let child: ChildProcess
    try {
      child = childProcess.spawn(spawn.command, [...spawn.args], {
        env: spawn.env,
        cwd: os.tmpdir(),
        stdio: ['pipe', 'inherit', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      this.failedKeys.add(spawn.key)
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
        this.failedKeys.add(spawn.key)
        this.detach(running)
        // An 'error' after 'exit' (or the reverse) must not be unhandled.
        running.child.on('error', () => {})
        running.child.stderr?.resume()
        this.log('exited or could not be started before it was used; dropped until the next close')
      },
    }
    child.stderr?.on('data', running.onStderr)
    child.on('exit', running.onExit)
    // An executable that cannot be started is reported here, after `spawn` has returned.
    child.on('error', running.onExit)
    this.running = running
    this.log(child.pid == null ? 'starting' : `started (pid ${child.pid})`)
  }

  /**
   * Hand the spare to an open that would start an engine with `key`. One with another key is
   * stopped. A taken spare's stderr is no longer read here: the open attaches its own reader in the
   * same turn of the event loop (`OpenedProject.captureStderr`), so no chunk is lost.
   */
  take(key: string): TakeResult {
    const running = this.running
    if (running == null) {
      return this.failedKeys.has(key) ?
          { kind: 'none', reason: 'the last spare failed' }
        : { kind: 'none', reason: 'no spare was running', idle: true }
    }
    if (running.child.exitCode != null || running.child.signalCode != null) {
      // Its 'exit' event has not been handled yet: drop it as that handler would.
      running.onExit()
      return { kind: 'none', reason: 'the spare had exited' }
    }
    if (running.key !== key) {
      void this.stop('the open needs other settings')
      return { kind: 'none', reason: 'the spare was started with other settings' }
    }
    this.running = undefined
    this.detach(running)
    const readiness =
      running.readyAfterMs == null ? 'still warming up' : `ready after ${running.readyAfterMs} ms`
    this.log(`used (${pidPhrase(running.child)}${readiness})`)
    return {
      kind: 'taken',
      spare: {
        child: running.child,
        startedAt: running.startedAt,
        readyAfterMs: running.readyAfterMs,
      },
    }
  }

  /**
   * Stop the spare, if any. Its stdin closes, on which it cancels its warm-up, deletes the
   * warm-up's files and exits by itself; one still running after the grace period is killed with
   * everything it started. The promise settles on its exit.
   *
   * With `waitMs` (a quit, or an update about to install), the promise settles within about
   * `waitMs` + {@link SPARE_KILL_WAIT_MS}: the spare, and every stopped one that has not exited yet,
   * is given `waitMs` to exit, then its tree is killed and its exit waited for a little longer.
   */
  stop(reason: string, options: SpareStopOptions = {}): Promise<void> {
    const running = this.running
    if (running != null) {
      this.running = undefined
      this.detach(running)
      this.log(`stopped: ${reason}`)
      this.stopChild(running.child)
    }
    const waitMs = options.waitMs
    const exits = [...this.stopping]
    if (waitMs == null) return Promise.all(exits.map(([, exited]) => exited)).then(() => {})
    return Promise.all(
      exits.map(async ([child, exited]) => {
        if (await settlesWithin(exited, waitMs)) return
        this.log(`${pidPhrase(child)}still running ${waitMs} ms after its stop: killed`)
        killTree(child, 'Spare engine')
        await settlesWithin(exited, SPARE_KILL_WAIT_MS)
      }),
    ).then(() => {})
  }

  private stopChild(child: ChildProcess): void {
    // Nothing else listens any more: a late spawn failure must not be an unhandled error.
    child.on('error', () => {})
    // Read to the end, so a full pipe never holds up its exit.
    child.stderr?.resume()
    child.stdin?.end()
    if (child.exitCode != null || child.signalCode != null) return
    const timer = setTimeout(() => {
      this.log(`${pidPhrase(child)}still running ${this.stopGraceMs} ms after its stop: killed`)
      killTree(child, 'Spare engine')
    }, this.stopGraceMs)
    // The grace period must not hold this process open; a quit uses a bounded stop instead.
    timer.unref()
    const exited = new Promise<void>((resolve) => {
      // A child that never started reports 'error' and no 'exit'.
      const done = () => {
        clearTimeout(timer)
        this.stopping.delete(child)
        resolve()
      }
      child.once('exit', done)
      child.once('error', done)
    })
    this.stopping.set(child, exited)
  }

  /** No project is open again: the keys whose spares failed may be tried once more. */
  clearFailure(): void {
    this.failedKeys.clear()
  }

  private detach(running: Running): void {
    running.child.stderr?.off('data', running.onStderr)
    running.child.off('exit', running.onExit)
    running.child.off('error', running.onExit)
  }
}

/** Whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = await Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms))),
  ])
  clearTimeout(timer)
  return settled
}
