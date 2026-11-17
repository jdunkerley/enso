/**
 * @file The history MCP tools: `undo` and `redo`. Pure functions over their deps. Both go through
 * the edit session's own undo and redo, which move only through steps made by agents (see
 * `editSession.ts` for why that is safe for Write), and which are refused in Live mode, while the
 * project is off screen and when the call is too close to its deadline.
 */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import type { EditSession } from './editSession'
import { errorResult, settledResult } from './editTools'

/** What `undo` and `redo` need: the edit session and the call's caller and deadline. */
export interface HistoryToolDeps {
  readonly session: Pick<EditSession, 'undo' | 'redo'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
}

/**
 * `undo`: takes back one step of edits made by agents. Answers
 * `{ undone: true, can_undo, can_redo, settled }`, or an error sentence when there is nothing of an
 * agent's to undo or the session refuses (Live mode, off screen).
 */
export async function undoTool(deps: HistoryToolDeps): Promise<McpToolResult> {
  const outcome = await deps.session.undo(deps.caller, { deadline: deps.deadline })
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ undone: true, ...outcome.value.value }, outcome.value)
}

/**
 * `redo`: re-applies the step the last `undo` took back. Answers
 * `{ redone: true, can_undo, can_redo, settled }`, or an error sentence when there is nothing to
 * redo or the session refuses (Live mode, off screen).
 */
export async function redoTool(deps: HistoryToolDeps): Promise<McpToolResult> {
  const outcome = await deps.session.redo(deps.caller, { deadline: deps.deadline })
  if (!outcome.ok) return errorResult(outcome)
  return settledResult({ redone: true, ...outcome.value.value }, outcome.value)
}
