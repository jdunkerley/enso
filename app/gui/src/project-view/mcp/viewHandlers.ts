/**
 * @file The window handlers of the tools that navigate and look at the editor: `select_nodes`,
 * `open_method` and `prepare_graph_image` (which is not an MCP tool: main's `get_graph_image` calls
 * it).
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import { afterGraphUpdate } from './projectEvents'
import {
  invalidArgument,
  isStringArray,
  nextFrame,
  type ProjectToolContext,
} from './projectToolContext'
import { openMethod, prepareGraphImage, selectNodes, type ViewToolDeps } from './viewTools'

function viewDeps({ currentProject, editor, session }: ProjectToolContext): ViewToolDeps {
  const graph = currentProject.graph.value
  return {
    db: graph.db,
    select: editor.selectNodes,
    selected: editor.selectedNodes,
    nodeCanBeEntered: (id) => graph.nodeCanBeEntered(id),
    enterNode: editor.enterNode,
    canLeave: editor.canLeaveMethod,
    leaveMethod: editor.leaveMethod,
    waitForGraph: (timeoutMs) => afterGraphUpdate(currentProject.graph.value, timeoutMs),
    currentMethodName: () => {
      const pointer = currentProject.graph.value.currentMethod.pointer
      return pointer.ok ? pointer.value.name : undefined
    },
    contextChanged: () => session.releaseStep(),
  }
}

/** `select_nodes`, `open_method` and `prepare_graph_image`. */
export function viewHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  const { currentProject, editor } = ctx
  return {
    select_nodes: async (args) => {
      const node_ids = args.node_ids
      if (!isStringArray(node_ids)) return invalidArgument('node_ids', 'a list of strings')
      return selectNodes(viewDeps(ctx), { node_ids })
    },
    open_method: async (args) => {
      const node_id = args.node_id
      if (node_id != null && typeof node_id !== 'string') {
        return invalidArgument('node_id', 'a string')
      }
      return openMethod(viewDeps(ctx), node_id != null ? { node_id } : {})
    },
    prepare_graph_image: async (args, _caller, deadline) => {
      const node_ids = args.node_ids
      if (node_ids != null && !isStringArray(node_ids)) {
        return invalidArgument('node_ids', 'a list of strings')
      }
      const graph = currentProject.graph.value
      return prepareGraphImage(
        {
          db: graph.db,
          area: (id) => graph.visibleArea(id),
          viewRect: editor.viewRect,
          clearRect: editor.clearViewRect,
          viewport: editor.viewport,
          scale: editor.scale,
          frame: editor.frameScene,
          viewMoving: editor.viewMoving,
          nextFrame,
          now: () => Date.now(),
          deadline,
        },
        node_ids != null ? { node_ids } : {},
      )
    },
  }
}
