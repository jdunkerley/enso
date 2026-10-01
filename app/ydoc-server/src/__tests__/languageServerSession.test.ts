import type { Result } from 'enso-common/src/utilities/data/result'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { YjsChannel, YjsChannelServer } from 'ydoc-channel'
import { LanguageServerSession } from '../languageServerSession'
import type { JavaByteBufferClass } from '../YjsBinaryChannel'

// Polyfill DOM event types that are missing from some Node.js versions.
if (typeof globalThis.CloseEvent === 'undefined') {
  ;(globalThis as any).CloseEvent = class CloseEvent extends Event {}
}
if (typeof globalThis.MessageEvent === 'undefined') {
  ;(globalThis as any).MessageEvent = class MessageEvent extends Event {
    data: any
    constructor(type: string, options?: any) {
      super(type, options)
      this.data = options?.data
    }
  }
}
if (typeof globalThis.ErrorEvent === 'undefined') {
  ;(globalThis as any).ErrorEvent = class ErrorEvent extends Event {
    error: any
    message: string
    constructor(type: string, options?: any) {
      super(type, options)
      this.error = options?.error
      this.message = options?.message || ''
    }
  }
}

const PROJECT_ROOT = '00000000-0000-0000-0000-0000000000aa'

/**
 * Stands in for the Language Server's JSON-RPC channel callbacks (`YdocJsonRpcServer.ServerCallbacks`):
 * every channel it is handed becomes a numbered connection, and every request is answered on the
 * connection it arrived on.
 */
function fakeLanguageServer() {
  const requests: { connection: number; method: string }[] = []
  let connections = 0
  const server: YjsChannelServer = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<string>
      const connection = connections++
      channel.subscribe((raw) => {
        const message = JSON.parse(raw)
        if (typeof message.method !== 'string' || message.id == null) return
        requests.push({ connection, method: message.method })
        const result =
          message.method === 'session/initProtocolConnection' ?
            { contentRoots: [{ type: 'Project', id: PROJECT_ROOT }] }
          : message.method === 'file/list' ? { paths: [] }
          : null
        queueMicrotask(() =>
          channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })),
        )
      })
    },
  }
  return { server, requests, connections: () => connections }
}

const noChannels: YjsChannelServer<any> = { onConnect: () => {} }

describe('LanguageServerSession', () => {
  let session: LanguageServerSession | undefined

  afterEach(async () => {
    await session?.release()
    session = undefined
  })

  test('restarting the client re-reads the initial state over a new connection', async () => {
    const ls = fakeLanguageServer()
    session = LanguageServerSession.get(
      'ws://restart-test',
      ls.server,
      noChannels,
      noChannels,
      {} as JavaByteBufferClass,
    )
    await vi.waitFor(() => expect(ls.requests.map((r) => r.method)).toContain('file/list'))
    const connectionsBefore = ls.connections()
    const requestsBefore = ls.requests.length

    // `restartClient` is what the session does when handling a Language Server event fails.
    const restartClient = (session as any).restartClient.bind(session) as () => Promise<
      Result<void>
    >
    const result = await restartClient()
    expect(result.ok).toBe(true)

    const afterRestart = ls.requests.slice(requestsBefore)
    expect(afterRestart.map((r) => r.method)).toEqual(
      expect.arrayContaining(['session/initProtocolConnection', 'file/list']),
    )
    // Only the connection made by the restart serves requests; the earlier ones are closed.
    expect(ls.connections()).toBeGreaterThan(connectionsBefore)
    for (const request of afterRestart) {
      expect(request.connection).toBeGreaterThanOrEqual(connectionsBefore)
    }
  })
})
