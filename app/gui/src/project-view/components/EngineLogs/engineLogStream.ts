/**
 * @file `useEngineLogStream`: the open project's engine log, read from the app's local server
 * (`GET /api/engine-logs/stream`) into an {@link EngineLogModel}.
 */
import type { ToValue } from '$/utils/reactivity'
import {
  engineLogStreamUrl,
  type EngineLogEndData,
  type EngineLogEndReason,
  type EngineLogHelloData,
  type EngineLogLineData,
  type EngineLogSessionData,
  type EngineLogWaitingData,
} from 'enso-common/src/services/engineLogs'
import { onScopeDispose, reactive, shallowRef, toValue, watch, type ShallowRef } from 'vue'
import { EngineLogModel, type LogRow } from './engineLogModel'

/** The waits before each reconnection attempt; the last repeats. A `hello` starts over. */
export const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const

/** The slice of `EventSource` the stream uses. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

/** Options for {@link useEngineLogStream}. */
export interface EngineLogStreamOptions {
  /** The project's id in the GUI (`project-<encoded path>`). */
  readonly project: ToValue<string>
  /** Connected only while true: a project tab in the background holds no connection. */
  readonly active: ToValue<boolean>
  /** Tests pass a fake. */
  readonly createEventSource?: ((url: string) => EventSourceLike) | undefined
  /** Tests run frames by hand. */
  readonly requestFrame?: ((callback: () => void) => void) | undefined
}

/** What the Logs tab and the dock read. */
export interface EngineLogStreamState {
  waiting: boolean
  ended: EngineLogEndReason | undefined
  sessionId: string | null
  logFile: string | null
  unseenErrors: number
  sessionStartHeld: boolean
}

/**
 * Read the project's engine log. Events are applied to the model at once and published to `rows`
 * and `state` once per animation frame. A dropped connection is retried with backoff, resuming
 * after the last event received. An `end` with reason `closed` stops it until the project or
 * `active` changes; `not-open` (the project may still be opening) is retried with backoff.
 */
export function useEngineLogStream(options: EngineLogStreamOptions) {
  const createEventSource =
    options.createEventSource ?? ((url: string): EventSourceLike => new EventSource(url))
  const requestFrame =
    options.requestFrame ?? ((callback: () => void) => void requestAnimationFrame(callback))
  let model = new EngineLogModel()
  const rows: ShallowRef<readonly LogRow[]> = shallowRef([])
  const state = reactive<EngineLogStreamState>({
    waiting: false,
    ended: undefined,
    sessionId: null,
    logFile: null,
    unseenErrors: 0,
    sessionStartHeld: false,
  })
  let source: EventSourceLike | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let frameRequested = false

  function publish() {
    if (model.commit()) rows.value = model.rows.slice()
    state.waiting = model.waiting
    state.ended = model.ended
    state.sessionId = model.sessionId
    state.logFile = model.logFile
    state.unseenErrors = model.unseenErrors
    state.sessionStartHeld = model.sessionStartHeld
  }

  function schedulePublish() {
    if (frameRequested) return
    frameRequested = true
    requestFrame(() => {
      frameRequested = false
      publish()
    })
  }

  function parse<T>(event: MessageEvent<string>): T {
    return JSON.parse(event.data) as T
  }

  function disconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    source?.close()
    source = undefined
  }

  function scheduleReconnect() {
    if (model.ended === 'closed' || !toValue(options.active)) return
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
    attempt += 1
    reconnectTimer = setTimeout(connect, delay)
  }

  function connect() {
    disconnect()
    if (model.ended === 'closed') return
    const current = createEventSource(
      engineLogStreamUrl(toValue(options.project), model.resumeFrom()),
    )
    source = current
    const on = <T>(type: string, apply: (data: T) => void) =>
      current.addEventListener(type, (event) => {
        if (source !== current) return
        apply(parse<T>(event))
        schedulePublish()
      })
    on<EngineLogHelloData>('hello', (data) => {
      attempt = 0
      model.onHello(data)
    })
    on<EngineLogLineData>('line', (data) => model.onLine(data))
    on<EngineLogWaitingData>('waiting', (data) => model.onWaiting(data))
    on<EngineLogSessionData>('session', (data) => model.onSession(data))
    on<EngineLogEndData>('end', (data) => {
      model.onEnd(data.reason)
      disconnect()
      scheduleReconnect()
    })
    current.addEventListener('error', () => {
      if (source !== current) return
      disconnect()
      scheduleReconnect()
    })
  }

  watch(
    [() => toValue(options.active), () => toValue(options.project)] as const,
    ([active, project], previous) => {
      disconnect()
      if (previous.length > 0 && previous[1] !== project) {
        model = new EngineLogModel()
        rows.value = []
      }
      // Whatever ended the stream before no longer holds.
      model.ended = undefined
      attempt = 0
      publish()
      if (active) connect()
    },
    { immediate: true },
  )
  onScopeDispose(disconnect)

  return {
    rows,
    state,
    /** The unseen errors have been seen (the Logs tab is showing). */
    markSeen() {
      model.markSeen()
      state.unseenErrors = 0
    },
    /**
     * Put the earlier lines of `request.sessionId` (its whole history, oldest first) above the rows.
     * Discarded unless the stream still shows that session of that project: the fetch is slow, and
     * the session may have restarted or the project changed meanwhile.
     */
    loadHistory(
      lines: readonly string[],
      request: { readonly project: string; readonly sessionId: string },
    ) {
      if (request.project !== toValue(options.project) || request.sessionId !== model.sessionId)
        return
      model.prependHistory(lines)
      rows.value = model.rows.slice()
      publish()
    },
  }
}

/** The project's engine log, as the dock and the Logs tab use it. */
export type EngineLogStream = ReturnType<typeof useEngineLogStream>
