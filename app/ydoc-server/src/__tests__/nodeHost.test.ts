import * as net from 'node:net'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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

  async start(port = 0) {
    this.server = new WebSocketServer({ host: '127.0.0.1', port })
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

test('a server error after listening is logged, and the host stays up', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const server = (
    host as unknown as { listeners: Map<number, { server: NodeJS.EventEmitter }> }
  ).listeners.get(port)!.server
  expect(() => server.emit('error', new Error('first'))).not.toThrow()
  expect(() => server.emit('error', new Error('second'))).not.toThrow()
  expect(error).toHaveBeenCalledTimes(2)
  error.mockRestore()
  await expect(connectTcp(port)).resolves.toBeUndefined()
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

test('a socket without a document is refused', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const bad = new WebSocket(`ws://127.0.0.1:${port}/nowhere`)
  guis.push(bad)
  await expect(new Promise((_, reject) => bad.once('error', reject))).rejects.toThrow('400')
  warn.mockRestore()
})

test('the LS going away closes the GUI sockets', async () => {
  const gui = connectGui('index')
  await firstMessage(gui)
  await vi.waitFor(() => expect(ls.open('json')).toHaveLength(JSON_SOCKETS))
  ls.closeAll()
  await closed(gui)
  expect(gui.readyState).toBe(WebSocket.CLOSED)
})

test('a bad frame closes that GUI socket only', async () => {
  const good = connectGui('index')
  await firstMessage(good)
  const bad = new WebSocket(`ws://127.0.0.1:${port}/project/index?ls=ws://127.0.0.1:${ls.port}`, {
    skipUTF8Validation: true,
  })
  guis.push(bad)
  await new Promise((resolve) => bad.once('open', resolve))
  bad.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false }) // text frame, invalid UTF-8
  await closed(bad)
  // The host and the other socket are unharmed.
  expect(good.readyState).toBe(WebSocket.OPEN)
  const another = connectGui('index')
  await firstMessage(another)
})

test('the GUI reconnects to a restarted LS and gets a fresh working session', async () => {
  const gui = connectGui('index')
  await firstMessage(gui)
  await vi.waitFor(() => expect(ls.open('json')).toHaveLength(JSON_SOCKETS))
  // The Language Server exits and a new one starts on the same port, as an engine restart does.
  const lsPort = ls.port
  await ls.stop()
  await closed(gui)
  await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(0))
  const restarted = new FakeLanguageServer()
  await restarted.start(lsPort)
  ls = restarted
  {
    const again = connectGui('index')
    await firstMessage(again)
    await vi.waitFor(() => expect(restarted.open('json')).toHaveLength(JSON_SOCKETS))
    // The session is working: it initialised against the new Language Server.
    await vi.waitFor(() => expect(LanguageServerSession.sessions.size).toBe(1))
  }
})

// #646: the Language Server's WebSocket keep-alive dropped an idle channel socket now and then
// (without a close frame, so `1006`), and the session carried on without it: attaches written to a
// dead `vis-control` channel never reached the runtime, so nothing ever executed. A lost channel of
// any kind now ends the session for its GUI, as a lost JSON channel does.
describe.each(['vis-control', 'vis-data', 'binary'])(
  'the LS dropping the %s channel (#646)',
  (kind) => {
    test('closes the GUI sockets, and the GUI reconnects to a fresh session', async () => {
      const lsName = `ws://127.0.0.1:${ls.port}`
      const gui = connectGui('index', 'gui-data-646')
      await firstMessage(gui)
      await vi.waitFor(() => expect(ls.open(kind)).toHaveLength(1))
      const dropped = LanguageServerSession.sessions.get(lsName)
      expect(dropped).toBeDefined()
      // An abrupt end, as the keep-alive failure was: no close frame.
      ls.open(kind)[0]!.socket.terminate()
      await vi.waitFor(() => expect(gui.readyState).toBe(WebSocket.CLOSED), { timeout: 5000 })
      const again = connectGui('index', 'gui-data-646')
      await firstMessage(again)
      const fresh = LanguageServerSession.sessions.get(lsName)
      expect(fresh).toBeDefined()
      expect(fresh).not.toBe(dropped)
      // The fresh session has its own working channel of that kind.
      await vi.waitFor(() => expect(ls.open(kind)).toHaveLength(1))
    })
  },
)

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

describe('Origin of a GUI socket (#596)', () => {
  const APP = 'https://localhost:8080'

  /** The status a handshake to the index doc is answered with: 101 when it is upgraded. */
  function handshakeStatus(origin: string | undefined): Promise<number> {
    const gui = new WebSocket(
      `ws://127.0.0.1:${port}/project/index?ls=ws://127.0.0.1:${ls.port}`,
      origin != null ? { origin } : {},
    )
    guis.push(gui)
    return new Promise((resolve, reject) => {
      gui.once('upgrade', (response) => resolve(response.statusCode ?? 0))
      gui.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
      gui.once('error', reject)
    })
  }

  beforeEach(async () => {
    await host.listen({
      host: '127.0.0.1',
      port,
      languageServer: ls.address(),
      allowedOrigins: [APP, 'https://127.0.0.1:8080'],
    })
  })

  test('the app’s own origin is upgraded', async () => {
    await expect(handshakeStatus(APP)).resolves.toBe(101)
    await expect(handshakeStatus('https://127.0.0.1:8080')).resolves.toBe(101)
  })

  test('a handshake without Origin (a Node client) is upgraded', async () => {
    await expect(handshakeStatus(undefined)).resolves.toBe(101)
  })

  test('any other origin is refused with 403 before the upgrade', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const origin of [
      'https://evil.example',
      'http://localhost:8080', // another scheme
      'https://localhost:8081', // another port
      'null', // a sandboxed frame or a file: page
    ]) {
      await expect(handshakeStatus(origin), origin).resolves.toBe(403)
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https://evil.example'))
    warn.mockRestore()
    // Nothing reached the Language Server.
    expect(ls.urls).toEqual([])
  })

  test('a listener told no origins refuses every browser page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await host.listen({ host: '127.0.0.1', port, languageServer: ls.address() })
    await expect(handshakeStatus(APP)).resolves.toBe(403)
    await expect(handshakeStatus(undefined)).resolves.toBe(101)
    warn.mockRestore()
  })
})

describe('a socket for a document the session does not hold (#601)', () => {
  /** The status a handshake to `doc` is answered with: 101 when it is upgraded. */
  function handshakeStatus(doc: string, query = `ls=ws://127.0.0.1:${ls.port}`): Promise<number> {
    const gui = new WebSocket(`ws://127.0.0.1:${port}/project/${doc}?${query}`)
    guis.push(gui)
    return new Promise((resolve, reject) => {
      gui.once('upgrade', (response) => resolve(response.statusCode ?? 0))
      gui.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
      gui.once('error', reject)
    })
  }

  test('is refused with 404 before the upgrade, so y-websocket backs off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // No session yet: a module doc cannot be one it lists, and none is started for it.
    await expect(handshakeStatus('00000000-0000-0000-0000-000000000001')).resolves.toBe(404)
    expect(LanguageServerSession.sessions.size).toBe(0)
    // A session that does not hold it.
    await firstMessage(connectGui('index'))
    await expect(handshakeStatus('00000000-0000-0000-0000-000000000001')).resolves.toBe(404)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not found in language server session'),
    )
    warn.mockRestore()
  })

  test('a document the session holds is upgraded', async () => {
    await firstMessage(connectGui('index'))
    const session = LanguageServerSession.sessions.get(`ws://127.0.0.1:${ls.port}`)!
    // The visualization subdoc is held from the session's start.
    const held = [...session.docs.keys()].find((guid) => guid !== 'index')!
    await expect(handshakeStatus(held)).resolves.toBe(101)
  })

  test('no document or no ls= parameter is refused with 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(handshakeStatus('index', 'data=x')).resolves.toBe(400)
    await expect(handshakeStatus('index', 'ls=')).resolves.toBe(400)
    await expect(handshakeStatus('not a doc!')).resolves.toBe(400)
    warn.mockRestore()
  })
})

test('a request target that is not a path is refused with 400, and the host stays up', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const target of ['//', 'http://']) {
    const status = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () =>
        socket.write(
          [
            `GET ${target} HTTP/1.1`,
            `Host: 127.0.0.1:${port}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version: 13',
            '',
            '',
          ].join('\r\n'),
        ),
      )
      socket.once('data', (data) => {
        resolve(String(data).split('\r\n')[0]!)
        socket.destroy()
      })
      socket.once('error', reject)
    })
    expect(status, target).toMatch(/^HTTP\/1\.1 400/)
  }
  warn.mockRestore()
  await firstMessage(connectGui('index'))
})
