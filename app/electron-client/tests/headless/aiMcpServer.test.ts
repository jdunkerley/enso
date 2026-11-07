/** @file Unit tests for the in-process MCP server in aiMcpServer.ts. */
import type { AiToolCallReply, AiToolCallRequest } from 'enso-common/src/ai'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const ipcEmitter = new EventEmitter()
const ipcOn = vi.fn((channel: string, listener: (...args: unknown[]) => void) =>
  ipcEmitter.on(channel, listener),
)
const ipcRemoveListener = vi.fn((channel: string, listener: (...args: unknown[]) => void) =>
  ipcEmitter.off(channel, listener),
)

// The app's `userData`, where the MCP config goes (Note [The AI MCP Server Checks Its Caller]).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mcp-user-data-'))

// Wrapped so a test can see how the config file is opened.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? userData : os.tmpdir()) },
  ipcMain: { handle: vi.fn(), on: ipcOn, removeListener: ipcRemoveListener },
}))

const { AiMcpServer } = await import('../../src/ai/aiMcpServer')

interface FakeSender {
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}

function fakeSender(opts: { destroyed?: boolean } = {}): FakeSender {
  return {
    isDestroyed: () => opts.destroyed === true,
    send: vi.fn(),
  }
}

function fakeActiveRequest(sender: FakeSender, requestId = 'test-request') {
  return { requestId, sender: sender as unknown as Electron.WebContents }
}

/** Reach into the MCP server's private dispatch path to test it without an HTTP client. */
function dispatch(
  server: InstanceType<typeof AiMcpServer>,
  payload: { tool: 'evaluateExpression'; expression: string },
): Promise<AiToolCallReply['result']> {
  // Cast through unknown — tests only.
  const dispatchToRenderer = (
    server as unknown as {
      dispatchToRenderer(payload: unknown): Promise<AiToolCallReply['result']>
    }
  ).dispatchToRenderer.bind(server)
  return dispatchToRenderer(payload)
}

/** Pull the most recent send call off the fake sender — that's the in-flight tool call. */
function lastDispatchedRequest(sender: FakeSender): AiToolCallRequest {
  const calls = sender.send.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]![1] as AiToolCallRequest
}

function answer(request: AiToolCallRequest, result: AiToolCallReply['result']): void {
  ipcEmitter.emit('ai-tool-reply', undefined, { requestId: request.requestId, result })
}

describe('AiMcpServer', () => {
  beforeEach(() => {
    ipcOn.mockClear()
    ipcRemoveListener.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    ipcEmitter.removeAllListeners()
  })

  test('round-trips a renderer reply', async () => {
    const sender = fakeSender()
    const server = new AiMcpServer(() => fakeActiveRequest(sender, 'ai-req-1'))
    const promise = dispatch(server, { tool: 'evaluateExpression', expression: 'x.column_names' })
    // Microtask queue: let dispatch reach the sender.
    await Promise.resolve()
    const request = lastDispatchedRequest(sender)
    expect(request.tool).toBe('evaluateExpression')
    expect(request.expression).toBe('x.column_names')
    expect(request.turnRequestId).toBe('ai-req-1')
    answer(request, { ok: true, value: '["a","b"]' })
    expect(await promise).toEqual({ ok: true, value: '["a","b"]' })
  })

  test('returns "no active AI turn" when the sender resolver yields null', async () => {
    const server = new AiMcpServer(() => null)
    const reply = await dispatch(server, { tool: 'evaluateExpression', expression: 'x' })
    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/no active AI turn/) })
  })

  test('returns "renderer destroyed" when the sender is already gone', async () => {
    const sender = fakeSender({ destroyed: true })
    const server = new AiMcpServer(() => fakeActiveRequest(sender))
    const reply = await dispatch(server, { tool: 'evaluateExpression', expression: 'x' })
    expect(reply).toEqual({ ok: false, error: expect.stringMatching(/destroyed/) })
    // The sender should not have been used to send anything.
    expect(sender.send).not.toHaveBeenCalled()
  })

  test('per-call 30s timeout fires when the renderer never replies', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const sender = fakeSender()
    const server = new AiMcpServer(() => fakeActiveRequest(sender))
    const promise = dispatch(server, { tool: 'evaluateExpression', expression: 'x' })
    await Promise.resolve()
    expect(sender.send).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(31_000)
    const reply = await promise
    expect(reply.ok).toBe(false)
    if (!reply.ok) expect(reply.error).toMatch(/timed out after 30000ms/)
  })

  test('start writes the config file in userData; shutdown removes it', async () => {
    const server = new AiMcpServer(() => null)
    const configPath = await server.start()
    expect(fs.existsSync(configPath)).toBe(true)
    // Not the temporary directory, which on Windows can be shared (#616 review).
    expect(path.dirname(configPath)).toBe(userData)
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(config.mcpServers.enso.type).toBe('http')
    expect(config.mcpServers.enso.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(config.mcpServers.enso.headers.Authorization).toMatch(/^Bearer [\w-]{43}$/)
    if (process.platform !== 'win32') expect(fs.statSync(configPath).mode & 0o077).toBe(0)
    await server.shutdown()
    expect(fs.existsSync(configPath)).toBe(false)
  })

  test('shutdown rejects in-flight dispatches with a clean error', async () => {
    const sender = fakeSender()
    const server = new AiMcpServer(() => fakeActiveRequest(sender))
    const promise = dispatch(server, { tool: 'evaluateExpression', expression: 'x' })
    await Promise.resolve()
    await server.shutdown()
    const reply = await promise
    expect(reply.ok).toBe(false)
    if (!reply.ok) expect(reply.error).toMatch(/shutting down/)
  })

  test('stale replies (after timeout/shutdown) are dropped silently', async () => {
    const sender = fakeSender()
    const server = new AiMcpServer(() => fakeActiveRequest(sender))
    // Manually create a request that has already been resolved by shutdown.
    const promise = dispatch(server, { tool: 'evaluateExpression', expression: 'x' })
    await Promise.resolve()
    const request = lastDispatchedRequest(sender)
    await server.shutdown()
    await promise
    // Late reply must not throw.
    expect(() => answer(request, { ok: true, value: '42' })).not.toThrow()
  })

  test('shutdown deletes the config file at once, before open connections close', async () => {
    const server = new AiMcpServer(() => null)
    const configPath = await server.start()
    const { port } = new URL(JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.enso.url)
    // A connection the client keeps open makes `close()` wait for it.
    const socket = net.connect(Number(port), '127.0.0.1')
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    const closed = server.shutdown()
    expect(fs.existsSync(configPath)).toBe(false)
    socket.destroy()
    await closed
  })

  test('a config file is never written over an existing one', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mcp-wx-'))
    const write = vi.mocked(fs.writeFileSync)
    write.mockClear()
    const server = new AiMcpServer(() => null, directory)
    try {
      await server.start()
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining(directory),
        expect.any(String),
        expect.objectContaining({ flag: 'wx', mode: 0o600 }),
      )
    } finally {
      await server.shutdown()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  describe('who may call it (#616)', () => {
    let server: InstanceType<typeof AiMcpServer>
    let url: string
    let authorization: string

    beforeEach(async () => {
      server = new AiMcpServer(() => null)
      const config = JSON.parse(fs.readFileSync(await server.start(), 'utf8'))
      url = config.mcpServers.enso.url
      authorization = config.mcpServers.enso.headers.Authorization
    })
    afterEach(() => server.shutdown())

    /** POST an MCP `initialize`, as the CLI does first, with the given extra headers. */
    function initialize(headers: Record<string, string>): Promise<Response> {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      })
    }

    test('serves the CLI: the token from the config file, no Origin', async () => {
      const response = await initialize({ Authorization: authorization })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('"serverInfo"')
    })

    test('refuses a request without the token', async () => {
      expect((await initialize({})).status).toBe(401)
    })

    test('refuses a request with another token', async () => {
      const wrong = authorization.slice(0, -1) + (authorization.endsWith('A') ? 'B' : 'A')
      expect((await initialize({ Authorization: wrong })).status).toBe(401)
      expect((await initialize({ Authorization: 'Bearer x' })).status).toBe(401)
    })

    test('logs refusals rate-limited: the 1st and the 10th of 12', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        for (let i = 0; i < 12; i++) expect((await initialize({})).status).toBe(401)
        expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
          '[AI MCP] refused a request: missing or wrong token (1 so far).',
          '[AI MCP] refused a request: missing or wrong token (10 so far).',
        ])
      } finally {
        warn.mockRestore()
      }
    })

    test('refuses a request from a web page, even with the token', async () => {
      for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1']) {
        const response = await initialize({ Authorization: authorization, Origin: origin })
        expect(response.status, origin).toBe(403)
      }
    })
  })
})
