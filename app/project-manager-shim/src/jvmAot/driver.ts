/**
 * @file A headless driver that plays an IDE open against a Language Server, so that a JVM recording
 * its AOT training data sees what an open does (spec, stage 1d "Training"). It talks to the
 * Language Server's channel sockets (`/channel/{kind}?token=`), as the Node ydoc host does: the
 * JSON-RPC session on `json`, the visualisation bridge on `vis-control` and `vis-data`.
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { WebSocket } from 'ws'
import * as yaml from 'yaml'

/** What {@link driveOpen} needs. */
export interface DriveOpenOptions {
  /** The Language Server's RPC port, which serves the channel sockets. */
  readonly rpcPort: number
  /** The engine's `LANGUAGE_SERVER_CHANNEL_TOKEN`. */
  readonly token: string
  /** The project the engine was started on. */
  readonly projectRoot: string
  /** How long the whole open may take before it is abandoned. */
  readonly timeoutMs: number
  /** Ends the drive early (the training was killed). */
  readonly signal?: AbortSignal
}

const METADATA_MARKER = '#### METADATA ####'

/**
 * The node the template shows a visualisation for: the id in `Main.enso`'s IDE metadata whose
 * `visualization.show` is `true` (ruling 12 of the plan; the welcome template's is
 * `fcf199e6-d2b1-44b7-be92-a47545d6a593`).
 */
export function welcomeNodeId(mainEnsoText: string): string | undefined {
  const marker = mainEnsoText.indexOf(METADATA_MARKER)
  if (marker < 0) return undefined
  for (const line of mainEnsoText.slice(marker + METADATA_MARKER.length).split(/\r?\n/)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const nodes = (parsed as { ide?: { node?: unknown } } | null)?.ide?.node
    if (nodes == null || typeof nodes !== 'object') continue
    for (const [id, node] of Object.entries(nodes as Record<string, unknown>)) {
      const show = (node as { visualization?: { show?: unknown } } | null)?.visualization?.show
      if (show === true) return id
    }
  }
  return undefined
}

/** The project's name, from its `package.yaml`. */
async function projectName(projectRoot: string): Promise<string> {
  const parsed: unknown = yaml.parse(
    await fs.readFile(path.join(projectRoot, 'package.yaml'), 'utf8'),
  )
  const name = (parsed as { name?: unknown } | null)?.name
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${projectRoot}/package.yaml has no name`)
  }
  return name
}

/** Open one channel socket (added to `sockets` at once, to be closed); rejects when it fails to open. */
function openChannel(
  rpcPort: number,
  token: string,
  kind: string,
  sockets: WebSocket[],
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${rpcPort}/channel/${kind}?token=${encodeURIComponent(token)}`,
      { maxPayload: 0 },
    )
    sockets.push(socket)
    socket.once('open', () => resolve(socket))
    socket.once('error', (error) => reject(new Error(`Channel ${kind}: ${error.message}`)))
  })
}

interface JsonRpcMessage {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

/**
 * Play an IDE open: initialise a session, create an execution context and push `main`, attach the
 * welcome node's table visualisation, then wait for the execution to complete and for the
 * visualisation's first answer (data, or a `ready`/`failed` message). Throws on a timeout, an abort, a failed
 * request or an `executionFailed`.
 */
export async function driveOpen(options: DriveOpenOptions): Promise<void> {
  const name = await projectName(options.projectRoot)
  const nodeId = welcomeNodeId(
    await fs.readFile(path.join(options.projectRoot, 'src', 'Main.enso'), 'utf8').catch(() => ''),
  )
  const sockets: WebSocket[] = []
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  let over = false
  const stopped = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      over = true
      reject(new Error(`The training open did not finish in ${options.timeoutMs} ms`))
    }, options.timeoutMs)
    onAbort = () => {
      over = true
      reject(new DOMException('The training open was aborted', 'AbortError'))
    }
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
  stopped.catch(() => undefined)
  try {
    await Promise.race([stopped, play(options, name, nodeId, sockets, stopped, () => over)])
  } finally {
    clearTimeout(timeout)
    if (onAbort) options.signal?.removeEventListener('abort', onAbort)
    for (const socket of sockets) socket.terminate()
  }
}

/* Note [The Health Check Passes Before The Language Server Is Ready]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The Language Server binds its port, and answers `/_health`, while it is still initialising: on
 * the Windows bundle (JVM, recording) `/_health` passed some 20 s before the log's `Started server
 * at json`. A channel socket opened in that window is accepted and then dropped (`1006`, no close
 * frame). The GUI reconnects; the driver likewise opens its sockets and initialises the session
 * again, once a second, until the session is initialised or the drive's time is up.
 */
const RECONNECT_DELAY_MS = 1000

/** The channel sockets of one initialised session, and its JSON-RPC requests. */
interface Session {
  readonly control: WebSocket
  readonly data: WebSocket
  readonly request: (method: string, params: unknown) => Promise<unknown>
  readonly notifications: Map<string, (params: unknown) => void>
  /** Rejects when any of the sockets closes. */
  readonly socketClosed: Promise<never>
}

/** Open the three sockets and initialise a session; rejects when a socket fails or closes first. */
async function connect(
  options: DriveOpenOptions,
  sockets: WebSocket[],
  stopped: Promise<never>,
): Promise<Session> {
  const [json, control, data] = await Promise.race([
    Promise.all(
      ['json', 'vis-control', 'vis-data'].map((kind) =>
        openChannel(options.rpcPort, options.token, kind, sockets),
      ),
    ),
    stopped,
  ])
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const notifications = new Map<string, (params: unknown) => void>()
  let closed: (error: Error) => void = () => {}
  const socketClosed = new Promise<never>((_, reject) => (closed = reject))
  socketClosed.catch(() => undefined)
  for (const [kind, socket] of [
    ['json', json],
    ['vis-control', control],
    ['vis-data', data],
  ] as const) {
    socket!.once('close', (code, reason) =>
      closed(new Error(`The Language Server closed the ${kind} channel (${code} ${reason})`)),
    )
  }
  json!.on('message', (raw) => {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(raw.toString()) as JsonRpcMessage
    } catch {
      return
    }
    if (message.id != null && pending.has(message.id)) {
      const request = pending.get(message.id)!
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? 'JSON-RPC error'))
      else request.resolve(message.result)
    } else if (message.method != null) {
      notifications.get(message.method)?.(message.params)
    }
  })
  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = nextId++
    const answer = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
    json!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    return Promise.race([answer, socketClosed, stopped])
  }

  await request('session/initProtocolConnection', { clientId: crypto.randomUUID() })
  return { control: control!, data: data!, request, notifications, socketClosed }
}

async function play(
  options: DriveOpenOptions,
  name: string,
  nodeId: string | undefined,
  sockets: WebSocket[],
  stopped: Promise<never>,
  isOver: () => boolean,
): Promise<void> {
  let session: Session
  for (;;) {
    const attempt: WebSocket[] = []
    try {
      session = await connect(options, attempt, stopped)
      sockets.push(...attempt)
      break
    } catch (error) {
      for (const socket of attempt) socket.terminate()
      // A refused token (403) is a misconfiguration, not a server still starting.
      if (isOver() || /Unexpected server response: 403/.test(String(error))) throw error
      // Note [The Health Check Passes Before The Language Server Is Ready]
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS)),
        stopped,
      ])
    }
  }
  const { control, data, request, notifications, socketClosed } = session
  const created = (await request('executionContext/create', {
    contextId: crypto.randomUUID(),
  })) as { contextId?: string } | null
  const contextId = created?.contextId
  if (typeof contextId !== 'string') throw new Error('executionContext/create gave no contextId')

  const executed = new Promise<void>((resolve, reject) => {
    notifications.set('executionContext/executionComplete', (params) => {
      if ((params as { contextId?: unknown } | null)?.contextId === contextId) resolve()
    })
    notifications.set('executionContext/executionFailed', (params) => {
      const failed = params as { contextId?: unknown; message?: unknown } | null
      if (failed?.contextId === contextId) {
        reject(new Error(`The training execution failed: ${String(failed.message)}`))
      }
    })
  })
  executed.catch(() => undefined)
  const module = `local.${name}.Main`
  await request('executionContext/push', {
    contextId,
    stackItem: {
      type: 'ExplicitCall',
      methodPointer: { module, definedOnType: module, name: 'main' },
      positionalArgumentsExpressions: [],
    },
  })
  // Note [The Driver Attaches Before The Execution Completes]
  if (nodeId == null) {
    await Promise.race([executed, socketClosed, stopped])
    return
  }
  const requestId = crypto.randomUUID()
  const shown = new Promise<void>((resolve) => {
    data!.once('message', () => resolve())
    control!.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { kind?: unknown; requestId?: unknown }
        if (
          message.requestId === requestId &&
          (message.kind === 'ready' || message.kind === 'failed')
        ) {
          resolve()
        }
      } catch {
        // Not JSON: not an answer to this attach.
      }
    })
  })
  const table = 'Standard.Visualization.Table.Visualization'
  control!.send(
    JSON.stringify({
      kind: 'attach',
      requestId,
      visualizationId: crypto.randomUUID(),
      contextId,
      nodeExternalId: nodeId,
      request: {
        visualizationModule: table,
        expression: { module: table, definedOnType: table, name: 'prepare_visualization' },
        positionalArgumentsExpressions: ['1000'],
      },
    }),
  )
  await Promise.race([Promise.all([executed, shown]), socketClosed, stopped])
}

/* Note [The Driver Attaches Before The Execution Completes]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The GUI attaches the welcome node's visualisation as it connects, before the first execution
 * has finished, and so does the driver: right after the push, then it waits for both. Measured on
 * the Windows bundle (JVM, 2026-11-05): with no visualisation attached, `executionComplete` did not
 * come within 150 s (8 minutes with the AOT recording on), the execution reporting nothing after
 * its first `executionStatus`; attaching made the update, the visualisation's data and
 * `executionComplete` arrive within a second. Waiting for the execution before attaching, as the
 * plan first had it, never finished.
 */
