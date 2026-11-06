import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { YjsChannel, type YjsChannelServer } from 'ydoc-channel'
import { LanguageServerSession } from '../languageServerSession'
import { setupGatewayClient, type YjsSocket } from '../ydoc'
import type { JavaByteBuffer, JavaByteBufferClass } from '../YjsBinaryChannel'

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

const LS_URL = 'gui-rpc-binary-channel-test'

/** A Language Server that answers the session's start-up requests, so the session settles. */
const jsonServer: YjsChannelServer = {
  onConnect: (untypedChannel) => {
    const channel = untypedChannel as YjsChannel<string>
    channel.subscribe((raw) => {
      const message = JSON.parse(raw)
      if (typeof message.method !== 'string' || message.id == null) return
      const result =
        message.method === 'session/initProtocolConnection' ?
          { contentRoots: [{ type: 'Project', id: '00000000-0000-0000-0000-0000000000aa' }] }
        : message.method === 'file/list' ? { paths: [] }
        : null
      queueMicrotask(() => channel.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })))
    })
  },
}

/**
 * The polyglot `java.nio.ByteBuffer` stand-in: a "buffer" is just its length, which is what
 * `new ArrayBuffer(buffer)` takes on both runtimes.
 */
const byteBuffer: JavaByteBufferClass = { allocateDirect: (capacity) => capacity as JavaByteBuffer }

/**
 * Stands in for the Language Server's binary channel callbacks (`BinaryYdocServer`): every channel
 * it is handed answers each request with a reply one byte longer.
 */
function fakeBinaryServer() {
  let connections = 0
  const server: YjsChannelServer<JavaByteBuffer> = {
    onConnect: (untypedChannel) => {
      const channel = untypedChannel as YjsChannel<JavaByteBuffer>
      connections += 1
      channel.subscribe((request) => channel.send((request + 1) as JavaByteBuffer))
    },
  }
  return { server, connections: () => connections }
}

/** A socket that stays open until the test closes it, like the client going away. */
class MockSocket implements YjsSocket {
  binaryType = 'arraybuffer' as const
  readyState: YjsSocket['readyState'] = WebSocket.OPEN
  private closeListeners: (() => void)[] = []
  on(event: string, listener: (...args: any[]) => void): this {
    if (event === 'close') this.closeListeners.push(listener)
    return this
  }
  send(): void {}
  ping(): void {}
  close(): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    for (const listener of this.closeListeners) listener()
  }
}

/** Open a gateway connection to the project's index doc, as the GUI does. */
function connect(binary: YjsChannelServer<JavaByteBuffer>, dataUrl: string | null): MockSocket {
  const socket = new MockSocket()
  setupGatewayClient(
    socket,
    LS_URL,
    dataUrl,
    'index',
    byteBuffer,
    jsonServer,
    binary,
    { onConnect: () => {} },
    { onConnect: () => {} },
  )
  return socket
}

/**
 * Send one binary request the way the GUI's `DataServer` does: on a channel of its own over the
 * index doc's array named after the data URL. Resolves to the replies heard within a short wait.
 */
async function binaryRequest(dataUrl: string): Promise<number[]> {
  const session = LanguageServerSession.sessions.get(LS_URL)
  expect(session).toBeDefined()
  const client = new YjsChannel<Uint8Array>(session!.indexDoc.doc, dataUrl)
  const replies: number[] = []
  client.subscribe((reply) => replies.push(reply.byteLength))
  client.send(new Uint8Array(4))
  await new Promise((resolve) => setTimeout(resolve, 50))
  client.close()
  return replies
}

/** Let the asynchronous `close` handlers of `setupGatewayClient` (session release) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('setupGatewayClient binary channel (#396)', () => {
  const open: MockSocket[] = []
  // A data URL of its own per test, so that no test can see a channel another one left behind.
  let dataUrl = ''
  let testCount = 0
  beforeEach(() => {
    dataUrl = `gui-data-binary-channel-test-${testCount++}`
  })
  afterEach(async () => {
    for (const socket of open.splice(0)) socket.close()
    await settle()
    expect(LanguageServerSession.sessions.size).toBe(0)
  })

  test('a reconnecting client is answered after its previous connection closed', async () => {
    const binary = fakeBinaryServer()
    // Another client keeps the session (and so the index doc) alive throughout.
    open.push(connect(binary.server, null))

    const first = connect(binary.server, dataUrl)
    expect(await binaryRequest(dataUrl)).toEqual([5])
    first.close()
    await settle()

    open.push(connect(binary.server, dataUrl))
    expect(await binaryRequest(dataUrl)).toEqual([5])
    expect(binary.connections()).toBe(2)
  })

  test('a client is answered after the session was released and started again', async () => {
    const binary = fakeBinaryServer()
    const first = connect(binary.server, dataUrl)
    expect(await binaryRequest(dataUrl)).toEqual([5])
    first.close()
    await settle()
    expect(LanguageServerSession.sessions.size).toBe(0)

    open.push(connect(binary.server, dataUrl))
    expect(await binaryRequest(dataUrl)).toEqual([5])
  })

  test('closing one of two connections sharing a data URL keeps the channel for the other', async () => {
    const binary = fakeBinaryServer()
    // The GUI connects the index doc and each module doc with the same `data` parameter.
    open.push(connect(binary.server, dataUrl))
    const second = connect(binary.server, dataUrl)
    second.close()
    await settle()

    // Answered exactly once: the connections share one Language Server connection.
    expect(await binaryRequest(dataUrl)).toEqual([5])
    expect(binary.connections()).toBe(1)
  })
})

describe('setupGatewayClient with an unknown document', () => {
  afterEach(async () => {
    await settle()
  })

  test('a connection to a document the session does not have does not keep the session', async () => {
    // A GUI that outlived its session (its Language Server restarted, under the Node ydoc host)
    // reconnects its module docs by their old ids; the new session has none of them. Each such
    // connection is refused, and must not hold the session: one that is never released keeps its
    // Language Server client, which later reconnects and takes the modules' write capabilities
    // from the session the GUI is using.
    const index = new MockSocket()
    setupGatewayClient(
      index,
      LS_URL,
      null,
      'index',
      byteBuffer,
      jsonServer,
      fakeBinaryServer().server,
      { onConnect: () => {} },
      { onConnect: () => {} },
    )
    const stale = new MockSocket()
    setupGatewayClient(
      stale,
      LS_URL,
      null,
      'a-module-doc-of-an-earlier-session',
      byteBuffer,
      jsonServer,
      fakeBinaryServer().server,
      { onConnect: () => {} },
      { onConnect: () => {} },
    )
    expect(stale.readyState).toBe(WebSocket.CLOSED)
    await settle()
    expect(LanguageServerSession.sessions.size).toBe(1)

    index.close()
    await settle()
    expect(LanguageServerSession.sessions.size).toBe(0)
  })

  test('a module document asked for with no session creates no session', () => {
    // The GUI's stale module-doc reconnects can reach the listener before its index reconnect;
    // no session can have such a document, so none is built (and torn down) to find that out.
    const stale = new MockSocket()
    const inspect = { registerSession: vi.fn(), unregisterSession: vi.fn() }
    setupGatewayClient(
      stale,
      LS_URL,
      null,
      'a-module-doc-of-an-earlier-session',
      byteBuffer,
      jsonServer,
      fakeBinaryServer().server,
      { onConnect: () => {} },
      { onConnect: () => {} },
      inspect as never,
    )
    expect(stale.readyState).toBe(WebSocket.CLOSED)
    expect(LanguageServerSession.sessions.size).toBe(0)
    // Not even registered for inspection: no session was built.
    expect(inspect.registerSession).not.toHaveBeenCalled()
  })
})
