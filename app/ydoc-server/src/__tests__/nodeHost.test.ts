import * as net from 'node:net'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { LanguageServerSession } from '../languageServerSession'
import { NodeYdocHost } from '../nodeHost'

const PROJECT_ROOT = '00000000-0000-0000-0000-0000000000bb'

// The race tests below open and close sockets 50 times each.
vi.setConfig({ testTimeout: 60_000 })

/** Ask the OS for a free port. */
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** Resolves when a TCP connection to `port` succeeds, rejects when it is refused. */
function connectTcp(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
  })
}

/**
 * A Language Server as the Node host sees it: `/channel/{kind}` WebSockets. The `json` channel
 * answers JSON-RPC (every request with `null`, except those the ydoc session needs an answer for).
 */
class FakeLanguageServer {
  readonly urls: string[] = []
  readonly sockets: { kind: string; socket: WebSocket }[] = []
  private server!: WebSocketServer
  port = 0

  async start() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    this.server.on('connection', (socket, request) => {
      const url = request.url ?? ''
      this.urls.push(url)
      const kind = /^\/channel\/([a-z-]+)/.exec(url)?.[1] ?? ''
      this.sockets.push({ kind, socket })
      if (kind !== 'json') return
      socket.on('message', (data) => {
        const message = JSON.parse(String(data))
        if (typeof message.method !== 'string' || message.id == null) return
        const result =
          message.method === 'session/initProtocolConnection' ?
            { contentRoots: [{ type: 'Project', id: PROJECT_ROOT }] }
          : message.method === 'file/list' ? { paths: [] }
          : null
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      })
    })
    await new Promise((resolve) => this.server.once('listening', resolve))
    this.port = (this.server.address() as net.AddressInfo).port
  }

  address() {
    return { host: '127.0.0.1', port: this.port, token: 't' }
  }

  /** The currently open sockets of one channel kind. */
  open(kind: string) {
    return this.sockets.filter((s) => s.kind === kind && s.socket.readyState === WebSocket.OPEN)
  }

  /** Close every channel socket, as an exiting Language Server would. */
  closeAll() {
    for (const { socket } of this.sockets) socket.close()
  }

  async stop() {
    for (const { socket } of this.sockets) socket.terminate()
    await new Promise((resolve) => this.server.close(resolve))
  }
}

let ls: FakeLanguageServer
let host: NodeYdocHost
let port: number
const guis: WebSocket[] = []

beforeEach(async () => {
  ls = new FakeLanguageServer()
  await ls.start()
  host = new NodeYdocHost()
  port = await freePort()
  await host.listen({ host: '127.0.0.1', port, languageServer: ls.address() })
})

afterEach(async () => {
  for (const gui of guis.splice(0)) gui.terminate()
  await host.closeAll()
  await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
  await ls.stop()
})

/** Connect like the GUI: to a doc of the project, optionally with a data channel name. */
function connectGui(doc: string, data?: string): WebSocket {
  const query = `ls=ws://127.0.0.1:${ls.port}` + (data ? `&data=${data}` : '')
  const gui = new WebSocket(`ws://127.0.0.1:${port}/project/${doc}?${query}`)
  guis.push(gui)
  return gui
}

/** The first message the socket receives; the listener is attached before the socket opens. */
function firstMessage(gui: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    gui.once('message', (data: Buffer) => resolve(new Uint8Array(data)))
    gui.once('close', () => reject(new Error('closed before the first message')))
  })
}

function closed(gui: WebSocket): Promise<void> {
  return gui.readyState === WebSocket.CLOSED ?
      Promise.resolve()
    : new Promise((resolve) => gui.once('close', () => resolve()))
}

/** `YjsServerTransport` hands the Language Server two JSON channels per session: the GUI's proxy and the ydoc server's own. */
const JSON_SOCKETS = 2

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test('listen resolves once the port accepts, and close frees it', async () => {
  await expect(connectTcp(port)).resolves.toBeUndefined()
  await host.close(port)
  await expect(connectTcp(port)).rejects.toThrow()
  await host.close(port) // an unknown port is a no-op
})

test('a second listen on a port replaces the first listener', async () => {
  await host.listen({ host: '127.0.0.1', port, languageServer: ls.address() })
  await expect(connectTcp(port)).resolves.toBeUndefined()
})

test('a GUI socket on /project/index reaches the LS json channel with the token', async () => {
  connectGui('index')
  await vi.waitFor(() => expect(ls.urls).toContain('/channel/json?token=t'))
})

test('a data parameter opens the binary channel', async () => {
  connectGui('index', 'gui-data-1')
  await vi.waitFor(() => expect(ls.urls).toContain('/channel/binary?token=t'))
})

test('a socket without a document is closed', async () => {
  const bad = new WebSocket(`ws://127.0.0.1:${port}/nowhere`)
  guis.push(bad)
  await closed(bad)
})

test('the LS going away closes the GUI sockets', async () => {
  const gui = connectGui('index')
  await firstMessage(gui)
  await vi.waitFor(() => expect(ls.open('json')).toHaveLength(JSON_SOCKETS))
  ls.closeAll()
  await closed(gui)
  expect(gui.readyState).toBe(WebSocket.CLOSED)
})

// The four socket races found on the engine-hosted server (JVM + GraalJS), tested again on this
// transport: each runs its cycle 50 times.
const CYCLES = 50

test('#214: the first message on open is never lost', async () => {
  for (let i = 0; i < CYCLES; i++) {
    const gui = connectGui('index')
    const first = await firstMessage(gui)
    expect(first.byteLength).toBeGreaterThan(0)
    gui.close()
    await closed(gui)
    await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
  }
})

test('#396: the shared data channel outlives one socket and closes with the last', async () => {
  for (let i = 0; i < CYCLES; i++) {
    const before = ls.sockets.length
    const a = connectGui('index', 'gui-data-x')
    const b = connectGui('index', 'gui-data-x')
    await Promise.all([firstMessage(a), firstMessage(b)])
    const binary = () => ls.sockets.slice(before).filter((s) => s.kind === 'binary')
    await vi.waitFor(() => expect(binary()).toHaveLength(1))
    a.close()
    await closed(a)
    // The channel is still alive for b: not a new one, and not closed.
    await settle()
    expect(binary()).toHaveLength(1)
    expect(binary()[0]!.socket.readyState).toBe(WebSocket.OPEN)
    b.close()
    await closed(b)
    await vi.waitFor(() => expect(binary()[0]!.socket.readyState).toBe(WebSocket.CLOSED))
    await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
  }
})

test('#409: closing a socket releases the session once', async () => {
  for (let i = 0; i < CYCLES; i++) {
    const before = ls.sockets.length
    const a = connectGui('index')
    const b = connectGui('index')
    await Promise.all([firstMessage(a), firstMessage(b)])
    const json = () => ls.sockets.slice(before).filter((s) => s.kind === 'json')
    await vi.waitFor(() => expect(json()).toHaveLength(JSON_SOCKETS))
    // A double release for `a` would dispose the session while `b` still uses it.
    a.close()
    await closed(a)
    await settle()
    expect(LanguageServerSession.sessions.size).toBe(1)
    expect(json().every((s) => s.socket.readyState === WebSocket.OPEN)).toBe(true)
    b.close()
    await closed(b)
    await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
    await vi.waitFor(() =>
      expect(json().every((s) => s.socket.readyState === WebSocket.CLOSED)).toBe(true),
    )
  }
})

test('#494: terminating the listener locally does not hang and releases the session', async () => {
  for (let i = 0; i < CYCLES; i++) {
    const before = ls.sockets.length
    const gui = connectGui('index', 'gui-data-x')
    await firstMessage(gui)
    await host.close(port)
    await closed(gui)
    await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
    await vi.waitFor(() =>
      expect(ls.sockets.slice(before).every((s) => s.socket.readyState !== WebSocket.OPEN)).toBe(
        true,
      ),
    )
    await host.listen({ host: '127.0.0.1', port, languageServer: ls.address() })
  }
})
