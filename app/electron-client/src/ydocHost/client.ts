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
  kill(): boolean
}

/** A child that exits within this long of the last restart is not restarted until a request. */
const RESTART_WINDOW_MS = 60_000

/** The utility process exited before it answered. */
class HostExited extends Error {}

interface Pending {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

/**
 * Sends each `listen` and `close` to the utility process and waits for its answer. The process is
 * forked on the first request. If it exits, what it had not answered fails, and it is forked again
 * at once with the listeners that were open (so the open projects' GUIs can reconnect); one that
 * exits again within a minute is forked only on the next request.
 */
export class UtilityProcessYdocHost implements YdocHost {
  private child: YdocHostChild | undefined
  private readonly pending = new Map<number, Pending>()
  /** The listeners the process has confirmed and that have not been closed since, by port. */
  private readonly open = new Map<number, YdocListenRequest>()
  private nextId = 1
  private lastRestart: number | undefined
  private disposed = false

  /** @param spawn Forks the utility process (`utilityProcess.fork` in Electron). */
  constructor(private readonly spawn: () => YdocHostChild) {}

  /** Start a listener in the utility process; resolves once its port accepts connections. */
  async listen(request: YdocListenRequest): Promise<void> {
    await this.send({ type: 'listen', id: this.nextId++, request })
    this.open.set(request.port, request)
  }

  /** Stop the listener on `port` in the utility process. */
  async close(port: number): Promise<void> {
    this.open.delete(port)
    await this.send({ type: 'close', id: this.nextId++, port })
  }

  /** Kill the utility process; every later request fails. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const child = this.child
    this.child = undefined
    this.failPending(new Error('The ydoc host was disposed.'))
    child?.kill()
  }

  private send(message: YdocHostRequest): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The ydoc host was disposed.'))
    const child = this.child ?? this.fork()
    return new Promise<void>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      child.postMessage(message)
    })
  }

  /** Fork the process, and give it back the listeners that were open (after an exit). */
  private fork(): YdocHostChild {
    const child = this.spawn()
    this.child = child
    child.on('message', (response) => this.answer(response))
    child.on('exit', (code) => this.exited(child, code))
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
    const now = Date.now()
    if (
      this.open.size > 0 &&
      (this.lastRestart == null || now - this.lastRestart > RESTART_WINDOW_MS)
    ) {
      this.lastRestart = now
      this.fork()
    }
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const { reject } of pending) reject(error)
  }
}
