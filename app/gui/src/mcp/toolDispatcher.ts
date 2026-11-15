/**
 * @file The window side of the IDE's MCP server: receives the tool calls Electron main forwards
 * (`app/electron-client/src/mcp/windowBridge.ts`), runs the handler registered for the tool and
 * replies. Handlers are registered by whatever owns the data they read. Each open project's graph
 * editor registers the project tools, and the most recently registered or activated set answers:
 * the project whose tab is showing. The app shell registers the app tools once
 * ({@link registerMcpAppToolHandlers}); they answer whatever page is showing. A tool with no handler
 * means no project is showing.
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
 * The app tools' handlers, by tool name. Kept apart from {@link registrations}, so that they never
 * count as a project being shown ({@link hasProjectTools}, {@link whenProjectToolsActivated}).
 */
const appHandlers = new Map<string, McpToolHandler>()
/** Called, then forgotten, at the next activation of a project's handlers. */
const activationListeners = new Set<() => void>()

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
    const listeners = [...activationListeners]
    activationListeners.clear()
    for (const listener of listeners) listener()
  }
  activate()
  return { activate, remove }
}

/**
 * Registers the app tools' handlers by tool name, for as long as the app shell lives: they answer
 * whatever page is showing, a project's or not. Their names are not project tool names, so they
 * never answer in a project's stead (project registrations are consulted first in any case).
 * Returns the function that unregisters them.
 */
export function registerMcpAppToolHandlers(
  toRegister: Readonly<Record<string, McpToolHandler>>,
): () => void {
  const entries = Object.entries(toRegister)
  for (const [tool, handler] of entries) appHandlers.set(tool, handler)
  return () => {
    for (const [tool, handler] of entries) {
      if (appHandlers.get(tool) === handler) appHandlers.delete(tool)
    }
  }
}

/** Whether a project's handlers are registered: a project is on screen. */
export function hasProjectTools(): boolean {
  return registrations.length > 0
}

/**
 * Resolves `true` at the next registration or activation of a project's handlers after this call
 * (a project's graph editor coming on screen), or `false` after `timeoutMs` without one.
 */
export function whenProjectToolsActivated(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      activationListeners.delete(listener)
      resolve(false)
    }, timeoutMs)
    activationListeners.add(listener)
  })
}

function handlerFor(tool: string): McpToolHandler | undefined {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const registration = registrations[i]!
    if (Object.hasOwn(registration, tool)) return registration[tool]
  }
  return appHandlers.get(tool)
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
