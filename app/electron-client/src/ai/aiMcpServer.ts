/**
 * @file In-process MCP server exposing the `evaluateExpression` tool to the long-lived `claude`
 * subprocess; bridges tool calls to the active renderer over `Channel.aiToolCall`/`aiToolReply`.
 * Lifecycle, transport choice, and reentrancy notes live in `electron-client/CLAUDE.md`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { app, ipcMain } from 'electron'
import type { AiToolCallReply, AiToolCallRequest } from 'enso-common/src/ai'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs'
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import * as path from 'node:path'
import { z } from 'zod'
import { Channel } from '../ipc.js'
import type { ActiveRequest } from './claudeAgent.js'

const TOOL_CALL_TIMEOUT_MS = 30_000

/* Note [The AI MCP Server Checks Its Caller]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The server binds to loopback, but that does not make every caller the `claude` subprocess:
 * any other local process can reach the port, and a web page in the user's browser can send it
 * requests. During an AI turn, `evaluateExpression` runs Enso code in the open project, so:
 *
 * - A random bearer token is made at start-up and written, with the URL, to the `--mcp-config`
 *   file the CLI reads (`headers.Authorization`). A request without it, or with another one, gets
 *   `401`. The comparison is in constant time.
 * - That file lives in the app's `userData` directory, which is in the user's profile on every OS,
 *   not in the temporary directory (on Windows `TEMP` can point at a shared directory, whose ACL a
 *   new file inherits). It is created new (`wx`, never following an existing file or link) with
 *   mode `0600`, and deleted first thing on shutdown. A crash leaves it behind, harmlessly: its
 *   token died with the server.
 * - Refusals are logged rate-limited: the 1st, 10th, 100th, … (with the count so far), so a local
 *   process looping on the port cannot fill the log. (The app's lint forbids `console.debug`.)
 * - A request that carries an `Origin` header gets `403`, whatever its token. A browser sends
 *   `Origin` on every cross-origin request (and on every `POST`); the CLI sends none.
 *
 * Both checks run before the MCP transport sees the request.
 */

/**
 * Why a request to the MCP server is refused, or `undefined` to serve it. See Note [The AI MCP
 * Server Checks Its Caller].
 */
export function refusal(
  headers: IncomingMessage['headers'],
  token: string,
): { status: 401 | 403; reason: string } | undefined {
  if (headers.origin != null) return { status: 403, reason: 'cross-origin request' }
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(headers.authorization ?? '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401, reason: 'missing or wrong token' }
  }
  return undefined
}

/**
 * Resolve the renderer + request id pair driving the currently-in-flight Claude turn. Returns
 * `null` when no AI turn is in flight (or during priming).
 */
export type ActiveRequestResolver = () => ActiveRequest | null

/** Returned by {@link startAiMcpServer}; `mcpConfigPath` is the value for the CLI's `--mcp-config`. */
export interface AiMcpServerHandle {
  readonly mcpConfigPath: string
  shutdown(): Promise<void>
}

interface PendingToolCall {
  resolve(reply: AiToolCallReply['result']): void
  timer: NodeJS.Timeout
}

/**
 * In-process MCP server bound to a random localhost port. Holds the IPC bridge between the
 * `claude` subprocess (HTTP client) and the active renderer (which actually evaluates the tool).
 */
export class AiMcpServer {
  private readonly pending = new Map<string, PendingToolCall>()
  private readonly httpServer: HttpServer
  private configPath: string | null = null
  private readonly token = randomBytes(32).toString('base64url')
  private refusals = 0
  private readonly resolveActiveRequest: ActiveRequestResolver
  private readonly ipcReplyListener: (event: unknown, reply: AiToolCallReply) => void
  private listening = false

  /**
   * Wire up the IPC reply listener and the HTTP server (still unbound until {@link start}).
   * @param configDirectory Where the `--mcp-config` file goes; the app's `userData` by default
   * (tests pass their own).
   */
  constructor(
    resolveActiveRequest: ActiveRequestResolver,
    private readonly configDirectory?: string,
  ) {
    this.resolveActiveRequest = resolveActiveRequest
    this.httpServer = createServer((req, res) => void this.handleHttp(req, res))
    this.ipcReplyListener = (_event, reply) => this.handleReply(reply)
    ipcMain.on(Channel.aiToolReply, this.ipcReplyListener)
  }

  /** Start the HTTP listener and write the MCP config file. Returns the config file path. */
  async start(): Promise<string> {
    if (this.listening) {
      if (this.configPath == null) throw new Error('AiMcpServer: started but no config path')
      return this.configPath
    }
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(0, '127.0.0.1', () => {
        this.httpServer.off('error', reject)
        resolve()
      })
    })
    this.listening = true
    const address = this.httpServer.address()
    if (address == null || typeof address === 'string') {
      throw new Error(`AiMcpServer: unexpected address ${String(address)}`)
    }
    const url = `http://127.0.0.1:${address.port}/mcp`
    const headers = { Authorization: `Bearer ${this.token}` }
    const config = { mcpServers: { enso: { type: 'http', url, headers } } }
    // Note [The AI MCP Server Checks Its Caller]: the file holds the token.
    const directory = this.configDirectory ?? app.getPath('userData')
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `enso-claude-mcp-${process.pid}-${randomUUID()}.json`)
    fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600, flag: 'wx' })
    this.configPath = file
    return file
  }

  /** Stop the listener, delete the config file, and fail any in-flight tool calls. */
  async shutdown(): Promise<void> {
    // First, and synchronously: closing the listener waits for open connections, and the app may
    // exit before that finishes (Note [The AI MCP Server Checks Its Caller]).
    if (this.configPath != null) {
      try {
        fs.unlinkSync(this.configPath)
      } catch {
        // already gone
      }
      this.configPath = null
    }
    ipcMain.removeListener(Channel.aiToolReply, this.ipcReplyListener)
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: 'AI MCP server shutting down' })
      this.pending.delete(requestId)
    }
    if (this.listening) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve())
      })
      this.listening = false
    }
  }

  // -------------- private --------------

  // Fresh server per request: the SDK rejects `connect()` on an already-wired Protocol and our
  // HTTP transport is stateless (one transport per request) — see SDK's `simpleStatelessStreamableHttp`.
  private createServer(): McpServer {
    const server = new McpServer(
      { name: 'enso', version: '0.0.0-dev' },
      { capabilities: { tools: {} } },
    )
    server.registerTool(
      'evaluateExpression',
      {
        title: 'Evaluate an Enso expression in the AI insertion scope',
        description:
          'Evaluate a plain Enso expression in the scope where your generated `body` would run. ' +
          'Every in-scope binding the prompt listed is referenceable by name, and one call may ' +
          'stitch several of them together. Use sparingly to learn things you cannot infer from ' +
          'types alone (column names, value previews, join shapes). Each call costs a real LS ' +
          'round-trip (~hundreds of ms to a few seconds). The expression must evaluate to Text — ' +
          'pick the encoding yourself with `.to_text`, `.to_display_text`, or `.to_json` (e.g. ' +
          '`<binding>.column_names.to_json`). For expressions that may produce a DataflowError ' +
          'wrap with `.catch_primitive (e -> e.to_display_text)` so the result is still Text. ' +
          'Returns the text the expression produced, or an error string if the binding/scope is ' +
          'unavailable or evaluation fails.',
        inputSchema: { expression: z.string() },
      },
      async ({ expression }) => {
        const result = await this.dispatchToRenderer({ tool: 'evaluateExpression', expression })
        if (result.ok) {
          // Forward the agent-chosen encoding verbatim — JSON-stringifying here would double-encode.
          return { content: [{ type: 'text' as const, text: result.value }] }
        }
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          isError: true,
        }
      },
    )
    return server
  }

  private async dispatchToRenderer(
    payload: Omit<AiToolCallRequest, 'requestId' | 'turnRequestId'>,
  ): Promise<AiToolCallReply['result']> {
    const active = this.resolveActiveRequest()
    if (active == null) {
      return { ok: false, error: 'no active AI turn — tool calls only valid mid-turn' }
    }
    // Defensive: `activeRequest` already filters destroyed senders, but a tightly-timed
    // destruction between resolver invocation and `send()` could still surface here.
    if (active.sender.isDestroyed()) {
      return { ok: false, error: 'renderer was destroyed before the tool call could be dispatched' }
    }
    const sender = active.sender
    const requestId = randomUUID()
    return new Promise<AiToolCallReply['result']>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          resolve({
            ok: false,
            error: `tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`,
          })
        }
      }, TOOL_CALL_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, timer })
      const request: AiToolCallRequest = { requestId, turnRequestId: active.requestId, ...payload }
      try {
        sender.send(Channel.aiToolCall, request)
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve({
          ok: false,
          error: `failed to dispatch tool call to renderer: ${(err as Error).message}`,
        })
      }
    })
  }

  private handleReply(reply: AiToolCallReply): void {
    const pending = this.pending.get(reply.requestId)
    if (pending == null) return
    clearTimeout(pending.timer)
    this.pending.delete(reply.requestId)
    pending.resolve(reply.result)
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const refused = refusal(req.headers, this.token)
    if (refused != null) {
      // Note [The AI MCP Server Checks Its Caller]: logged at powers of ten only.
      this.refusals++
      if (/^10*$/.test(String(this.refusals))) {
        console.warn(`[AI MCP] refused a request: ${refused.reason} (${this.refusals} so far).`)
      }
      res.writeHead(refused.status, { 'Content-Type': 'text/plain' })
      res.end(refused.reason)
      return
    }
    const server = this.createServer()
    // The cast works around the SDK typing `sessionIdGenerator` as a non-optional
    // `() => string` even though `undefined` (stateless) is accepted at runtime.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0])
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      // SDK's `Transport.onclose` is `() => void` under exactOptionalPropertyTypes; the
      // concrete class actually exposes it as optional.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0])
      await transport.handleRequest(req, res)
    } catch (err) {
      console.warn('[AI MCP] error handling request:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end()
      } else {
        // Headers already sent — can't send a clean error code; tear the socket down so it
        // doesn't linger until the server's keep-alive timeout.
        res.destroy()
      }
    }
  }
}

/** Convenience factory for the singleton case. */
export async function startAiMcpServer(
  resolveActiveRequest: ActiveRequestResolver,
): Promise<{ server: AiMcpServer; mcpConfigPath: string }> {
  const server = new AiMcpServer(resolveActiveRequest)
  const mcpConfigPath = await server.start()
  return { server, mcpConfigPath }
}
