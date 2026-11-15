/**
 * @file The `get_graph` and `get_node` MCP tools: read the graph of the method on screen. Pure
 * functions over {@link GraphToolDeps}, which `useProjectMcpTools` builds from the open project's
 * stores at call time.
 */
import {
  asNodeId,
  type GraphDb,
  type Node,
  type NodeId,
} from '$/providers/openedProjects/graph/graphDatabase'
import { Ast } from '@/util/ast'
import { nodeDocumentationText } from '@/util/ast/node'
import type { MethodPointer } from '@/util/methodPointer'
import type { ProjectPath } from '@/util/projectPath'
import { isIdentifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { Result } from 'enso-common/src/utilities/data/result'
import type { ExternalId } from 'ydoc-shared/yjsModel'

/** Most characters of a node's value preview in `get_graph`. */
export const GRAPH_PREVIEW_CHARS = 2_000
/** Most characters of a node's value preview in `get_node`. */
export const NODE_PREVIEW_CHARS = 20_000

const GRAPH_PREVIEW_TIMEOUT_MS = 5_000
const NODE_PREVIEW_TIMEOUT_MS = 10_000

export interface GraphToolDeps {
  readonly db: GraphDb
  readonly currentMethod: {
    ast: Result<Ast.FunctionDef>
    pointer: Result<MethodPointer>
  }
  readonly moduleRoot: () => Ast.Ast | undefined
  /** `projectNames.printProjectPath`. */
  readonly printType: (type: ProjectPath) => string
  /** Evaluates to text in a node's scope; null when not ready. */
  readonly evaluate: (
    scope: ExternalId,
    expression: string,
    timeoutMs: number,
  ) => Promise<Result<string> | null>
}

export interface NodeSummary {
  id: string
  name: string | null
  code: string
  kind: 'component' | 'input' | 'output'
  type: string | null
  state: 'value' | 'error' | 'panic' | 'pending' | 'unknown'
  message?: string
  warnings?: number
  comment?: string
  preview?: string
}

/** A node's summary, without a value preview. */
export function summarizeNode(deps: GraphToolDeps, id: NodeId, node: Node): NodeSummary {
  const info = deps.db.getExpressionInfo(id)
  const summary: NodeSummary = {
    id,
    name: node.pattern?.code() ?? null,
    code: node.innerExpr.code(),
    kind: node.type,
    type: info?.typeInfo != null ? deps.printType(info.typeInfo.primaryType) : null,
    state: 'unknown',
  }
  const payload = info?.payload
  switch (payload?.type) {
    case 'Value':
      summary.state = 'value'
      if (payload.warnings != null && payload.warnings.count > 0) {
        summary.warnings = payload.warnings.count
      }
      break
    case 'DataflowError':
      summary.state = 'error'
      break
    case 'Panic':
      summary.state = 'panic'
      summary.message = payload.message
      break
    case 'Pending':
      summary.state = 'pending'
      break
  }
  const comment = nodeDocumentationText(node)
  if (comment !== '') summary.comment = comment
  return summary
}

/**
 * The method on screen: its name and source, the module's imports, and a summary of each node,
 * with a short preview of each value unless `previews` is false.
 */
export async function getGraph(
  deps: GraphToolDeps,
  args: { previews?: boolean },
): Promise<McpToolResult> {
  const { ast, pointer } = deps.currentMethod
  if (!ast.ok) return { ok: false, error: ast.error.message('') }
  if (!pointer.ok) return { ok: false, error: pointer.error.message('') }
  const nodes = Array.from(deps.db.nodeIdToNode.entries(), ([id, node]) => ({
    node,
    summary: summarizeNode(deps, id, node),
  }))
  if (args.previews !== false) {
    await Promise.all(
      nodes.map(async ({ node, summary }) => {
        if (summary.state !== 'value') return
        const preview = await evaluateOnNode(
          deps,
          node,
          summary.name,
          'to_display_text',
          GRAPH_PREVIEW_TIMEOUT_MS,
        )
        if (preview != null) summary.preview = truncate(preview, GRAPH_PREVIEW_CHARS)
      }),
    )
  }
  return jsonResult({
    method: pointer.value.name,
    source: ast.value.code(),
    imports: moduleImports(deps.moduleRoot()),
    nodes: nodes.map(({ summary }) => summary),
  })
}

/**
 * One node of the method on screen: its summary with a longer preview of its value, and for a
 * node whose value is a dataflow error, that error's text.
 */
export async function getNode(
  deps: GraphToolDeps,
  args: { node_id: string },
): Promise<McpToolResult> {
  const found = findNode(deps.db, args.node_id)
  if (!found.ok) return found
  const { id, node } = found.value
  const summary: NodeSummary & { error?: string } = summarizeNode(deps, id, node)
  if (summary.state === 'value') {
    const preview = await evaluateOnNode(
      deps,
      node,
      summary.name,
      'to_text',
      NODE_PREVIEW_TIMEOUT_MS,
    )
    if (preview != null) summary.preview = truncate(preview, NODE_PREVIEW_CHARS)
  } else if (summary.state === 'error') {
    const error = await evaluateOnNode(
      deps,
      node,
      summary.name,
      'catch_primitive (e -> e.to_display_text)',
      NODE_PREVIEW_TIMEOUT_MS,
    )
    if (error != null) summary.error = error
  }
  return jsonResult(summary)
}

/** The error a tool returns for a `node_id` that is not a node of the method on screen. */
export function unknownNodeError(nodeId: string): string {
  return `No node with id ${nodeId} in the method on screen. Call get_graph for the current ids.`
}

/** The node of the method on screen with the given id, or the tool's error for an unknown id. */
export function findNode(
  db: GraphDb,
  nodeId: string,
): { ok: true; value: { id: NodeId; node: Node } } | { ok: false; error: string } {
  const id = asNodeId(nodeId as ExternalId)
  const node = db.nodeIdToNode.get(id)
  return node != null ?
      { ok: true, value: { id, node } }
    : { ok: false, error: unknownNodeError(nodeId) }
}

/** Serialises a tool's value the way every tool here returns it. */
export function jsonResult(value: unknown): McpToolResult {
  return { ok: true, value: JSON.stringify(value, null, 1) }
}

/**
 * Evaluates `<name>.<method>` in the scope of the node's statement, where its own binding is in
 * scope. The text, or null when the node has no plain name or the evaluation failed.
 */
async function evaluateOnNode(
  deps: GraphToolDeps,
  node: Node,
  name: string | null,
  method: string,
  timeoutMs: number,
): Promise<string | null> {
  if (name == null || !isIdentifier(name)) return null
  const result = await deps.evaluate(node.outerAst.externalId, `${name}.${method}`, timeoutMs)
  return result?.ok ? result.value : null
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** The module's import statements, collected as `composables/ai.ts` does. */
function moduleImports(moduleRoot: Ast.Ast | undefined): string[] {
  const imports: string[] = []
  if (moduleRoot instanceof Ast.BodyBlock) {
    for (const statement of moduleRoot.statements()) {
      if (statement instanceof Ast.Import) imports.push(statement.code())
    }
  }
  return imports
}
