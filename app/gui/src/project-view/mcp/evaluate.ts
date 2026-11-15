/**
 * @file The `evaluate_expression` MCP tool: evaluates an Enso expression to text in the scope of
 * the method on screen or of one of its nodes.
 */
import { formatLsError, translateEngineError } from '@/components/ComponentBrowser/aiToolHandler'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { Result } from 'enso-common/src/utilities/data/result'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { findNode, truncate, type GraphToolDeps } from './graphTools'

export const STILL_LOADING_ERROR = 'The project is still loading. Try again in a moment.'
/** The answer while the project is in Live mode: evaluation runs only in Design. */
export const LIVE_MODE_ERROR =
  'The project is in Live mode, and evaluate_expression runs only in Design. ' +
  'Ask the user to switch the project back to Design.'
/** Most characters of a result; a longer one is cut and says how long it was. */
export const EVALUATE_RESULT_CHARS = 20_000
/** Most characters of an evaluation's error text. */
export const EVALUATE_ERROR_CHARS = 2_000

/**
 * Evaluates `expression` and returns the text it produced. Refused, before anything is evaluated,
 * while `isLive()` says the project is in Live mode: an evaluation runs in the execution context's
 * environment, and in Live an expression's writes are real. With `node_id`, it runs at that node's
 * statement, where the node's own binding and every earlier one are in scope; without, it runs in
 * the method body, where all of the method's bindings are (as `aiToolHandler.ts` anchors it).
 */
export async function evaluateExpression(
  deps: Pick<GraphToolDeps, 'db' | 'currentMethod'> & {
    evaluateRaw: (scope: ExternalId, expression: string) => Promise<Result<string> | null>
    /** Whether the project is in Live mode now; asked on every call. */
    isLive: () => boolean
  },
  args: { expression: string; node_id?: string },
): Promise<McpToolResult> {
  if (deps.isLive()) return { ok: false, error: LIVE_MODE_ERROR }
  let scope: ExternalId
  if (args.node_id != null) {
    const found = findNode(deps.db, args.node_id)
    if (!found.ok) return found
    scope = found.value.node.outerAst.externalId
  } else {
    const ast = deps.currentMethod.ast
    if (!ast.ok) return { ok: false, error: ast.error.message('') }
    const body = ast.value.body
    if (body == null) return { ok: false, error: 'The method on screen has no body.' }
    scope = body.externalId
  }
  try {
    const result = await deps.evaluateRaw(scope, args.expression)
    if (result == null) return { ok: false, error: STILL_LOADING_ERROR }
    if (!result.ok) return evaluationError(result.error)
    return { ok: true, value: truncate(result.value, EVALUATE_RESULT_CHARS, truncationNote) }
  } catch (err) {
    return evaluationError(err)
  }
}

function evaluationError(err: unknown): McpToolResult {
  return {
    ok: false,
    error: truncate(translateEngineError(formatLsError(err)), EVALUATE_ERROR_CHARS),
  }
}

function truncationNote(totalLength: number): string {
  return (
    `\n… [truncated: ${totalLength} characters in total. ` +
    'Narrow the expression, e.g. with .take or a row limit.]'
  )
}
