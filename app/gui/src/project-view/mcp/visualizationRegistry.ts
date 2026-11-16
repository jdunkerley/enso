/**
 * @file Which node visualizations are mounted, so that an MCP tool can find one by its node. A
 * visualization's data and its DOM live inside `GraphVisualization.vue`; each instance that shows
 * a node's visualization (not a Ctrl-hover preview) writes itself in here while it is mounted.
 */

/** Whether a visualization has drawn its data. */
export type VisualizationStatus = 'loading' | 'error' | 'ready'

/** One mounted visualization, read when asked: every member reflects the moment of the call. */
export interface VisualizationEntry {
  /** The panel: toolbar and content. Undefined before it is in the DOM. */
  readonly panel: () => HTMLElement | undefined
  readonly status: () => VisualizationStatus
  /** The visualization type's name, e.g. `Table`. */
  readonly name: () => string
  /** What the view was given. Undefined while loading. */
  readonly data: () => unknown
  readonly fullscreen: () => boolean
}

/** Entries by project id, then by node id. */
const projects = new Map<string, Map<string, VisualizationEntry>>()

/** Adds the entry, replacing one for the same node. Returns the function that removes it. */
export function registerVisualization(
  projectId: string,
  nodeId: string,
  entry: VisualizationEntry,
): () => void {
  let nodes = projects.get(projectId)
  if (nodes == null) projects.set(projectId, (nodes = new Map()))
  nodes.set(nodeId, entry)
  return () => {
    const current = projects.get(projectId)
    // A node's component can be replaced before the old one unmounts: only remove our own.
    if (current?.get(nodeId) !== entry) return
    current.delete(nodeId)
    if (current.size === 0) projects.delete(projectId)
  }
}

/** The mounted visualization of the node, if it has one. */
export function lookupVisualization(
  projectId: string,
  nodeId: string,
): VisualizationEntry | undefined {
  return projects.get(projectId)?.get(nodeId)
}
