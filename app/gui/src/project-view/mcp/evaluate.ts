/**
 * @file The `evaluate_expression` MCP tool: evaluates an Enso expression to text in the scope of
 * the method on screen or of one of its nodes.
 */
import { formatLsError, translateEngineError } from '@/components/ComponentBrowser/aiToolHandler'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { Result } from 'enso-common/src/utilities/data/result'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { findNode, type GraphToolDeps } from './graphTools'

export const STILL_LOADING_ERROR = 'The project is still loading. Try again in a moment.'

/**
 * Evaluates `expression` and returns the text it produced. With `node_id`, it runs at that node's
 * statement, where the node's own binding and every earlier one are in scope; without, it runs in
 * the method body, where all of the method's bindings are (as `aiToolHandler.ts` anchors it).
 */
export async function evaluateExpression(
  deps: Pick<GraphToolDeps, 'db' | 'currentMethod'> & {
    evaluateRaw: (scope: ExternalId, expression: string) => Promise<Result<string> | null>
  },
  args: { expression: string; node_id?: string },
): Promise<McpToolResult> {
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
    if (!result.ok) return { ok: false, error: translateEngineError(formatLsError(result.error)) }
    return { ok: true, value: result.value }
  } catch (err) {
    return { ok: false, error: translateEngineError(formatLsError(err)) }
  }
}
