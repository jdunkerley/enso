/** @file The window handlers of the layout tools: `move_nodes` and `arrange_nodes`. */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolHandler } from '$/mcp/toolDispatcher'
import type { McpCaller } from 'enso-common/src/mcp'
import { arrangeNodes, moveNodes, type ArrangeToolDeps, type NodeMove } from './layoutTools'
import { moduleChangedBy } from './projectEvents'
import { invalidArgument, isStringArray, type ProjectToolContext } from './projectToolContext'

/** The layout tools' dependencies: positions are module metadata, edited through the session. */
function layoutDeps(
  { currentProject, editor, session }: ProjectToolContext,
  caller: McpCaller,
  deadline: number,
): ArrangeToolDeps {
  const graph = currentProject.graph.value
  return {
    db: graph.db,
    currentMethod: graph.currentMethod,
    session,
    caller,
    deadline,
    setNodePositions: (moves) => currentProject.graph.value.setNodePositions(moves),
    moduleChanged: (f) => moduleChangedBy(currentProject.module.value, f),
    tidy: editor.tidy,
    alignment: editor.alignment,
  }
}

/** `move_nodes` and `arrange_nodes`. */
export function layoutHandlers(ctx: ProjectToolContext): Record<string, McpToolHandler> {
  return {
    move_nodes: async (args, caller, deadline) => {
      const moves = args.moves
      if (!Array.isArray(moves) || !moves.every(isNodeMove)) {
        return invalidArgument('moves', 'a list of `{ node_id, x, y }`')
      }
      return moveNodes(layoutDeps(ctx, caller, deadline), { moves })
    },
    arrange_nodes: async (args, caller, deadline) => {
      const { action, node_ids } = args
      if (typeof action !== 'string') return invalidArgument('action', 'a string')
      if (node_ids != null && !isStringArray(node_ids)) {
        return invalidArgument('node_ids', 'a list of strings')
      }
      return arrangeNodes(layoutDeps(ctx, caller, deadline), {
        action,
        ...(node_ids != null ? { node_ids } : {}),
      })
    },
  }
}

function isNodeMove(value: unknown): value is NodeMove {
  if (typeof value !== 'object' || value == null) return false
  const { node_id, x, y } = value as Record<string, unknown>
  return typeof node_id === 'string' && typeof x === 'number' && typeof y === 'number'
}
