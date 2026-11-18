/**
 * @file Marks the project tools' failures that are a house rule refusing the call, not the call
 * failing, so that main's activity record can tell "Refused" from "Error" (#864). The agent
 * receives the same text either way.
 */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import type { McpToolResult } from 'enso-common/src/mcp'
import {
  LIVE_EDIT_ERROR,
  NOTHING_LEFT_TO_REDO_ERROR,
  NOTHING_LEFT_TO_UNDO_ERROR,
  NOTHING_TO_REDO_ERROR,
  NOTHING_TO_UNDO_ERROR,
  REDO_OUTPUT_ERROR,
  UNDO_OUTPUT_ERROR,
} from './editSession'
import { LIVE_MODE_ERROR } from './evaluate'
import { LIVE_REFRESH_ERROR, WRITE_ON_REFRESH_ERROR } from './refreshTool'
import { VERSIONS_NOT_KEPT_ERROR } from './versionTools'
import {
  BUILTIN_REFUSED_ERROR,
  EVAL_REFUSED_ERROR,
  NAME_LOOKUP_REFUSED_ERROR,
  REFLECTION_REFUSED_ERROR,
  WRITE_REFUSED_ERROR,
} from './writeGuard'

/**
 * The answers that mean a rule refused the call: Live mode, the Write rule, the undo floor and
 * versions that are not kept.
 */
const RULE_REFUSALS: readonly string[] = [
  LIVE_MODE_ERROR,
  LIVE_EDIT_ERROR,
  LIVE_REFRESH_ERROR,
  UNDO_OUTPUT_ERROR,
  REDO_OUTPUT_ERROR,
  WRITE_ON_REFRESH_ERROR,
  NOTHING_TO_UNDO_ERROR,
  NOTHING_TO_REDO_ERROR,
  NOTHING_LEFT_TO_UNDO_ERROR,
  NOTHING_LEFT_TO_REDO_ERROR,
  VERSIONS_NOT_KEPT_ERROR,
  WRITE_REFUSED_ERROR,
  REFLECTION_REFUSED_ERROR,
  EVAL_REFUSED_ERROR,
  NAME_LOOKUP_REFUSED_ERROR,
  BUILTIN_REFUSED_ERROR,
]

/** Whether `error` is, or contains, the answer of one of the house rules. */
export function isRuleRefusal(error: string): boolean {
  return RULE_REFUSALS.some((refusal) => error.includes(refusal))
}

/** `result`, with `refused: true` added when it is a failure that a house rule caused. */
export function markRefusal(result: McpToolResult): McpToolResult {
  return !result.ok && result.refused !== true && isRuleRefusal(result.error) ?
      { ...result, refused: true }
    : result
}

/** `handler`, whose failures that a house rule caused carry `refused: true`. */
export function markingRefusals(handler: McpToolHandler): McpToolHandler {
  return async (args, caller, deadline) => markRefusal(await handler(args, caller, deadline))
}
