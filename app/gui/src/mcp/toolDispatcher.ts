/**
 * @file The window side of the IDE's MCP server: receives the tool calls Electron main forwards
 * (`app/electron-client/src/mcp/windowBridge.ts`), runs the handler registered for the tool and
 * replies. Handlers are registered by whatever owns the data they read (the open project's graph
 * editor registers the project tools), so a tool with no handler means nothing to read is open.
 */
import type { McpApi } from '$/electronApi'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'

export type McpToolHandler = (
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
) => Promise<McpToolResult>

export const NO_PROJECT_ERROR = 'No project is open in Enso. Ask the user to open one.'

const handlers = new Map<string, McpToolHandler>()

/**
 * Registers handlers by tool name; returns a function that removes exactly these. A later
 * registration of a name replaces the earlier one, and disposing the earlier registration then
 * leaves the later handler in place.
 */
export function registerMcpToolHandlers(
  toRegister: Readonly<Record<string, McpToolHandler>>,
): () => void {
  const entries = Object.entries(toRegister)
  for (const [name, handler] of entries) handlers.set(name, handler)
  return () => {
    for (const [name, handler] of entries) {
      if (handlers.get(name) === handler) handlers.delete(name)
    }
  }
}

/**
 * Subscribes to `api.onToolCall`, runs the handler, replies. No handler →
 * `{ ok: false, error: NO_PROJECT_ERROR }`. A throwing handler → `{ ok: false }` with its message.
 * Returns the unsubscribe function.
 */
export function startMcpToolDispatcher(
  api: Pick<McpApi, 'onToolCall' | 'replyToolCall'>,
): () => void {
  return api.onToolCall((request) => {
    void runHandler(request.tool, request.args, request.caller).then((result) =>
      api.replyToolCall({ requestId: request.requestId, result }),
    )
  })
}

async function runHandler(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
): Promise<McpToolResult> {
  const handler = handlers.get(tool)
  if (handler == null) return { ok: false, error: NO_PROJECT_ERROR }
  try {
    return await handler(args, caller)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `The tool ${tool} failed: ${message}` }
  }
}
