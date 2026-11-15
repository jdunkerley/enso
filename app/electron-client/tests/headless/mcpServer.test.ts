/** @file Tests for the IDE's MCP HTTP server (`src/mcp/mcpServer.ts`). */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpCaller } from 'enso-common/src/mcp'
import * as fs from 'node:fs'
import { request } from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { Guides } from '../../src/mcp/guides'
import { callerName, McpHttpServer, refusal } from '../../src/mcp/mcpServer'
import { ToolRegistry } from '../../src/mcp/toolRegistry'

const TOKEN = 'secret-token'

describe('refusal', () => {
  const good = { authorization: `Bearer ${TOKEN}`, host: '127.0.0.1:5000' }

  test('serves a correct token on a loopback host', () => {
    expect(refusal(good, TOKEN, 5000)).toBeUndefined()
    expect(refusal({ ...good, host: 'localhost:5000' }, TOKEN, 5000)).toBeUndefined()
    expect(refusal({ ...good, host: '[::1]:5000' }, TOKEN, 5000)).toBeUndefined()
  })

  test('refuses a request with an Origin, whatever its token', () => {
    expect(refusal({ ...good, origin: 'https://evil.example' }, TOKEN, 5000)?.status).toBe(403)
  })

  test('refuses a Host that is not a loopback name with the server port', () => {
    expect(refusal({ ...good, host: 'evil.example:5000' }, TOKEN, 5000)?.status).toBe(403)
    expect(refusal({ ...good, host: '127.0.0.1:5001' }, TOKEN, 5000)?.status).toBe(403)
    expect(refusal({ ...good, host: '127.0.0.1' }, TOKEN, 5000)?.status).toBe(403)
    expect(refusal({ authorization: good.authorization }, TOKEN, 5000)?.status).toBe(403)
  })

  test('refuses a wrong or missing token', () => {
    expect(refusal({ ...good, authorization: 'Bearer nope' }, TOKEN, 5000)?.status).toBe(401)
    expect(refusal({ host: good.host }, TOKEN, 5000)?.status).toBe(401)
  })
})

describe('callerName', () => {
  test('takes the first product token of the User-Agent', () => {
    expect(callerName('claude-code/2.1.0 (cli)')).toBe('claude-code')
    expect(callerName('node')).toBe('node')
    expect(callerName('  codex cli')).toBe('codex')
  })
  test('is unknown without a usable User-Agent', () => {
    expect(callerName(undefined)).toBe('unknown')
    expect(callerName('')).toBe('unknown')
    expect(callerName('/1.0')).toBe('unknown')
  })
  test('is cut to 64 characters', () => {
    expect(callerName('a'.repeat(200))).toBe('a'.repeat(64))
  })
})

describe('McpHttpServer', () => {
  let guidesRoot: string
  let guides: Guides
  let registry: ToolRegistry
  let callers: McpCaller[]
  let server: McpHttpServer
  let client: Client | undefined

  beforeAll(() => {
    guidesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-server-'))
    guides = new Guides(guidesRoot)
  })
  afterAll(() => {
    fs.rmSync(guidesRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    callers = []
    registry = new ToolRegistry()
    registry.register({
      name: 'echo',
      title: 'Echo',
      description: 'Echoes its text.',
      inputSchema: { text: z.string() },
      run: async (args, caller) => {
        callers.push(caller)
        return { ok: true, value: args.text as string }
      },
    })
    registry.register({
      name: 'fail',
      title: 'Fail',
      description: 'Always fails.',
      inputSchema: {},
      run: async () => ({ ok: false, error: 'it failed' }),
    })
    server = new McpHttpServer({ registry, guides, port: 0, token: TOKEN, version: '1.2.3' })
    await server.start()
  })
  afterEach(async () => {
    await client?.close()
    client = undefined
    await server.stop()
  })

  async function connect(): Promise<Client> {
    client = new Client({ name: 'test-agent', version: '9' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'test-agent/1.0' },
        },
      }) as Parameters<Client['connect']>[0],
    )
    return client
  }

  function post(pathname: string, headers: Record<string, string>): Promise<Response> {
    return fetch(new URL(pathname, server.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
  }

  describe('who may call it', () => {
    let warn: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    test('refuses a request without the token', async () => {
      expect((await post('/mcp', {})).status).toBe(401)
    })

    test('refuses a request with an Origin, even with the token', async () => {
      const response = await post('/mcp', {
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'https://evil.example',
      })
      expect(response.status).toBe(403)
    })

    test('logs refusals rate-limited: the 1st and the 10th of 12', async () => {
      for (let i = 0; i < 12; i++) expect((await post('/mcp', {})).status).toBe(401)
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        '[MCP] refused a request: missing or wrong token (1 so far).',
        '[MCP] refused a request: missing or wrong token (10 so far).',
      ])
    })

    test('answers another path with 404', async () => {
      expect((await post('/other', { Authorization: `Bearer ${TOKEN}` })).status).toBe(404)
    })

    test('answers a request target that does not parse with 400, and goes on serving', async () => {
      const url = new URL(server.url)
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          {
            host: url.hostname,
            port: url.port,
            path: '//',
            method: 'POST',
            headers: { Authorization: `Bearer ${TOKEN}`, Host: url.host },
          },
          (res) => {
            res.resume()
            resolve(res.statusCode)
          },
        )
        req.on('error', reject)
        req.end()
      })
      expect(status).toBe(400)
      expect((await post('/other', { Authorization: `Bearer ${TOKEN}` })).status).toBe(404)
    })
  })

  test('gives the server instructions, which point at get_guide', async () => {
    expect((await connect()).getInstructions()).toContain('get_guide')
  })

  test('lists the registered tools', async () => {
    const { tools } = await (await connect()).listTools()
    expect(tools.map((tool) => [tool.name, tool.description])).toEqual([
      ['echo', 'Echoes its text.'],
      ['fail', 'Always fails.'],
    ])
  })

  test('runs a tool as an external caller named after the client', async () => {
    const result = await (await connect()).callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(callers).toEqual([{ kind: 'external', name: 'test-agent' }])
  })

  test('reports a failing tool as an error result', async () => {
    const result = await (await connect()).callTool({ name: 'fail', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'it failed' }])
  })

  test('serves the guides as resources', async () => {
    const connected = await connect()
    const { resources } = await connected.listResources()
    expect(resources.map((resource) => resource.uri)).toContain('enso://guide/overview')
    const { contents } = await connected.readResource({ uri: 'enso://guide/overview' })
    expect(contents[0]).toMatchObject({
      uri: 'enso://guide/overview',
      mimeType: 'text/markdown',
      text: await guides.read('overview'),
    })
  })

  test('refuses to start on a port in use, and starts once it is stopped', async () => {
    const port = Number(new URL(server.url).port)
    const options = { registry, guides, port, token: TOKEN, version: '1.2.3' }
    await expect(new McpHttpServer(options).start()).rejects.toThrow(/EADDRINUSE/)
    await server.stop()
    const third = new McpHttpServer(options)
    await third.start()
    await third.stop()
    // `afterEach` stops `server` again: stopping must be harmless.
  })
})
