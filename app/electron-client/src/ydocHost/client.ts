/**
 * @file The main process's end of the ydoc utility process (spec stage 1a (b)): a `YdocHost` for
 * the project-manager shim whose listeners run in `main.ts`, off the main process.
 */
import type { YdocHost, YdocListenRequest } from 'project-manager-shim/projectService'

import type { YdocHostRequest, YdocHostResponse } from './protocol'

/** The slice of Electron's `UtilityProcess` this uses; the unit tests pass a fake. */
export interface YdocHostChild {
  postMessage(message: YdocHostRequest): void
  on(event: 'message', listener: (message: YdocHostResponse) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  /** A fatal error in the child (Electron: `type`, `location`, `report`); `exit` follows. */
  on(event: 'error', listener: (type: string, location: string, report: string) => void): unknown
  kill(): boolean
}

/** A child that ran at least this long before it exited counts as a fresh start, not a crash loop. */
const RESTART_WINDOW_MS = 60_000
/** How many quick exits in a row are restarted before the host waits for the next request. */
const MAX_QUICK_RESTARTS = 5
/** The delay before the second quick restart; it doubles for each one after. */
const FIRST_RESTART_DELAY_MS = 1000

/** The utility process exited before it answered. */
class HostExited extends Error {}

interface Pending {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

/* Note [The ydoc Host Restarts With A Bounded Backoff]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Every open project's GUI needs the process: without it each one keeps reconnecting to a closed
 * port. So a crash is always followed by a restart, not only the first one in a minute. A process
 * that dies again soon after each start (a document it cannot load, memory it cannot get) must not
 * be restarted in a tight loop, so the delay doubles, and after five quick restarts (15 s of
 * retrying) the host stops and logs that it did; the next open or close forks it again. There is
 * no channel to tell an open project's GUI apart from its socket, which already shows the project
 * as disconnected while the process is down.
 */
/**
 * Sends each `listen` and `close` to the utility process and waits for its answer. The process is
 * forked by `start` (or else on the first request). If it exits, what it had not answered fails, and
 * it is forked again with the listeners that were open, so the open projects' GUIs reconnect: at
 * once, then, while it keeps exiting within a minute of its start, after 1, 2, 4 and 8 s; after five
 * such restarts it is left until the next `listen` or `close`, and says so in the log (Note [The
 * ydoc Host Restarts With A Bounded Backoff]).
 */
export class UtilityProcessYdocHost implements YdocHost {
  private child: YdocHostChild | undefined
  private readonly pending = new Map<number, Pending>()
  /** The listeners the process has confirmed and that have not been closed since, by port. */
  private readonly open = new Map<number, YdocListenRequest>()
  private nextId = 1
  /** How many times each port was closed: a `listen` answered after a `close` must not record it. */
  private readonly closes = new Map<number, number>()
  /** When the current process was forked. */
  private forkedAt = 0
  /** Quick exits in a row (each within `RESTART_WINDOW_MS` of its fork). */
  private quickExits = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /**
   * The origins whose pages may open the listeners' sockets, added to every `listen` that names
   * none (Note [The ydoc Listener Checks Origin] in `ydoc-server`). Set by {@link allowOrigins}.
   */
  private origins: readonly string[] = []

  /** @param spawn Forks the utility process (`utilityProcess.fork` in Electron). */
  constructor(private readonly spawn: () => YdocHostChild) {}

  /** Start a listener in the utility process; resolves once its port accepts connections. */
  async listen(request: YdocListenRequest): Promise<void> {
    // A port another project's listener holds, possibly still being restored after an exit: the
    // shim's search found it free in between. Refuse it as a bind failure, so the open searches for
    // new ports, instead of letting the new listener replace the other project's.
    if (this.open.has(request.port)) {
      throw new Error(
        `listen EADDRINUSE: port ${request.port} is held by another project's listener`,
      )
    }
    const withOrigins = {
      ...request,
      allowedOrigins: request.allowedOrigins ?? this.origins,
    }
    const closes = this.closes.get(request.port) ?? 0
    await this.send({ type: 'listen', id: this.nextId++, request: withOrigins })
    // A `close` sent while this was in flight reaches the process after the listen (it handles one
    // port's requests in order), so it stopped this listener: recording it would resurrect it at the
    // next restart.
    if ((this.closes.get(request.port) ?? 0) === closes) this.open.set(request.port, withOrigins)
  }

  /**
   * Let pages from these origins (the window's) connect to listeners started from now on; the
   * window's address is known only once the content server has found its port.
   */
  allowOrigins(origins: readonly string[]): void {
    this.origins = [...origins]
  }

  /** Stop the listener on `port` in the utility process. */
  async close(port: number): Promise<void> {
    this.open.delete(port)
    this.closes.set(port, (this.closes.get(port) ?? 0) + 1)
    await this.send({ type: 'close', id: this.nextId++, port })
  }

  /**
   * Fork the process now, ahead of the first open: forking it on the first `listen` put its start
   * (~0.4 s on Windows, ~0.2 s on Linux, measured) in front of that project's engine.
   */
  start(): void {
    if (!this.disposed && !this.child) this.fork()
  }

  /** Kill the utility process; every later request fails. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.restartTimer)
    const child = this.child
    this.child = undefined
    this.failPending(new Error('The ydoc host was disposed.'))
    child?.kill()
  }

  private send(message: YdocHostRequest): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The ydoc host was disposed.'))
    const child = this.child ?? this.forkOnRequest()
    return new Promise<void>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      child.postMessage(message)
    })
  }

  /**
   * Fork for a request. The restarts start over, unless a backoff is pending: that is the same crash
   * loop, and a request must not hand it a fresh limit.
   */
  private forkOnRequest(): YdocHostChild {
    if (this.restartTimer === undefined) this.quickExits = 0
    return this.fork()
  }

  /** Fork the process, and give it back the listeners that were open (after an exit). */
  private fork(): YdocHostChild {
    clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.spawn()
    this.child = child
    this.forkedAt = Date.now()
    child.on('message', (response) => this.answer(response))
    child.on('exit', (code) => this.exited(child, code))
    // Unhandled, an `error` event would throw in the main process and take the IDE down; the
    // `exit` that follows it drives the restart.
    child.on('error', (type, location) =>
      console.error(`The ydoc host failed (${type} at ${location}); it will be restarted.`),
    )
    for (const request of this.open.values()) {
      const id = this.nextId++
      this.pending.set(id, {
        resolve: () => {},
        reject: (error) => {
          // Refused by the new process: forget it. Lost with an exit: the next fork tries again.
          if (!(error instanceof HostExited)) this.open.delete(request.port)
          console.error(`The ydoc listener on port ${request.port} could not be restored:`, error)
        },
      })
      child.postMessage({ type: 'listen', id, request })
    }
    return child
  }

  private answer(response: YdocHostResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.type === 'done') pending.resolve()
    else pending.reject(new Error(response.message))
  }

  private exited(child: YdocHostChild, code: number): void {
    if (this.disposed || child !== this.child) return
    this.child = undefined
    console.error(`The ydoc host exited (code ${code}).`)
    this.failPending(new HostExited(`The ydoc host exited (code ${code}) before answering.`))
    // Nothing to restore: the next request forks it.
    if (this.open.size === 0) return
    this.quickExits = Date.now() - this.forkedAt >= RESTART_WINDOW_MS ? 1 : this.quickExits + 1
    if (this.quickExits > MAX_QUICK_RESTARTS) {
      console.error(
        `The ydoc host exited ${MAX_QUICK_RESTARTS + 1} times soon after starting; it is not restarted until a project is opened or closed.`,
      )
      return
    }
    if (this.quickExits === 1) {
      this.fork()
      return
    }
    const delay = FIRST_RESTART_DELAY_MS * 2 ** (this.quickExits - 2)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (!this.disposed && !this.child) this.fork()
    }, delay)
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const { reject } of pending) reject(error)
  }
}
