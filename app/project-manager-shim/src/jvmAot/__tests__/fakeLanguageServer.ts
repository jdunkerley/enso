/**
 * @file A fake Language Server for the AOT training tests: `/_health`, and the channel sockets
 * (`/channel/{kind}?token=`) with just enough of the protocol for `driveOpen`. The trainer test's
 * fake `enso` imports it from a plain Node script, so it uses only erasable TypeScript syntax.
 */
import * as crypto from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

export interface FakeLanguageServerOptions {
  readonly token: string
  /** 0 (the default) for any free port. */
  readonly port?: number
  /** How long after `executionContext/push` it reports `executionComplete`; `null`: never. */
  readonly completeAfterMs?: number | null
  /**
   * How many channel sockets it accepts and then drops with no close frame, as a Language Server
   * that answers `/_health` before it has initialised does.
   */
  readonly dropFirst?: number
}

/** A message a client sent, in the order received. */
export interface ReceivedMessage {
  readonly channel: string
  readonly message: unknown
}

export interface FakeLanguageServer {
  readonly port: number
  readonly received: ReceivedMessage[]
  close(): Promise<void>
}

const KINDS = new Set(['json', 'binary', 'vis-control', 'vis-data'])

/** Start the fake on `127.0.0.1`. */
export async function startFakeLanguageServer(
  options: FakeLanguageServerOptions,
): Promise<FakeLanguageServer> {
  const received: ReceivedMessage[] = []
  const sockets = new Map<string, WebSocket>()
  let dropped = 0
  const server = http.createServer((request, response) => {
    if (request.url === '/_health') response.end('OK')
    else {
      response.statusCode = 404
      response.end()
    }
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const kind = url.pathname.replace(/^\/channel\//, '')
    if (!url.pathname.startsWith('/channel/') || !KINDS.has(kind)) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      return
    }
    if (url.searchParams.get('token') !== options.token) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (dropped < (options.dropFirst ?? 0)) {
        dropped += 1
        setTimeout(() => ws.terminate(), 50)
        return
      }
      sockets.set(kind, ws)
      ws.on('message', (raw, isBinary) => {
        const text = isBinary ? undefined : raw.toString()
        const message: unknown = text != null ? JSON.parse(text) : raw
        received.push({ channel: kind, message })
        if (kind === 'json') answerJson(ws, message)
        else if (kind === 'vis-control') answerControl(message)
      })
    })
  })

  function answerJson(ws: WebSocket, message: unknown): void {
    const { id, method, params } = message as {
      id: number
      method: string
      params: Record<string, unknown>
    }
    const reply = (result: unknown) => ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
    switch (method) {
      case 'session/initProtocolConnection':
        reply({ ensoVersion: '0.0.0-dev', currentEditionName: 'dev', contentRoots: [] })
        break
      case 'executionContext/create': {
        const contextId = (params.contextId as string | undefined) ?? crypto.randomUUID()
        reply({ contextId, canModify: {}, receivesUpdates: {} })
        break
      }
      case 'executionContext/push': {
        reply(null)
        const after = options.completeAfterMs === undefined ? 100 : options.completeAfterMs
        if (after != null) {
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'executionContext/executionComplete',
                params: { contextId: params.contextId },
              }),
            )
          }, after)
        }
        break
      }
      default:
        reply(null)
    }
  }

  function answerControl(message: unknown): void {
    const { kind, requestId } = message as { kind: string; requestId: string }
    if (kind !== 'attach') return
    sockets.get('vis-control')?.send(JSON.stringify({ kind: 'ready', requestId }))
    sockets.get('vis-data')?.send(Buffer.from([1, 2, 3]))
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve())
  })
  return {
    port: (server.address() as AddressInfo).port,
    received,
    close: async () => {
      for (const ws of wss.clients) ws.terminate()
      wss.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
