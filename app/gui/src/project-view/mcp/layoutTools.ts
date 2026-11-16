/**
 * @file The layout MCP tools: `move_nodes` and `arrange_nodes`. Pure functions over their deps. A
 * position is module metadata, so each runs through the edit session like every edit (refused in
 * Live, part of the caller's undo step), and, changing nothing the engine computes, settles at
 * once. Each makes one `setNodePositions` call: `move_nodes` itself, `arrange_nodes` through the
 * editor's own Tidy up, Align or Spacing, which each end in one.
 */
/* eslint-disable camelcase -- argument names are snake_case on the wire */
import type { NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { createSelectionAlignmentHandlers } from '@/components/GraphEditor/selectionAlignment'
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

/** What `move_nodes` needs: the graph on screen, the edit session and the store's mover. */
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

/** The editor's Align and Spacing handlers, each taking the nodes to lay out. */
export type AlignmentHandlers = ReturnType<typeof createSelectionAlignmentHandlers>

/** What `arrange_nodes` runs: the user's own Tidy up, Align and Spacing commands. */
export interface ArrangeToolDeps extends LayoutToolDeps {
  /**
   * Tidy up (`useGraphTidy(graph).tidy`): the given nodes when two or more, else the whole graph.
   * Ends in one `setNodePositions` call (none when there is nothing to lay out).
   */
  readonly tidy: (ids: readonly NodeId[] | undefined) => void
  /**
   * `createSelectionAlignmentHandlers(graph)`, called directly: not through the menu's action,
   * which checks the panel's focus. Each ends in one `setNodePositions` call.
   */
  readonly alignment: AlignmentHandlers
}

/** The `arrange_nodes` actions: Tidy up, then the Align and Spacing menus' commands. */
export const ARRANGE_ACTIONS = [
  'tidy',
  'align_left',
  'align_right',
  'align_center',
  'align_top',
  'align_bottom',
  'space',
  'space_tight',
  'space_wide',
  'space_none',
] as const

/** One of {@link ARRANGE_ACTIONS}. */
export type ArrangeAction = (typeof ARRANGE_ACTIONS)[number]

/** Most `node_ids` one `arrange_nodes` call takes. */
export const ARRANGE_NODES_MAX = 500

/** The handler of each Align and Spacing action (Spacing's default, tight, wide and zero). */
const ALIGNMENT_HANDLER: Record<Exclude<ArrangeAction, 'tidy'>, keyof AlignmentHandlers> = {
  align_left: 'alignLeftNodes',
  align_right: 'alignRightNodes',
  align_center: 'alignCenterNodes',
  align_top: 'alignTopNodes',
  align_bottom: 'alignBottomNodes',
  space: 'spaceVerticalNodes',
  space_tight: 'spaceVerticalNodesTight',
  space_wide: 'spaceVerticalNodesWide',
  space_none: 'spaceVerticalNodesZero',
}

function isArrangeAction(action: string): action is ArrangeAction {
  return (ARRANGE_ACTIONS as readonly string[]).includes(action)
}

/**
 * Runs one of the user's layout commands in one edit: `tidy` lays out the nodes of `node_ids` when
 * there are two or more, else the whole graph; the Align and Spacing actions lay out the nodes of
 * `node_ids`, of which they need at least two. Refused, before anything moves, for an unknown
 * action, more than {@link ARRANGE_NODES_MAX} ids, an unknown or repeated node, or too few nodes;
 * and at its turn when the method on screen changed or a node is gone ({@link checkAtTurn}).
 * Neither the view nor the selection changes. Answers `{ action, arranged, settled: true }`,
 * `arranged` counting the nodes of the method whose position changed (0 when already laid out).
 */
export async function arrangeNodes(
  deps: ArrangeToolDeps,
  args: { action: string; node_ids?: readonly string[] },
): Promise<McpToolResult> {
  const { action } = args
  if (!isArrangeAction(action)) {
    return toolError(`Unknown action \`${action}\`. Use one of: ${ARRANGE_ACTIONS.join(', ')}.`)
  }
  const nodeIds = args.node_ids ?? []
  if (nodeIds.length > ARRANGE_NODES_MAX) {
    return toolError(`Pass at most ${ARRANGE_NODES_MAX} node ids.`)
  }
  const ids: NodeId[] = []
  for (const nodeId of nodeIds) {
    const found = findNode(deps.db, nodeId)
    if (!found.ok) return found
    if (ids.includes(found.value.id)) {
      return toolError(`Node ${nodeId} is given twice in \`node_ids\`. Give each node once.`)
    }
    ids.push(found.value.id)
  }
  if (action !== 'tidy' && ids.length < 2) {
    return toolError(`\`${action}\` needs at least two nodes in \`node_ids\`.`)
  }
  const method = methodOnScreen(deps)
  let before = new Map<NodeId, Vec2>()
  const outcome = await deps.session.run(
    deps.caller,
    // Positions change nothing the engine runs: no expression is affected, so it settles at once.
    () => {
      const unchanged = checkAtTurn(deps, method, ids)
      if (!unchanged.ok) return unchanged
      before = positions(deps)
      if (action === 'tidy') {
        deps.tidy(ids.length >= 2 ? ids : undefined)
      } else {
        const nodes = ids.map((id) => deps.db.nodeIdToNode.get(id)).filter((n) => n != null)
        deps.alignment[ALIGNMENT_HANDLER[action]](nodes)
      }
      return Ok()
    },
    { deadline: deps.deadline },
  )
  if (!outcome.ok) return errorResult(outcome)
  const after = positions(deps)
  let arranged = 0
  for (const [id, position] of before) {
    const now = after.get(id)
    if (now != null && !now.equals(position)) arranged += 1
  }
  return settledResult({ action, arranged }, outcome.value)
}

/** The position of every node of the method on screen. */
function positions(deps: Pick<LayoutToolDeps, 'db'>): Map<NodeId, Vec2> {
  return new Map(Array.from(deps.db.nodeIdToNode.entries(), ([id, node]) => [id, node.position]))
}
