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

/** Open one channel socket; rejects when it fails to open. */
function openChannel(rpcPort: number, token: string, kind: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${rpcPort}/channel/${kind}?token=${encodeURIComponent(token)}`,
      { maxPayload: 0 },
    )
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
 * Play an IDE open: initialise a session, create an execution context and push `main`, wait for
 * the execution to complete, then attach the welcome node's table visualisation and wait for its
 * first answer (data, or a `ready`/`failed` message). Throws on a timeout, an abort, a failed
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
  const stopped = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`The training open did not finish in ${options.timeoutMs} ms`)),
      options.timeoutMs,
    )
    onAbort = () => reject(new DOMException('The training open was aborted', 'AbortError'))
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
  stopped.catch(() => undefined)
  try {
    await Promise.race([stopped, play(options, name, nodeId, sockets, stopped)])
  } finally {
    clearTimeout(timeout)
    if (onAbort) options.signal?.removeEventListener('abort', onAbort)
    for (const socket of sockets) socket.terminate()
  }
}

async function play(
  options: DriveOpenOptions,
  name: string,
  nodeId: string | undefined,
  sockets: WebSocket[],
  stopped: Promise<never>,
): Promise<void> {
  const [json, control, data] = await Promise.all(
    ['json', 'vis-control', 'vis-data'].map((kind) =>
      openChannel(options.rpcPort, options.token, kind).then((socket) => {
        sockets.push(socket)
        return socket
      }),
    ),
  )
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const notifications = new Map<string, (params: unknown) => void>()
  let closed: (error: Error) => void = () => {}
  const socketClosed = new Promise<never>((_, reject) => (closed = reject))
  socketClosed.catch(() => undefined)
  for (const socket of [json, control, data]) {
    socket!.once('close', () => closed(new Error('The Language Server closed a channel')))
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
  await Promise.race([executed, socketClosed, stopped])

  if (nodeId == null) return
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
  await Promise.race([shown, socketClosed, stopped])
}
