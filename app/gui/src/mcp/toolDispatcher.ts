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

/**
 * A tool's handler. `deadline` is when Electron main stops waiting for the reply (the call's
 * receipt time plus its timeout, in `Date.now()` milliseconds): an edit must not be applied after
 * it, since the caller has been told the call timed out by then.
 */
export type McpToolHandler = (
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
  deadline: number,
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

/** One project's handlers, and the id of the project they are for. */
interface ProjectRegistration {
  readonly handlers: Readonly<Record<string, McpToolHandler>>
  readonly projectId: () => string
}

/** Registrations, least recent first: the last one with a handler for a tool answers it. */
const registrations: ProjectRegistration[] = []
/**
 * The app tools' handlers, by tool name. Kept apart from {@link registrations}, so that they never
 * count as a project being shown ({@link activeProjectToolsId}).
 */
const appHandlers = new Map<string, McpToolHandler>()
/** The waits of {@link whenProjectToolsActive}, each for one project's handlers to answer. */
const projectWaits = new Set<{ readonly projectId: string; readonly resolve: () => void }>()

/**
 * Registers one project's handlers by tool name and makes them the ones that answer. Each open
 * project registers its own set; the most recently registered or activated set answers, so the
 * project on screen answers when it activates its set and removes it on deactivation.
 * `projectId` is read whenever it is asked for ({@link activeProjectToolsId}).
 */
export function registerMcpToolHandlers(
  toRegister: Readonly<Record<string, McpToolHandler>>,
  projectId: () => string,
): McpToolRegistration {
  const entry: ProjectRegistration = { handlers: { ...toRegister }, projectId }
  const remove = () => {
    const index = registrations.indexOf(entry)
    if (index >= 0) {
      registrations.splice(index, 1)
      settleProjectWaits()
    }
  }
  const activate = () => {
    const index = registrations.indexOf(entry)
    if (index >= 0) registrations.splice(index, 1)
    registrations.push(entry)
    settleProjectWaits()
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

/**
 * The id of the project whose handlers answer the project tools: the project on screen. `undefined`
 * when none does (the dashboard, settings, or a project still opening).
 */
export function activeProjectToolsId(): string | undefined {
  return registrations.at(-1)?.projectId()
}

/** Resolves the waits for the project that now answers. */
function settleProjectWaits() {
  const active = activeProjectToolsId()
  if (active == null) return
  for (const wait of [...projectWaits]) {
    if (wait.projectId === active) wait.resolve()
  }
}

/**
 * Resolves `true` once the project tools answer for `projectId` (at once if they do already), or
 * `false` after `timeoutMs`. Another project's handlers activating does not resolve it.
 */
export function whenProjectToolsActive(projectId: string, timeoutMs: number): Promise<boolean> {
  if (activeProjectToolsId() === projectId) return Promise.resolve(true)
  return new Promise((resolve) => {
    const wait = {
      projectId,
      resolve: () => {
        projectWaits.delete(wait)
        clearTimeout(timer)
        resolve(true)
      },
    }
    const timer = setTimeout(() => {
      projectWaits.delete(wait)
      resolve(false)
    }, timeoutMs)
    projectWaits.add(wait)
  })
}

/** How many {@link whenProjectToolsActive} waits are pending. For tests. */
export function pendingProjectToolsWaits(): number {
  return projectWaits.size
}

function handlerFor(tool: string): McpToolHandler | undefined {
  for (let i = registrations.length - 1; i >= 0; i--) {
    const handlers = registrations[i]!.handlers
    if (Object.hasOwn(handlers, tool)) return handlers[tool]
  }
  return appHandlers.get(tool)
}

/**
 * Subscribes to `api.onToolCall`, runs the handler with the call's deadline (`now()` at receipt
 * plus the call's `timeoutMs`), replies. No handler → `{ ok: false, error: NO_PROJECT_ERROR }`. A
 * throwing handler → `{ ok: false }` with its message. Returns the unsubscribe function.
 */
export function startMcpToolDispatcher(
  api: Pick<McpApi, 'onToolCall' | 'replyToolCall'>,
  now: () => number = Date.now,
): () => void {
  return api.onToolCall((request) => {
    const deadline = now() + request.timeoutMs
    void runHandler(request.tool, request.args, request.caller, deadline).then((result) =>
      api.replyToolCall({ requestId: request.requestId, result }),
    )
  })
}

async function runHandler(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
  deadline: number,
): Promise<McpToolResult> {
  const handler = handlerFor(tool)
  if (handler == null) return { ok: false, error: NO_PROJECT_ERROR }
  try {
    return await handler(args, caller, deadline)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `The tool ${tool} failed: ${message}` }
  }
}
