/**
 * @file The layout MCP tools: `move_nodes`. Pure functions over {@link LayoutToolDeps}. A move is
 * module metadata, so it runs through the edit session like every edit (refused in Live, part of
 * the caller's undo step), and, changing nothing the engine computes, settles at once.
 */
/* eslint-disable camelcase -- argument names are snake_case on the wire */
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { Vec2 } from '@/util/data/vec2'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Ok } from 'enso-common/src/utilities/data/result'
import type { EditSession } from './editSession'
import { checkAtTurn, errorResult, methodOnScreen, settledResult, toolError } from './editTools'
import { findNode, scenePoint, type GraphToolDeps, type ScenePoint } from './graphTools'

/** Most nodes one `move_nodes` call moves. */
export const MOVE_NODES_MAX = 200
/** The largest distance from the origin, in scene units, a node may be moved to on either axis. */
export const MOVE_COORDINATE_LIMIT = 1_000_000

export interface LayoutToolDeps extends Pick<GraphToolDeps, 'db' | 'currentMethod'> {
  readonly session: Pick<EditSession, 'run'>
  readonly caller: McpCaller
  /** When the caller stops waiting (the tool dispatcher's deadline), passed to the session. */
  readonly deadline: number
  /**
   * `graph.setNodePositions`: moves the nodes by hand, all in one call (the nodes they were
   * pushing return to their places).
   */
  readonly setNodePositions: (moves: readonly (readonly [NodeId, Vec2])[]) => void
}

/** One entry of `move_nodes`' `moves`: where the node's top-left goes, in scene units. */
export interface NodeMove {
  node_id: string
  x: number
  y: number
}

/**
 * Moves the nodes to the given positions (each node's top-left, in scene units), all in one edit
 * with one `setNodePositions` call. Refused, before anything moves, for no move or more than
 * {@link MOVE_NODES_MAX}, a coordinate that is not finite or beyond {@link MOVE_COORDINATE_LIMIT},
 * an unknown node or the same node twice; and at its turn when the method on screen changed or a
 * node is gone ({@link checkAtTurn}). Answers `{ moved: [{ id, position }], settled: true }`, the
 * positions as stored after the edit.
 */
export async function moveNodes(
  deps: LayoutToolDeps,
  args: { moves: readonly NodeMove[] },
): Promise<McpToolResult> {
  if (args.moves.length < 1 || args.moves.length > MOVE_NODES_MAX) {
    return toolError(`Pass 1 to ${MOVE_NODES_MAX} moves.`)
  }
  const moves: [NodeId, Vec2][] = []
  for (const { node_id, x, y } of args.moves) {
    if (!isCoordinate(x) || !isCoordinate(y)) {
      return toolError(
        `The position of node ${node_id} is out of range: x and y must be numbers within ±1,000,000.`,
      )
    }
    const found = findNode(deps.db, node_id)
    if (!found.ok) return found
    const id = found.value.id
    if (moves.some(([moved]) => moved === id)) {
      return toolError(`Node ${node_id} is moved twice in this call. Give each node once.`)
    }
    moves.push([id, new Vec2(x, y)])
  }
  const ids = moves.map(([id]) => id)
  const method = methodOnScreen(deps)
  const outcome = await deps.session.run(
    deps.caller,
    // A position changes nothing the engine runs: no expression is affected, so it settles at once.
    () => {
      const unchanged = checkAtTurn(deps, method, ids)
      if (!unchanged.ok) return unchanged
      deps.setNodePositions(moves)
      return Ok()
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  return settledResult(
    { moved: ids.map((id) => ({ id, position: storedPosition(deps, id) })) },
    outcome.value,
  )
}

function isCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MOVE_COORDINATE_LIMIT
}

/** The node's position as the graph has it now, rounded; null when it is gone or unplaced. */
function storedPosition(deps: Pick<LayoutToolDeps, 'db'>, id: NodeId): ScenePoint | null {
  const node = deps.db.nodeIdToNode.get(id)
  return (node != null ? scenePoint(node.position) : undefined) ?? null
}
