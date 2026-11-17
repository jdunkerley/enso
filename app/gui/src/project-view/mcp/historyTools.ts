/**
 * @file The history MCP tools: `undo` and `redo`. Pure functions over their deps. Both go through
 * the edit session's own undo and redo, which move only through the steps of edits made by agents
 * since the user last changed the project, never below that, and are refused while the module has
 * code that enables output (see `editSession.ts` for the rule), in Live mode, while the project is
 * off screen and when the call is too close to its deadline.
 *
 * Neither waits for the engine: the answer has no `settled`, and the values of the nodes they
 * change may still be computing (`get_graph` shows them `pending`).
 */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import type { EditSession } from './editSession'
import { errorResult } from './editTools'
import { jsonResult } from './graphTools'

/** What `undo` and `redo` need: the edit session and the call's caller and deadline. */
export interface HistoryToolDeps {
  readonly session: Pick<EditSession, 'undo' | 'redo'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
}

/**
 * `undo`: takes back the most recent step of edits made by any connected agent. Answers
 * `{ undone: true, can_undo, can_redo }`, or an error sentence when there is nothing of the agents'
 * to undo or the session refuses.
 */
export async function undoTool(deps: HistoryToolDeps): Promise<McpToolResult> {
  const outcome = await deps.session.undo(deps.caller, { deadline: deps.deadline })
  if (!outcome.ok) return errorResult(outcome)
  return jsonResult({ undone: true, ...outcome.value })
}

/**
 * `redo`: re-applies the step the last `undo` took back. Answers
 * `{ redone: true, can_undo, can_redo }`, or an error sentence when there is nothing to redo or
 * the session refuses.
 */
export async function redoTool(deps: HistoryToolDeps): Promise<McpToolResult> {
  const outcome = await deps.session.redo(deps.caller, { deadline: deps.deadline })
  if (!outcome.ok) return errorResult(outcome)
  return jsonResult({ redone: true, ...outcome.value })
}
