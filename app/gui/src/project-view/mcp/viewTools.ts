/**
 * @file The MCP tools that change what the graph editor shows, not the project: `select_nodes` and
 * `open_method`. They are the only project tools that change the selection or move the view, and
 * they work in Live mode too. Pure functions over {@link ViewToolDeps}.
 */
import type { GraphDb, NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { McpToolResult } from 'enso-common/src/mcp'
import { toolError } from './editTools'
import { findNode, jsonResult } from './graphTools'

/** How long `open_method` waits for the graph to show the method it opened. */
export const OPEN_METHOD_WAIT_MS = 5_000
export const NOT_ENTERABLE_ERROR = 'That node is not a component defined in this project.'
export const ALREADY_AT_TOP_ERROR = 'Already at the top level.'
const NO_METHOD_ERROR = 'The graph editor shows no method now. Call get_graph.'

export interface ViewToolDeps {
  readonly db: GraphDb
  /** Makes these the selected nodes and pans to them; `[]` clears the selection. */
  readonly select: (ids: readonly NodeId[]) => void
  /** The selected nodes, as the editor orders them. */
  readonly selected: () => Iterable<NodeId>
  /** `graph.nodeCanBeEntered`: the node calls a function defined in this module. */
  readonly nodeCanBeEntered: (id: NodeId) => boolean
  readonly enterNode: (id: NodeId) => void
  /** Whether a method was entered, so that there is one to go back to. */
  readonly canLeave: () => boolean
  readonly leaveMethod: () => void
  /** Resolves when the node database next updates, or after `timeoutMs`. */
  readonly waitForGraph: (timeoutMs: number) => Promise<void>
  /** The name of the method on screen; undefined when it cannot be read. */
  readonly currentMethodName: () => string | undefined
  /** The user's context changed: an agent's open undo step ends here. */
  readonly contextChanged: () => void
}

/** Selects the nodes (each once) and pans to them; `[]` clears the selection. */
export async function selectNodes(
  deps: ViewToolDeps,
  args: { node_ids: string[] },
): Promise<McpToolResult> {
  const ids: NodeId[] = []
  for (const nodeId of args.node_ids) {
    const found = findNode(deps.db, nodeId)
    if (!found.ok) return found
    if (!ids.includes(found.value.id)) ids.push(found.value.id)
  }
  deps.select(ids)
  return jsonResult({ selected: [...deps.selected()] })
}

/**
 * With `node_id`, enters the function that node calls; without it, goes back to the method the
 * current one was entered from. Answers with the method on screen once the graph shows it.
 */
export async function openMethod(
  deps: ViewToolDeps,
  args: { node_id?: string },
): Promise<McpToolResult> {
  if (args.node_id != null) {
    const found = findNode(deps.db, args.node_id)
    if (!found.ok) return found
    if (!deps.nodeCanBeEntered(found.value.id)) return toolError(NOT_ENTERABLE_ERROR)
    deps.enterNode(found.value.id)
  } else {
    if (!deps.canLeave()) return toolError(ALREADY_AT_TOP_ERROR)
    deps.leaveMethod()
  }
  deps.contextChanged()
  await deps.waitForGraph(OPEN_METHOD_WAIT_MS)
  const method = deps.currentMethodName()
  return method != null ? jsonResult({ method }) : toolError(NO_METHOD_ERROR)
}
