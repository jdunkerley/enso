/**
 * @file The window handlers of `list_visualizations` and of `get_visualization_data` and
 * `prepare_visualization` (which are not MCP tools: main's `get_visualization` calls them).
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { McpCaller } from 'enso-common/src/mcp'
import { editDeps } from './editHandlers'
import { setVisualization, toolError } from './editTools'
import { findNode } from './graphTools'
import { withProjectId } from './imageTools'
import { panelQuiet } from './panelQuiet'
import { invalidArgument, nextFrame, sizeOf, type ProjectToolContext } from './projectToolContext'
import { lookupVisualization } from './visualizationRegistry'
import {
  getVisualizationData,
  listVisualizations,
  noSuchVisualizationError,
  prepareVisualization,
  type VisualizationToolDeps,
} from './visualizationTools'

/**
 * The visualization handlers' dependencies. Showing a hidden visualization, or switching to
 * another, goes through the edit session, as `set_visualization` does.
 */
function visualizationDeps(
  ctx: ProjectToolContext,
  caller: McpCaller,
  deadline: number,
): VisualizationToolDeps {
  const { currentProject, editor } = ctx
  const graph = currentProject.graph.value
  const panelRect = (nodeId: string) =>
    lookupVisualization(currentProject.id.value, nodeId)?.panel()?.getBoundingClientRect()
  return {
    findNode: (nodeId) => {
      const found = findNode(graph.db, nodeId)
      return found.ok ? { ok: true, value: found.value.id } : found
    },
    lookup: (nodeId) => lookupVisualization(currentProject.id.value, nodeId),
    isShown: (nodeId) => graph.db.nodeIdToNode.get(nodeId as NodeId)?.vis?.visible ?? false,
    storedName: (nodeId) => graph.db.nodeIdToNode.get(nodeId as NodeId)?.vis?.identifier?.name,
    // As `GraphNodes.vue` passes `edited` to the node, which then unmounts its visualization.
    isEdited: (nodeId) => graph.editedNodeInfo?.id === nodeId,
    availableNames: (nodeId) =>
      editor.visualizationsFor(nodeId as NodeId).map((identifier) => identifier.name),
    size: (nodeId) => sizeOf(currentProject.graph.value, nodeId as NodeId),
    show: (nodeId, visualization) => {
      // Two visualizations of the same name from different modules: the first in the
      // dropdown's order, which is the one `availableNames` lists first.
      const offered = editor.visualizationsFor(nodeId as NodeId)
      const identifier =
        visualization != null ?
          offered.find((candidate) => candidate.name === visualization)
        : undefined
      // The node's type may have changed since the name was checked: never show it unswitched.
      if (visualization != null && identifier == null) {
        const names = offered.map((candidate) => candidate.name)
        return Promise.resolve(toolError(noSuchVisualizationError(visualization, names)))
      }
      return setVisualization(editDeps(ctx, caller, deadline), {
        node_id: nodeId,
        visible: true,
        ...(identifier != null ? { identifier } : {}),
      })
    },
    panelRect,
    viewRect: editor.viewRect,
    scale: editor.scale,
    reveal: (nodeId) => {
      const rect = panelRect(nodeId)
      if (rect != null) editor.revealClientRect(rect)
    },
    viewMoving: editor.viewMoving,
    nextFrame,
    panelQuiet: (nodeId, budgetMs) =>
      panelQuiet(lookupVisualization(currentProject.id.value, nodeId)?.panel(), budgetMs),
    now: () => Date.now(),
    deadline,
  }
}

/** `list_visualizations` and the two visualization handlers main calls. */
export function visualizationHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  return {
    list_visualizations: async (args, caller, deadline) => {
      const node_id = args.node_id
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      return listVisualizations(visualizationDeps(ctx, caller, deadline), { node_id })
    },
    get_visualization_data: async (args, caller, deadline) => {
      const { node_id, visualization } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (visualization != null && typeof visualization !== 'string') {
        return invalidArgument('visualization', 'a string')
      }
      return getVisualizationData(visualizationDeps(ctx, caller, deadline), {
        node_id,
        ...(visualization != null ? { visualization } : {}),
      })
    },
    prepare_visualization: async (args, caller, deadline) => {
      const { node_id, visualization } = args
      if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
      if (visualization != null && typeof visualization !== 'string') {
        return invalidArgument('visualization', 'a string')
      }
      const prepared = await prepareVisualization(visualizationDeps(ctx, caller, deadline), {
        node_id,
        ...(visualization != null ? { visualization } : {}),
      })
      // Which project took the picture: `add_image` stores it there only. Main does not pass it
      // on to the agent.
      return withProjectId(prepared, ctx.currentProject.id.value)
    },
  }
}
