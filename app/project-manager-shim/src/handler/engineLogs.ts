/**
 * @file `GET /api/engine-logs/stream?project=<project id>[&channel=<id>&after=<seq>]`: an open
 * project's engine log as server-sent events. The wire format is in
 * `enso-common/src/services/engineLogs`. Hosts route it after `acceptLocalRequest` (#274), which
 * keeps it to the app's own window.
 */
import { AssetType, extractTypeAndPath, ProjectId } from 'enso-common/src/services/Backend'
import {
  ENGINE_LOG_HEARTBEAT_MS,
  ENGINE_LOG_STREAM_PATH,
  type EngineLogEndReason,
} from 'enso-common/src/services/engineLogs'
import type { SequencedEngineLogEvent } from '../engineLogs/channel.js'
import type { EngineLogHub } from '../engineLogs/hub.js'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_BAD_REQUEST = 400
const HTTP_STATUS_METHOD_NOT_ALLOWED = 405

/** The slice of `http.IncomingMessage` the stream uses. */
export interface EventStreamRequest {
  readonly url?: string | undefined
  readonly method?: string | undefined
  readonly destroyed?: boolean | undefined
  once(event: 'close', listener: () => void): unknown
}

/** The slice of `http.ServerResponse` the stream uses. */
export interface EventStreamResponse {
  readonly destroyed?: boolean | undefined
  once(event: 'close', listener: () => void): unknown
  writeHead(statusCode: number, headers: Record<string, string>): unknown
  flushHeaders(): void
  write(chunk: string): boolean
  end(chunk?: string): unknown
}

/** Options for {@link handleEngineLogStream}. */
export interface EngineLogStreamOptions {
  readonly heartbeatMs?: number | undefined
}

/** Whether a request URL (or path) is the engine log stream. */
export function isEngineLogStreamRequest(url: string): boolean {
  return new URL(url, 'http://localhost').pathname === ENGINE_LOG_STREAM_PATH
}

/** One server-sent event. JSON has no raw newlines, so `data` is a single line. */
export function formatServerSentEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** A channel event as the server-sent event the GUI reads. */
export function formatEngineLogEvent(event: SequencedEngineLogEvent): string {
  switch (event.type) {
    case 'line':
      return formatServerSentEvent('line', {
        seq: event.seq,
        source: event.source,
        sessionId: event.sessionId,
        text: event.text,
      })
    case 'session':
      return formatServerSentEvent('session', {
        seq: event.seq,
        sessionId: event.sessionId,
        logFile: event.logFile,
      })
    case 'waiting':
      return formatServerSentEvent('waiting', { seq: event.seq })
  }
}

/** The directory a `project` parameter names: the GUI's id of a local project. */
function projectPathOf(project: string): string | undefined {
  try {
    const { type, path } = extractTypeAndPath(ProjectId(project))
    return type === AssetType.project ? path : undefined
  } catch {
    return undefined
  }
}

function sendText(
  response: EventStreamResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  text: string,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...headers,
    ...extraHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
  })
  response.end(text)
}

/**
 * Serve the engine log stream. `hub` is the host's `ProjectService.engineLogs`, or `undefined`
 * before there is a project service (then no project is open).
 */
export function handleEngineLogStream(
  request: EventStreamRequest,
  response: EventStreamResponse,
  hub: EngineLogHub | undefined,
  headers: Readonly<Record<string, string>>,
  options: EngineLogStreamOptions = {},
): void {
  if (request.method !== 'GET') {
    sendText(response, HTTP_STATUS_METHOD_NOT_ALLOWED, headers, 'Only GET is allowed.', {
      Allow: 'GET',
    })
    return
  }
  const params = new URL(request.url ?? '', 'http://localhost').searchParams
  const projectPath = projectPathOf(params.get('project') ?? '')
  const afterParam = params.get('after')
  const after = afterParam == null ? undefined : Number(afterParam)
  if (projectPath == null || (after != null && (!Number.isSafeInteger(after) || after < 0))) {
    sendText(
      response,
      HTTP_STATUS_BAD_REQUEST,
      headers,
      'Expected ?project=<project id>, optionally with &channel=<id>&after=<sequence number>.',
    )
    return
  }

  response.writeHead(HTTP_STATUS_OK, {
    ...headers,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()

  const channel = hub?.get(projectPath)
  if (channel == null) {
    response.write(
      formatServerSentEvent('end', { reason: 'not-open' satisfies EngineLogEndReason }),
    )
    response.end()
    return
  }

  let finished = false
  /** What to undo when the stream stops: the subscription and the heartbeat. */
  const cleanups: (() => void)[] = []
  /** Stop sending: the client went away, or the stream is over. */
  const finish = () => {
    if (finished) return
    finished = true
    for (const cleanup of cleanups) cleanup()
  }
  /** Write unless finished. The socket may be gone already: then the stream is finished, quietly. */
  const send = (chunk: string) => {
    if (finished) return
    try {
      response.write(chunk)
    } catch {
      finish()
    }
  }
  const endStream = (reason: EngineLogEndReason) => {
    if (finished) return
    send(formatServerSentEvent('end', { reason }))
    finish()
    try {
      response.end()
    } catch {
      // The socket is gone: nothing left to end.
    }
  }

  // A reply to a closed connection has no one to read it, so this comes before any write.
  request.once('close', finish)
  response.once('close', finish)
  const subscription = channel.subscribe(
    {
      event: (event) => send(formatEngineLogEvent(event)),
      end: endStream,
    },
    { channel: params.get('channel') ?? undefined, after },
  )
  cleanups.push(subscription.unsubscribe)
  send(formatServerSentEvent('hello', subscription.hello))
  for (const event of subscription.replay) send(formatEngineLogEvent(event))
  if (subscription.closed) {
    endStream('closed')
    return
  }
  // A write failed during the replay, or the connection closed before we got here (its `close`
  // event is already past): the client is gone.
  if (request.destroyed === true || response.destroyed === true) finish()
  if (finished) return
  const heartbeat = setInterval(
    () => send(': heartbeat\n\n'),
    options.heartbeatMs ?? ENGINE_LOG_HEARTBEAT_MS,
  )
  cleanups.push(() => clearInterval(heartbeat))
}
