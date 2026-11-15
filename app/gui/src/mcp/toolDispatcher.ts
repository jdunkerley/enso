/**
 * @file The window side of the IDE's MCP server: receives the tool calls Electron main forwards
 * (`app/electron-client/src/mcp/windowBridge.ts`), runs the handler registered for the tool and
 * replies. Handlers are registered by whatever owns the data they read (each open project's graph
 * editor registers the project tools), and the most recently registered or activated set answers:
 * the project whose tab is showing. A tool with no handler means no project is showing.
 */
import type { McpApi } from '$/electronApi'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'

export type McpToolHandler = (
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
) => Promise<McpToolResult>

export const NO_PROJECT_ERROR = 'No project is open in Enso. Ask the user to open one.'

/** A set of handlers registered together (one open project's). */
export interface McpToolRegistration {
  /**
   * Makes these handlers the ones that answer, ahead of every other registration; re-adds them if
   * they were removed.
   */
  readonly activate: () => void
  /** Stops these handlers answering; the next most recent registration answers instead. */
  readonly remove: () => void
}

/** Registrations, least recent first: the last one with a handler for a tool answers it. */
const registrations: Readonly<Record<string, McpToolHandler>>[] = []

/**
 * Registers handlers by tool name and makes them the ones that answer. Each open project registers
 * its own set; the most recently registered or activated set answers, so the project on screen
 * answers when it activates its set and removes it on deactivation.
 */
export function registerMcpToolHandlers(
  toRegister: Readonly<Record<string, McpToolHandler>>,
): McpToolRegistration {
  const entry = { ...toRegister }
  const remove = () => {
    const index = registrations.indexOf(entry)
    if (index >= 0) registrations.splice(index, 1)
  }
  const activate = () => {
    remove()
    registrations.push(entry)
  }
  activate()
  return { activate, remove }
}

function handlerFor(tool: string): McpToolHandler | undefined {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const registration = registrations[i]!
    if (Object.hasOwn(registration, tool)) return registration[tool]
  }
  return undefined
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
  const handler = handlerFor(tool)
  if (handler == null) return { ok: false, error: NO_PROJECT_ERROR }
  try {
    return await handler(args, caller)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `The tool ${tool} failed: ${message}` }
  }
}
