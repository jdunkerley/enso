/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import type { McpToolResult } from 'enso-common/src/mcp'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import {
  ALREADY_AT_TOP_ERROR,
  clearArea,
  EMPTY_METHOD_ERROR,
  GRAPH_IMAGE_MARGIN,
  GRAPH_IMAGE_NODES_MAX,
  graphImageFrame,
  NO_NODE_IDS_ERROR,
  NOT_ENTERABLE_ERROR,
  OPEN_METHOD_WAIT_MS,
  openMethod,
  prepareGraphImage,
  selectNodes,
  type GraphImageDeps,
  type ViewToolDeps,
} from '../viewTools'

const CODE = `main =
    a = 1 + 2
    b = a * 2
    b`

function makeDeps(overrides: Partial<ViewToolDeps> = {}) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = Ast.findModuleMethod(root, 'main')?.statement
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  let selected = new Set<NodeId>()
  let method = 'main'
  const log: string[] = []
  const deps: ViewToolDeps = {
    db,
    select: vi.fn((ids: readonly NodeId[]) => {
      selected = new Set(ids)
      log.push(`select:${ids.length}`)
    }),
    selected: () => selected,
    nodeCanBeEntered: vi.fn(() => true),
    enterNode: vi.fn(() => {
      log.push('enter')
      method = 'func1'
    }),
    canLeave: vi.fn(() => true),
    leaveMethod: vi.fn(() => {
      log.push('leave')
      method = 'main'
    }),
    waitForGraph: vi.fn(async () => {
      log.push('wait')
    }),
    currentMethodName: () => method,
    contextChanged: vi.fn(() => log.push('release')),
    ...overrides,
  }
  return { deps, db, log }
}

function nodeNamed(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function valueOf(result: McpToolResult) {
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.error}`)
  return JSON.parse(result.value)
}

function toolError(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

// === select_nodes ===

test('select_nodes selects the nodes once each and answers with the selection', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(await selectNodes(deps, { node_ids: [b, a, b] }))
  expect(deps.select).toHaveBeenCalledWith([b, a])
  expect(result).toEqual({ selected: [b, a] })
})

test('select_nodes with an empty list clears the selection', async () => {
  const { deps, db } = makeDeps()
  await selectNodes(deps, { node_ids: [nodeNamed(db, 'a')] })
  const result = valueOf(await selectNodes(deps, { node_ids: [] }))
  expect(deps.select).toHaveBeenLastCalledWith([])
  expect(result).toEqual({ selected: [] })
})

test('select_nodes with an unknown id changes nothing', async () => {
  const { deps, db } = makeDeps()
  const result = await selectNodes(deps, { node_ids: [nodeNamed(db, 'a'), 'nope'] })
  expect(toolError(result)).toBe(
    'No node with id nope in the method on screen. Call get_graph for the current ids.',
  )
  expect(deps.select).not.toHaveBeenCalled()
})

// === open_method ===

test('open_method enters the node, releases the edit step, waits for the graph and answers with the method', async () => {
  const { deps, db, log } = makeDeps()
  const b = nodeNamed(db, 'b')
  const result = valueOf(await openMethod(deps, { node_id: b }))
  expect(deps.enterNode).toHaveBeenCalledWith(b)
  expect(deps.waitForGraph).toHaveBeenCalledWith(OPEN_METHOD_WAIT_MS)
  expect(log).toEqual(['enter', 'release', 'wait'])
  expect(result).toEqual({ method: 'func1' })
})

test('open_method refuses a node that cannot be entered', async () => {
  const { deps, db } = makeDeps({ nodeCanBeEntered: vi.fn(() => false) })
  const result = await openMethod(deps, { node_id: nodeNamed(db, 'a') })
  expect(toolError(result)).toBe(NOT_ENTERABLE_ERROR)
  expect(NOT_ENTERABLE_ERROR).toBe('That node is not a component defined in this project.')
  expect(deps.enterNode).not.toHaveBeenCalled()
  expect(deps.contextChanged).not.toHaveBeenCalled()
})

test('open_method refuses an unknown node', async () => {
  const { deps } = makeDeps()
  const result = await openMethod(deps, { node_id: 'nope' })
  expect(toolError(result)).toContain('No node with id nope')
  expect(deps.enterNode).not.toHaveBeenCalled()
})

test('open_method without a node leaves the method', async () => {
  const { deps, log } = makeDeps({ currentMethodName: () => 'main' })
  const result = valueOf(await openMethod(deps, {}))
  expect(log).toEqual(['leave', 'release', 'wait'])
  expect(result).toEqual({ method: 'main' })
})

test('open_method without a node at the top level is refused', async () => {
  const { deps } = makeDeps({ canLeave: vi.fn(() => false) })
  const result = await openMethod(deps, {})
  expect(toolError(result)).toBe(ALREADY_AT_TOP_ERROR)
  expect(ALREADY_AT_TOP_ERROR).toBe('Already at the top level.')
  expect(deps.leaveMethod).not.toHaveBeenCalled()
  expect(deps.contextChanged).not.toHaveBeenCalled()
})

test('open_method answers an error when the graph shows no method afterwards', async () => {
  const { deps, db } = makeDeps({ currentMethodName: () => undefined })
  const result = await openMethod(deps, { node_id: nodeNamed(db, 'b') })
  expect(toolError(result)).toBe('The graph editor shows no method now. Call get_graph.')
})

// === prepare_graph_image ===

test('the clear area is the viewport less the overlays along its edges', () => {
  const view = { left: 0, top: 0, right: 1000, bottom: 800 }
  expect(clearArea(view, {})).toEqual(view)
  expect(
    clearArea(view, {
      // The top bar, inset from the sides.
      top: [{ left: 13, top: 17, right: 987, bottom: 49 }],
      // The dock's buttons at the bottom left, and the horizontal scroll bar.
      bottom: [
        { left: 12, top: 750, right: 80, bottom: 788 },
        { left: 0, top: 793, right: 1000, bottom: 799 },
      ],
      right: [{ left: 992, top: 0, right: 998, bottom: 800 }],
    }),
  ).toEqual({ left: 0, top: 49, right: 992, bottom: 750 })
  // An overlay outside the viewport, or not laid out (an empty box), takes nothing.
  expect(
    clearArea(view, {
      top: [{ left: 0, top: 0, right: 0, bottom: 0 }],
      bottom: [{ left: 0, top: 900, right: 100, bottom: 950 }],
    }),
  ).toEqual(view)
})

test('the frame is the nodes with a margin of 40, centred in the clear area, at a scale in [0.1, 1]', () => {
  expect(GRAPH_IMAGE_MARGIN).toBe(40)
  const areas = [Rect.XYWH(0, 0, 100, 50), Rect.XYWH(300, 200, 100, 50)]
  const nodes = Rect.XYWH(-40, -40, 480, 330)
  // A top bar 100 high: the clear area is 1000 x 700, where 480 x 330 fits at 2, capped at 1.
  // Its centre is 50 below the viewport's, so the view is framed 50 higher.
  expect(
    graphImageFrame(
      areas,
      { left: 0, top: 0, right: 1000, bottom: 800 },
      { left: 0, top: 100, right: 1000, bottom: 800 },
    ),
  ).toEqual({ nodes, frame: nodes.offsetBy(new Vec2(0, -50)), scale: 1 })
  // A 240 x 330 clear area: the width decides, 240 / 480; the 50-pixel offset is 100 units.
  expect(
    graphImageFrame(
      areas,
      { left: 0, top: 0, right: 240, bottom: 430 },
      { left: 0, top: 100, right: 240, bottom: 430 },
    ),
  ).toEqual({ nodes, frame: nodes.offsetBy(new Vec2(0, -100)), scale: 0.5 })
  // A huge graph never goes below 10%.
  const view = { left: 0, top: 0, right: 1000, bottom: 800 }
  expect(graphImageFrame([Rect.XYWH(0, 0, 100_000, 10)], view, view)?.scale).toBe(0.1)
  expect(graphImageFrame([], view, view)).toBeUndefined()
})

/** The graph viewport, in client pixels: 1000 x 800. */
const VIEW = { left: 10, top: 20, right: 1010, bottom: 820 }
/** The part of it clear of the top bar (to 70) and the dock's buttons (from 800). */
const CLEAR = { left: 10, top: 70, right: 1010, bottom: 800 }

/**
 * Deps over a fake navigator: `frame` centres the rectangle in the viewport at the scale, as
 * `panAndZoomTo` does, and the view then moves for three frames. Only `a` and `b` are drawn,
 * unless `areas` is given.
 */
function imageDeps(
  overrides: Partial<GraphImageDeps> = {},
  drawn?: (db: GraphDb) => Map<NodeId, Rect>,
) {
  const { db } = makeDeps()
  let scale = 0.7
  let viewport = Rect.XYWH(0, 0, 1000 / scale, 800 / scale)
  let moving = 0
  const log: string[] = []
  const areas =
    drawn?.(db) ??
    new Map([
      [nodeNamed(db, 'a'), Rect.XYWH(200, 0, 100, 40)],
      [nodeNamed(db, 'b'), Rect.XYWH(500, 0, 100, 40)],
    ])
  const deps: GraphImageDeps = {
    db,
    area: (id) => areas.get(id),
    viewRect: () => VIEW,
    clearRect: () => CLEAR,
    viewport: () => viewport,
    scale: () => scale,
    frame: vi.fn((rect: Rect, to: number) => {
      log.push('frame')
      scale = to
      viewport = Rect.FromCenterSize(rect.center(), new Vec2(1000 / to, 800 / to))
      moving = 3
    }),
    viewMoving: () => moving > 0,
    nextFrame: vi.fn(async () => {
      log.push(moving > 0 ? 'moving' : 'frame-still')
      if (moving > 0) moving--
    }),
    now: () => 0,
    deadline: 60_000,
    ...overrides,
  }
  return { deps, db, areas, log }
}

test('prepare_graph_image frames the nodes in the clear area, waits, and answers their rectangle', async () => {
  const { deps, log } = imageDeps()
  const result = valueOf(await prepareGraphImage(deps, {}))
  // 160..640 x -40..80 with the margin: 480 x 120 at 100%, centred in the clear area (y 435).
  const nodes = Rect.XYWH(160, -40, 480, 120)
  expect(deps.frame).toHaveBeenCalledExactlyOnceWith(nodes.offsetBy(new Vec2(0, -15)), 1)
  expect(log).toEqual(['frame', 'moving', 'moving', 'moving', 'frame-still', 'frame-still'])
  expect(result).toEqual({ rect: { x: 270, y: 375, width: 480, height: 120 }, scale: 1, nodes: 2 })
})

test('prepare_graph_image cuts nodes too wide for 10% to the clear area', async () => {
  const { deps } = imageDeps(
    {},
    (db) => new Map([[nodeNamed(db, 'a'), Rect.XYWH(0, 0, 20_000, 40)]]),
  )
  const result = valueOf(await prepareGraphImage(deps, {}))
  // 20,080 x 120 at 10%: 2,008 x 12 pixels, centred at y 435 and cut to the clear width.
  expect(result).toEqual({ rect: { x: 10, y: 429, width: 1000, height: 12 }, scale: 0.1, nodes: 1 })
})

test('prepare_graph_image with node_ids frames only those', async () => {
  const { deps, db, areas } = imageDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await prepareGraphImage(deps, { node_ids: [a, a] }))
  const nodes = areas.get(a)!.expand(GRAPH_IMAGE_MARGIN)
  expect(deps.frame).toHaveBeenCalledExactlyOnceWith(nodes.offsetBy(new Vec2(0, -15)), 1)
  expect(result.nodes).toBe(1)
  expect(result.rect).toEqual({ x: 420, y: 375, width: 180, height: 120 })
})

test('prepare_graph_image refuses an empty node_ids, an unknown node, or too many, and moves nothing', async () => {
  expect(GRAPH_IMAGE_NODES_MAX).toBe(500)
  const { deps, db } = imageDeps()
  expect(toolError(await prepareGraphImage(deps, { node_ids: [] }))).toBe(NO_NODE_IDS_ERROR)
  expect(
    toolError(await prepareGraphImage(deps, { node_ids: [nodeNamed(db, 'a'), 'nope'] })),
  ).toContain('No node with id nope')
  const many = Array.from({ length: 501 }, () => nodeNamed(db, 'a'))
  expect(toolError(await prepareGraphImage(deps, { node_ids: many }))).toContain('500')
  expect(deps.frame).not.toHaveBeenCalled()
})

test('prepare_graph_image of a method without nodes says so', async () => {
  const { deps } = imageDeps({ db: GraphDb.Mock() })
  expect(toolError(await prepareGraphImage(deps, {}))).toBe(EMPTY_METHOD_ERROR)
  expect(deps.frame).not.toHaveBeenCalled()
})

test('prepare_graph_image of nodes not drawn yet says so', async () => {
  const { deps } = imageDeps({ area: () => undefined })
  expect(toolError(await prepareGraphImage(deps, {}))).toContain('not drawn')
  expect(deps.frame).not.toHaveBeenCalled()
})

test('prepare_graph_image gives up before the deadline when the view never stops', async () => {
  let time = 0
  const { deps } = imageDeps({
    viewMoving: () => true,
    nextFrame: async () => {
      time += 16
    },
    now: () => time,
    deadline: 10_000,
  })
  expect((await prepareGraphImage(deps, {})).ok).toBe(false)
  expect(time).toBeLessThan(10_000)
})
