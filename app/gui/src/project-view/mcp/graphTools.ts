/**
 * @file The `get_graph` and `get_node` MCP tools: read the graph of the method on screen. Pure
 * functions over {@link GraphToolDeps}, which `useProjectMcpTools` builds from the open project's
 * stores at call time.
 */
/* eslint-disable camelcase -- result field names are snake_case on the wire, as the arguments are */
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
/**
 * Most characters of all `get_graph` previews together: once the previews collected reach it, no
 * more start, and the nodes left without one count in `previews_skipped`.
 */
export const GRAPH_PREVIEW_TOTAL_CHARS = 40_000
/** Most characters of a node's `code`, `comment` and panic `message` in `get_graph`. */
export const GRAPH_NODE_TEXT_CHARS = 2_000
/** Most characters of the method's `source` in `get_graph`. */
export const GRAPH_SOURCE_CHARS = 50_000
/** Most characters of a node's value preview in `get_node`. */
export const NODE_PREVIEW_CHARS = 20_000
/** Most `get_graph` previews evaluating at once. */
export const GRAPH_PREVIEW_CONCURRENCY = 8
/**
 * How long after its first preview starts `get_graph` may start more. Previews in flight then
 * still finish (or time out); the nodes not yet started are counted in `previews_skipped`.
 */
export const GRAPH_PREVIEW_DEADLINE_MS = 15_000

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
  /** The clock for the previews' deadline, in milliseconds; `Date.now` by default. */
  readonly now?: () => number
}

/** What `get_graph` reads besides the graph: the nodes selected in the editor. */
export interface GetGraphDeps extends GraphToolDeps {
  readonly selection: () => Iterable<NodeId>
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
 * with a short preview of each value unless `previews` is false. `previews_skipped` counts the
 * value nodes left without a preview because the previews' deadline passed or their total budget
 * was spent (only when non-zero). `selection` lists the ids of the nodes selected in the editor. The
 * source and each node's texts are capped; `get_node` gives one node in full.
 */
export async function getGraph(
  deps: GetGraphDeps,
  args: { previews?: boolean },
): Promise<McpToolResult> {
  const { ast, pointer } = deps.currentMethod
  if (!ast.ok) return { ok: false, error: ast.error.message('') }
  if (!pointer.ok) return { ok: false, error: pointer.error.message('') }
  const nodes = Array.from(deps.db.nodeIdToNode.entries(), ([id, node]) => ({
    node,
    summary: capNodeTexts(summarizeNode(deps, id, node)),
  }))
  // Read with the nodes, before the previews' wait, so that both describe the same moment.
  const selection = [...deps.selection()]
  const previewsSkipped = args.previews !== false ? await addGraphPreviews(deps, nodes) : 0
  return jsonResult({
    method: pointer.value.name,
    source: truncate(ast.value.code(), GRAPH_SOURCE_CHARS),
    imports: moduleImports(deps.moduleRoot()),
    nodes: nodes.map(({ summary }) => summary),
    selection,
    ...(previewsSkipped > 0 ? { previews_skipped: previewsSkipped } : {}),
  })
}

/** The summary with its `code`, `comment` and `message` cut to {@link GRAPH_NODE_TEXT_CHARS}. */
export function capNodeTexts(summary: NodeSummary): NodeSummary {
  summary.code = truncate(summary.code, GRAPH_NODE_TEXT_CHARS)
  if (summary.comment != null) summary.comment = truncate(summary.comment, GRAPH_NODE_TEXT_CHARS)
  if (summary.message != null) summary.message = truncate(summary.message, GRAPH_NODE_TEXT_CHARS)
  return summary
}

/**
 * Adds a preview to each value node with a plain name: at most {@link GRAPH_PREVIEW_CONCURRENCY}
 * evaluating at once, none started after {@link GRAPH_PREVIEW_DEADLINE_MS}, and none started once
 * the previews collected reach {@link GRAPH_PREVIEW_TOTAL_CHARS}. Returns how many were not started
 * for either reason.
 */
async function addGraphPreviews(
  deps: GraphToolDeps,
  nodes: readonly { node: Node; summary: NodeSummary }[],
): Promise<number> {
  const now = deps.now ?? Date.now
  const queue = nodes.filter(
    ({ summary }) =>
      summary.state === 'value' && summary.name != null && isIdentifier(summary.name),
  )
  const deadline = now() + GRAPH_PREVIEW_DEADLINE_MS
  let next = 0
  let skipped = 0
  let collected = 0
  async function worker() {
    while (next < queue.length) {
      const { node, summary } = queue[next++]!
      if (now() >= deadline || collected >= GRAPH_PREVIEW_TOTAL_CHARS) {
        skipped += 1
        continue
      }
      const preview = await evaluateOnNode(
        deps,
        node,
        summary.name,
        'to_display_text',
        GRAPH_PREVIEW_TIMEOUT_MS,
      )
      if (preview != null) {
        summary.preview = truncate(preview, GRAPH_PREVIEW_CHARS)
        collected += summary.preview.length
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(GRAPH_PREVIEW_CONCURRENCY, queue.length) }, worker),
  )
  return skipped
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
    if (error != null) summary.error = truncate(error, NODE_PREVIEW_CHARS)
  }
  return jsonResult(summary)
}

/** Most characters of a `node_id` quoted back in {@link unknownNodeError}. */
const NODE_ID_QUOTE_CHARS = 200

/** The error a tool returns for a `node_id` that is not a node of the method on screen. */
export function unknownNodeError(nodeId: string): string {
  return `No node with id ${truncate(nodeId, NODE_ID_QUOTE_CHARS)} in the method on screen. Call get_graph for the current ids.`
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
 * scope. The text, or null when the node has no plain name or the evaluation failed, rejected or
 * threw: one bad preview leaves its node without one, it does not fail the tool.
 */
async function evaluateOnNode(
  deps: GraphToolDeps,
  node: Node,
  name: string | null,
  method: string,
  timeoutMs: number,
): Promise<string | null> {
  if (name == null || !isIdentifier(name)) return null
  try {
    const result = await deps.evaluate(node.outerAst.externalId, `${name}.${method}`, timeoutMs)
    return result?.ok ? result.value : null
  } catch {
    return null
  }
}

/**
 * `text` cut to `limit` characters, followed by `ending(text.length)` (by default `…`) when it was
 * cut; shorter text unchanged.
 */
export function truncate(
  text: string,
  limit: number,
  ending: (totalLength: number) => string = () => '…',
): string {
  return text.length > limit ? text.slice(0, limit) + ending(text.length) : text
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
