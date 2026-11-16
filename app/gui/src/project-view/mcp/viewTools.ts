/**
 * @file The MCP tools that change what the graph editor shows, not the project: `select_nodes` and
 * `open_method`, and the window handler `prepare_graph_image` (not an MCP tool: main's
 * `get_graph_image` calls it, then captures the viewport). They are the only project tools that
 * change the selection, and with `prepare_visualization` (`visualizationTools.ts`, which brings a
 * visualization into view to be captured) the only ones that move the view. `select_nodes`,
 * `open_method` and `prepare_graph_image` work in Live mode too; `prepare_visualization` works
 * there only for a visualization already shown, since showing one is an edit. Pure functions over
 * {@link ViewToolDeps} and {@link GraphImageDeps}.
 */
import type { GraphDb, NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Rect } from '@/util/data/rect'
import type { McpToolResult } from 'enso-common/src/mcp'
import { toolError } from './editTools'
import { findNode, jsonResult } from './graphTools'
import type { Edges } from './visualizationTools'

/** How long `open_method` waits for the graph to show the method it opened. */
export const OPEN_METHOD_WAIT_MS = 5_000
export const NOT_ENTERABLE_ERROR = 'That node is not a component defined in this project.'
export const ALREADY_AT_TOP_ERROR = 'Already at the top level.'
/** The answer when the graph editor shows no method. */
export const NO_METHOD_ERROR = 'The graph editor shows no method now. Call get_graph.'

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

/** The margin around the framed nodes, in scene units. */
export const GRAPH_IMAGE_MARGIN = 40
/** Most `node_ids` one `get_graph_image` call frames. */
export const GRAPH_IMAGE_NODES_MAX = 500
/** The lowest scale the graph is framed at: 10%. */
export const GRAPH_IMAGE_MIN_SCALE = 0.1
/** The highest scale the graph is framed at: 100%, never larger. */
export const GRAPH_IMAGE_MAX_SCALE = 1
/** The answer for a method on screen with no nodes. */
export const EMPTY_METHOD_ERROR =
  'The method on screen has no nodes, so there is nothing to picture. Add nodes first.'
/** The answer when none of the nodes has been drawn yet. */
const NOT_DRAWN_ERROR = 'The nodes are not drawn yet. Try again in a moment.'
/** The answer when the view did not stop moving before the call's deadline. */
const VIEW_MOVING_ERROR = 'The graph view did not stop moving. Try again.'
/** Left of the call's time for the reply to reach main. */
const REPLY_MARGIN_MS = 2_000
/** Frames to wait after the view stops moving, for the graph to repaint. */
const SETTLE_FRAMES = 2

/** What `prepare_graph_image` needs from the graph and the editor, read at call time. */
export interface GraphImageDeps {
  readonly db: GraphDb
  /** The room the node takes on screen (`graph.visibleArea`); undefined before it is drawn. */
  readonly area: (id: NodeId) => Rect | undefined
  /** The graph editor's viewport, in CSS pixels of the window's client area. */
  readonly viewRect: () => Edges
  /** The graph's zoom: 1 is 100%. */
  readonly scale: () => number
  /** Moves the view, without animation, to show `rect` (scene units) centred at `scale`. */
  readonly frame: (rect: Rect, scale: number) => void
  /** Whether the view is still moving. */
  readonly viewMoving: () => boolean
  /** Resolves on the next animation frame, or shortly after when the window draws none. */
  readonly nextFrame: () => Promise<void>
  /** The clock, in milliseconds. */
  readonly now: () => number
  /** When main stops waiting for the reply, in `now()` milliseconds. */
  readonly deadline: number
}

/**
 * How to frame `areas` in a viewport of that size: their bounding area with
 * {@link GRAPH_IMAGE_MARGIN} around it, and the largest scale at which it fits, clamped to
 * [{@link GRAPH_IMAGE_MIN_SCALE}, {@link GRAPH_IMAGE_MAX_SCALE}]. Undefined for no areas.
 */
export function graphImageFrame(
  areas: readonly Rect[],
  viewport: { readonly width: number; readonly height: number },
): { rect: Rect; scale: number } | undefined {
  const bounds = Rect.Bounding(...areas)
  if (bounds == null) return undefined
  const rect = bounds.expand(GRAPH_IMAGE_MARGIN)
  const fit = Math.min(viewport.width / rect.width, viewport.height / rect.height)
  const scale = Math.min(GRAPH_IMAGE_MAX_SCALE, Math.max(GRAPH_IMAGE_MIN_SCALE, fit))
  return { rect, scale }
}

/**
 * Frames the nodes of the method on screen (or those of `node_ids`, at most
 * {@link GRAPH_IMAGE_NODES_MAX}; an unknown one refuses) in the graph viewport, without animation
 * ({@link graphImageFrame}), waits for the view to stop moving and for two frames, and answers
 * `{ rect, scale, nodes }`: the viewport's client rectangle for main to capture, the scale, and
 * the number of nodes framed. Moves the view and does not move it back; edits nothing, so it works
 * in Live mode.
 */
export async function prepareGraphImage(
  deps: GraphImageDeps,
  args: { node_ids?: readonly string[] },
): Promise<McpToolResult> {
  const ids: NodeId[] = []
  if (args.node_ids != null) {
    if (args.node_ids.length > GRAPH_IMAGE_NODES_MAX) {
      return toolError(`Pass at most ${GRAPH_IMAGE_NODES_MAX} node ids.`)
    }
    for (const nodeId of args.node_ids) {
      const found = findNode(deps.db, nodeId)
      if (!found.ok) return found
      if (!ids.includes(found.value.id)) ids.push(found.value.id)
    }
  } else {
    ids.push(...deps.db.nodeIdToNode.keys())
  }
  if (ids.length === 0) return toolError(EMPTY_METHOD_ERROR)
  const areas = ids.map((id) => deps.area(id)).filter((area) => area != null)
  const view = deps.viewRect()
  const framing = graphImageFrame(areas, {
    width: view.right - view.left,
    height: view.bottom - view.top,
  })
  if (framing == null) return toolError(NOT_DRAWN_ERROR)
  deps.frame(framing.rect, framing.scale)
  const until = deps.deadline - REPLY_MARGIN_MS
  while (deps.viewMoving()) {
    if (deps.now() >= until) return toolError(VIEW_MOVING_ERROR)
    await deps.nextFrame()
  }
  for (let still = 0; still < SETTLE_FRAMES;) {
    if (deps.now() >= until) return toolError(VIEW_MOVING_ERROR)
    await deps.nextFrame()
    still = deps.viewMoving() ? 0 : still + 1
  }
  const rect = deps.viewRect()
  const x = Math.round(rect.left)
  const y = Math.round(rect.top)
  return jsonResult({
    rect: { x, y, width: Math.round(rect.right) - x, height: Math.round(rect.bottom) - y },
    scale: Math.round(deps.scale() * 1000) / 1000,
    nodes: areas.length,
  })
}
