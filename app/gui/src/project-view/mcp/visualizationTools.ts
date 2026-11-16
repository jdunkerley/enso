/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The window's half of the MCP `get_visualization` tool: `get_visualization_data` answers
 * with what a node's visualization was given, and `prepare_visualization` gets the visualization
 * ready to be photographed by Electron main and answers with where it is. Both show a hidden
 * visualization first, as `set_visualization` does. Pure functions over
 * {@link VisualizationToolDeps}.
 */
import type { McpToolResult } from 'enso-common/src/mcp'
import { toolError } from './editTools'
import { jsonResult } from './graphTools'
import type { VisualizationEntry } from './visualizationRegistry'

/** How long a visualization may take to draw before the tool gives up. */
export const VISUALIZATION_WAIT_MS = 15_000
/** Most characters of view data returned. */
export const VISUALIZATION_DATA_CHARS = 20_000
/** Left of the call's time for the reply to reach main. */
const REPLY_MARGIN_MS = 2_000
/** Frames to wait after the view stops moving, for the visualization to repaint. */
const SETTLE_FRAMES = 2

/** The visualization has not drawn its data within the wait. */
export const STILL_LOADING_ERROR =
  'The visualization is still loading. Wait for the node to finish computing and try again.'
/** The visualization's panel is not in the DOM, or no part of it is in the viewport. */
export const NOT_ON_SCREEN_ERROR =
  'The visualization could not be brought on screen. Use format `data`.'

/** Edges in CSS pixels of the window's client area. */
export interface Edges {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** What the two handlers need from the project and the graph editor, read at call time. */
export interface VisualizationToolDeps {
  /** The node of that id in the method on screen. */
  readonly findNode: (nodeId: string) => { ok: true; value: string } | { ok: false; error: string }
  /** The node's mounted visualization, if it has one. */
  readonly lookup: (nodeId: string) => VisualizationEntry | undefined
  /** Whether the node's visualization is switched on. */
  readonly isShown: (nodeId: string) => boolean
  /** Switches it on as `set_visualization` does: through the edit session, with its refusals. */
  readonly show: (nodeId: string) => Promise<McpToolResult>
  /** Where the node's visualization panel is; undefined when it is not in the DOM. */
  readonly panelRect: (nodeId: string) => Edges | undefined
  /** The graph editor's viewport. */
  readonly viewRect: () => Edges
  /** The graph's zoom: 1 is 100%. */
  readonly scale: () => number
  /** Moves the view, without animation, so that the panel is in it at 100% where it fits. */
  readonly reveal: (nodeId: string) => void
  /** Whether the view is still moving. */
  readonly viewMoving: () => boolean
  /** Resolves on the next animation frame, or shortly after when the window draws none. */
  readonly nextFrame: () => Promise<void>
  /** The clock, in milliseconds. */
  readonly now: () => number
  /** When main stops waiting for the reply, in `now()` milliseconds. */
  readonly deadline: number
}

type Ready =
  | { ok: true; nodeId: string; entry: VisualizationEntry; shown: boolean }
  | { ok: false; error: string }

/** Shows the node's visualization if it is hidden and waits until it has drawn its data. */
async function readyVisualization(deps: VisualizationToolDeps, nodeId: string): Promise<Ready> {
  const found = deps.findNode(nodeId)
  if (!found.ok) return found
  let shown = false
  if (!deps.isShown(found.value)) {
    const result = await deps.show(nodeId)
    if (!result.ok) return result
    shown = true
  }
  const until = Math.min(deps.now() + VISUALIZATION_WAIT_MS, deps.deadline - REPLY_MARGIN_MS)
  for (;;) {
    const entry = deps.lookup(found.value)
    const status = entry?.status() ?? 'loading'
    if (entry != null && status !== 'loading') {
      const failure = failureOf(entry, status === 'error')
      return failure != null ?
          { ok: false, error: `The visualization failed: ${failure}` }
        : { ok: true, nodeId: found.value, entry, shown }
    }
    if (deps.now() >= until) return { ok: false, error: STILL_LOADING_ERROR }
    await deps.nextFrame()
  }
}

/** Why the visualization shows an error instead of data; undefined when it shows data. */
function failureOf(entry: VisualizationEntry, errorView: boolean): string | undefined {
  const data = entry.data()
  if (typeof data === 'object' && data != null && 'error' in data) {
    const error = (data as { error: unknown }).error
    if (error instanceof Error) return error.message
  }
  return errorView ? 'it could not be loaded.' : undefined
}

/** What the node's visualization was given, capped at {@link VISUALIZATION_DATA_CHARS}. */
export async function getVisualizationData(
  deps: VisualizationToolDeps,
  args: { node_id: string },
): Promise<McpToolResult> {
  const ready = await readyVisualization(deps, args.node_id)
  if (!ready.ok) return toolError(ready.error)
  const data = ready.entry.data()
  let text: string
  try {
    text = typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    return toolError(
      'The data of this visualization cannot be written as JSON. Use format `image`.',
    )
  }
  const truncated = text.length > VISUALIZATION_DATA_CHARS
  return jsonResult({
    node_id: ready.nodeId,
    visualization: ready.entry.name(),
    shown: ready.shown,
    truncated,
    data: truncated ? text.slice(0, VISUALIZATION_DATA_CHARS) : parsedOrText(data),
  })
}

/** Text that is JSON as its value, so that it is not quoted a second time; anything else as is. */
function parsedOrText(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

/**
 * Gets the node's visualization ready to be captured and answers with its rectangle. The view is
 * moved only when the panel is not wholly in the viewport or the graph is zoomed out.
 */
export async function prepareVisualization(
  deps: VisualizationToolDeps,
  args: { node_id: string },
): Promise<McpToolResult> {
  const ready = await readyVisualization(deps, args.node_id)
  if (!ready.ok) return toolError(ready.error)
  const { nodeId, entry } = ready
  let moved = false
  if (!entry.fullscreen()) {
    const before = deps.panelRect(nodeId)
    if (before == null) return toolError(NOT_ON_SCREEN_ERROR)
    if (deps.scale() < 1 || !contains(deps.viewRect(), before)) {
      deps.reveal(nodeId)
      moved = true
    }
  }
  // Also when nothing moved: a visualization that has just become ready has yet to paint.
  const until = deps.deadline - REPLY_MARGIN_MS
  for (let still = 0; still < SETTLE_FRAMES;) {
    if (deps.now() >= until) return toolError(STILL_LOADING_ERROR)
    await deps.nextFrame()
    still = deps.viewMoving() ? 0 : still + 1
  }
  const panel = deps.panelRect(nodeId)
  if (panel == null) return toolError(NOT_ON_SCREEN_ERROR)
  // A panel larger than the viewport even zoomed out is cut to what shows.
  const visible = entry.fullscreen() ? panel : intersection(panel, deps.viewRect())
  const x = Math.round(visible.left)
  const y = Math.round(visible.top)
  const width = Math.round(visible.right) - x
  const height = Math.round(visible.bottom) - y
  if (width <= 0 || height <= 0) return toolError(NOT_ON_SCREEN_ERROR)
  return jsonResult({
    node_id: nodeId,
    visualization: entry.name(),
    shown: ready.shown,
    moved,
    rect: { x, y, width, height },
  })
}

function contains(outer: Edges, inner: Edges): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  )
}

function intersection(a: Edges, b: Edges): Edges {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
}
