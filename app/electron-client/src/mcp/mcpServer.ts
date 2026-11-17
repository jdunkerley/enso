/**
 * @file The IDE's MCP server: serves the tool registry's tools and the guides over HTTP to the
 * agent apps (Claude Code, Codex, Copilot) the user has pointed at it. It does not import
 * `electron`: the caller decides when it runs and where its port and token come from.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { timingSafeEqual } from 'node:crypto'
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { Guides, guideUri } from './guides'
import type { ToolRegistry } from './toolRegistry'

const MCP_PATH = '/mcp'

export interface McpServerOptions {
  readonly registry: ToolRegistry
  readonly guides: Guides
  /** The port to listen on; `0` asks the OS for a free one (tests). */
  readonly port: number
  readonly token: string
  readonly version: string
}

/* Note [The MCP Server Checks Its Caller]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The server binds to loopback, but that does not make every caller an agent app the user set
 * up. Any local process can reach a loopback port and a web page can send it
 * requests, so each request must pass, before the MCP transport sees it:
 *
 * - no `Origin` header (a browser sends one on every `POST`; the agent apps send none): `403`;
 * - a `Host` that is a loopback name with this server's port: `403` otherwise. This stops DNS
 *   rebinding, where a hostile name resolves to 127.0.0.1;
 * - the bearer token, compared in constant time: `401` otherwise.
 *
 * Refusals are logged at the 1st, 10th, 100th, … so a looping process cannot fill the log.
 */

/**
 * Why a request is refused, or `undefined` to serve it. Checked before the MCP transport sees the
 * request; see Note [The MCP Server Checks Its Caller].
 */
export function refusal(
  headers: {
    origin?: string | undefined
    authorization?: string | undefined
    host?: string | undefined
  },
  token: string,
  port: number,
): { status: 401 | 403; reason: string } | undefined {
  if (headers.origin != null) return { status: 403, reason: 'cross-origin request' }
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
  if (headers.host == null || !hosts.includes(headers.host.toLowerCase())) {
    return { status: 403, reason: 'unexpected Host' }
  }
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(headers.authorization ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401, reason: 'missing or wrong token' }
  }
  return undefined
}

/* Note [The MCP Caller Name Comes From The User-Agent]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The server is stateless: every request gets its own `McpServer`, so the `clientInfo` an agent
 * app sends on `initialize` is gone by the time its `tools/call` arrives. `getClientVersion()` is
 * therefore only a fallback. The name of an external caller is the product token of the request's
 * `User-Agent` header, which agent apps send on every request. (Sessions would keep `clientInfo`,
 * but an IDE restart would invalidate every client's session id.)
 */

/** The name of an external caller from its `User-Agent`: the first product token, or `unknown`. */
export function callerName(userAgent: string | undefined): string {
  const token = (userAgent ?? '').trim().split(/[/\s]/, 1)[0]?.trim() ?? ''
  return token === '' ? 'unknown' : token.slice(0, 64)
}

/** The MCP server over HTTP, bound to `127.0.0.1` only. */
export class McpHttpServer {
  private readonly httpServer: HttpServer
  private refusals = 0
  private boundPort: number | undefined

  /** Prepare the server; nothing listens until {@link start}. */
  constructor(private readonly options: McpServerOptions) {
    this.httpServer = createServer((req, res) => void this.handleHttp(req, res))
  }

  /** `http://127.0.0.1:<port>/mcp`; the port is the bound one once started. */
  get url(): string {
    return `http://127.0.0.1:${this.boundPort ?? this.options.port}${MCP_PATH}`
  }

  /** Listens on 127.0.0.1:port. Rejects (e.g. EADDRINUSE) without leaving a listener. */
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(this.options.port, '127.0.0.1', () => {
        this.httpServer.off('error', reject)
        resolve()
      })
    })
    this.boundPort = (this.httpServer.address() as AddressInfo).port
  }

  /** Stop listening and drop open connections. Harmless when not started. */
  async stop(): Promise<void> {
    if (!this.httpServer.listening) return
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve())
      this.httpServer.closeAllConnections()
    })
    this.boundPort = undefined
  }

  // Fresh server per request: the SDK rejects `connect()` on an already-wired Protocol and our
  // HTTP transport is stateless (one transport per request).
  private createMcpServer(userAgent: string | undefined): McpServer {
    const { registry, guides, version } = this.options
    const server = new McpServer(
      { name: 'enso', version },
      { capabilities: { tools: {}, resources: {} }, instructions: guides.instructions },
    )
    for (const tool of registry.list()) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
        async (args) => {
          // Note [The MCP Caller Name Comes From The User-Agent]
          const clientName = server.server.getClientVersion()?.name ?? callerName(userAgent)
          const result = await registry.call(tool.name, args, {
            kind: 'external',
            name: clientName,
          })
          if (!result.ok) {
            return { content: [{ type: 'text' as const, text: result.error }], isError: true }
          }
          const text = { type: 'text' as const, text: result.value }
          // The image first: clients show content in order, and the text describes the image.
          return result.image == null ?
              { content: [text] }
            : {
                content: [
                  {
                    type: 'image' as const,
                    data: result.image.data,
                    mimeType: result.image.mimeType,
                  },
                  text,
                ],
              }
        },
      )
    }
    return server
  }

  private async registerGuides(server: McpServer): Promise<void> {
    const { guides } = this.options
    for (const { topic, title } of await guides.list()) {
      const uri = guideUri(topic)
      server.registerResource(
        topic,
        uri,
        { title, mimeType: 'text/markdown' },
        async (resourceUri) => ({
          contents: [
            {
              uri: resourceUri.href,
              mimeType: 'text/markdown',
              text: (await guides.read(topic)) ?? '',
            },
          ],
        }),
      )
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.boundPort ?? this.options.port
    const refused = refusal(req.headers, this.options.token, port)
    if (refused != null) {
      // Note [The MCP Server Checks Its Caller]: logged at powers of ten only.
      this.refusals++
      if (/^10*$/.test(String(this.refusals))) {
        console.warn(`[MCP] refused a request: ${refused.reason} (${this.refusals} so far).`)
      }
      res.writeHead(refused.status, { 'Content-Type': 'text/plain' })
      res.end(refused.reason)
      return
    }
    // Everything from here on is in the `try`: `handleHttp` runs as `void`, so a throw outside it
    // would be an unhandled rejection in main.
    try {
      let pathname: string
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('bad request target')
        return
      }
      if (pathname !== MCP_PATH) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }
      const server = this.createMcpServer(req.headers['user-agent'])
      // The cast works around the SDK typing `sessionIdGenerator` as a non-optional
      // `() => string` even though `undefined` (stateless) is accepted at runtime.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0])
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await this.registerGuides(server)
      // SDK's `Transport.onclose` is `() => void` under exactOptionalPropertyTypes; the
      // concrete class actually exposes it as optional.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0])
      await transport.handleRequest(req, res)
    } catch (err) {
      console.warn('[MCP] error handling request:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end()
      } else {
        res.destroy()
      }
    }
  }
}
