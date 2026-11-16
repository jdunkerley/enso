/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Rect } from '@/util/data/rect'
import type { McpToolResult } from 'enso-common/src/mcp'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import {
  ALREADY_AT_TOP_ERROR,
  EMPTY_METHOD_ERROR,
  GRAPH_IMAGE_MARGIN,
  GRAPH_IMAGE_NODES_MAX,
  graphImageFrame,
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

test('the frame is the bounding area of the nodes with a margin of 40, at a scale in [0.1, 1]', () => {
  expect(GRAPH_IMAGE_MARGIN).toBe(40)
  const areas = [Rect.XYWH(0, 0, 100, 50), Rect.XYWH(300, 200, 100, 50)]
  // 400 x 250 with the margin is 480 x 330: fits a 960 x 990 viewport at 2, capped at 1.
  expect(graphImageFrame(areas, { width: 960, height: 990 })).toEqual({
    rect: Rect.XYWH(-40, -40, 480, 330),
    scale: 1,
  })
  // A 240 x 330 viewport: the width decides, 240 / 480.
  expect(graphImageFrame(areas, { width: 240, height: 330 })?.scale).toBe(0.5)
  // A huge graph never goes below 10%.
  expect(graphImageFrame([Rect.XYWH(0, 0, 100_000, 10)], { width: 1000, height: 800 })?.scale).toBe(
    0.1,
  )
  expect(graphImageFrame([], { width: 1000, height: 800 })).toBeUndefined()
})

const VIEW = { left: 10, top: 20, right: 1010.4, bottom: 820 }

function imageDeps(overrides: Partial<GraphImageDeps> = {}) {
  const { db } = makeDeps()
  let scale = 0.7
  let moving = 0
  const log: string[] = []
  const areas = new Map<NodeId, Rect>()
  let x = 0
  for (const id of db.nodeIdToNode.keys()) areas.set(id, Rect.XYWH((x += 200), 0, 100, 40))
  const deps: GraphImageDeps = {
    db,
    area: (id) => areas.get(id),
    viewRect: () => VIEW,
    scale: () => scale,
    frame: vi.fn((rect: Rect, to: number) => {
      log.push('frame')
      scale = to
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

test('prepare_graph_image frames every node, waits for the view to stop and two frames, then answers', async () => {
  const { deps, db, areas, log } = imageDeps()
  const result = valueOf(await prepareGraphImage(deps, {}))
  const bounds = Rect.Bounding(...areas.values())!.expand(GRAPH_IMAGE_MARGIN)
  expect(deps.frame).toHaveBeenCalledExactlyOnceWith(bounds, 1)
  expect(log).toEqual(['frame', 'moving', 'moving', 'moving', 'frame-still', 'frame-still'])
  expect(result).toEqual({
    rect: { x: 10, y: 20, width: 1000, height: 800 },
    scale: 1,
    nodes: db.nodeIdToNode.size,
  })
})

test('prepare_graph_image with node_ids frames only those', async () => {
  const { deps, db, areas } = imageDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await prepareGraphImage(deps, { node_ids: [a, a] }))
  expect(deps.frame).toHaveBeenCalledExactlyOnceWith(areas.get(a)!.expand(GRAPH_IMAGE_MARGIN), 1)
  expect(result.nodes).toBe(1)
})

test('prepare_graph_image refuses an unknown node, or too many, and moves nothing', async () => {
  expect(GRAPH_IMAGE_NODES_MAX).toBe(500)
  const { deps, db } = imageDeps()
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
