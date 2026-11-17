/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { Vec2 } from '@/util/data/vec2'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import { EditSession, LIVE_EDIT_ERROR, type EditOutcome, type EditRunOptions } from '../editSession'
import { METHOD_CHANGED_ERROR } from '../editTools'
import {
  ARRANGE_ACTIONS,
  ARRANGE_NODES_MAX,
  MOVE_COORDINATE_LIMIT,
  MOVE_NODES_MAX,
  arrangeNodes,
  moveNodes,
  type AlignmentHandlers,
  type ArrangeToolDeps,
  type LayoutToolDeps,
} from '../layoutTools'
import type { AffectedExpressions } from '../projectEvents'

const CODE = `main =
    a = 1 + 2
    b = a * 2
    c = b + 1
    c`

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}
const otherPointer: MethodPointer = { ...pointer, name: 'other' as Identifier }

const caller = { kind: 'external', name: 'claude-code' } as const
const DEADLINE = 123_456

/**
 * A session that runs each edit at once, after `before`, and records what the tool passed it:
 * the affected expressions, the deadline and what `unchanged` said of each successful run.
 */
function fakeSession(before: () => void = () => {}) {
  const affected: AffectedExpressions[] = []
  const deadlines: (number | undefined)[] = []
  const unchanged: (boolean | undefined)[] = []
  return {
    affected,
    deadlines,
    unchanged,
    async run<T>(
      _caller: unknown,
      edit: () => Result<T> | Promise<Result<T>>,
      options?: EditRunOptions<T>,
    ) {
      before()
      deadlines.push(options?.deadline)
      const result = await edit()
      if (!result.ok) return result
      affected.push(options?.affected?.(result.value) ?? {})
      unchanged.push(options?.unchanged?.(result.value))
      return Ok<EditOutcome<T>>({ value: result.value, settled: true })
    },
  }
}

/** Fake Align and Spacing handlers, each recording the nodes it was given and moving nothing. */
function fakeAlignment(): AlignmentHandlers {
  return {
    alignLeftNodes: vi.fn(),
    alignCenterNodes: vi.fn(),
    alignRightNodes: vi.fn(),
    alignTopNodes: vi.fn(),
    alignBottomNodes: vi.fn(),
    spaceVerticalNodes: vi.fn(),
    spaceVerticalNodesTight: vi.fn(),
    spaceVerticalNodesZero: vi.fn(),
    spaceVerticalNodesWide: vi.fn(),
  }
}

function makeDeps(overrides: Partial<ArrangeToolDeps> = {}) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  let x = 0
  for (const node of db.nodeIdToNode.values()) node.position = new Vec2((x += 100), 0)
  const session = fakeSession()
  // As the graph store does: every position given is stored at once.
  const setNodePositions = vi.fn<LayoutToolDeps['setNodePositions']>((moves) => {
    for (const [id, position] of moves) db.nodeIdToNode.get(id)!.position = position
  })
  const tidy = vi.fn<ArrangeToolDeps['tidy']>()
  const alignment = fakeAlignment()
  // Stands for the module's document: a change of any node's position is a change of the module.
  const moduleChanged = vi.fn<LayoutToolDeps['moduleChanged']>((f) => {
    const before = new Map(Array.from(db.nodeIdToNode, ([id, node]) => [id, node.position]))
    f()
    return Array.from(db.nodeIdToNode).some(([id, node]) => !before.get(id)?.equals(node.position))
  })
  const deps: ArrangeToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    session,
    caller,
    deadline: DEADLINE,
    setNodePositions,
    moduleChanged,
    tidy,
    alignment,
    ...overrides,
  }
  return { deps, db, session, setNodePositions, moduleChanged, tidy, alignment }
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

function errorOf(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

// === move_nodes ===

test('move_nodes moves every node in one call and answers with the positions as stored', async () => {
  const { deps, db, setNodePositions } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(
    await moveNodes(deps, {
      moves: [
        { node_id: a, x: 10.4, y: -20 },
        { node_id: b, x: 300, y: 400.6 },
      ],
    }),
  )
  expect(setNodePositions).toHaveBeenCalledExactlyOnceWith([
    [a, new Vec2(10.4, -20)],
    [b, new Vec2(300, 400.6)],
  ])
  expect(result).toEqual({
    moved: [
      { id: a, position: { x: 10, y: -20 } },
      { id: b, position: { x: 300, y: 401 } },
    ],
    settled: true,
  })
})

test('move_nodes reads the positions back after the edit', async () => {
  const { deps, db } = makeDeps({
    // The store may place a node elsewhere than asked (normalising it): the answer says where.
    setNodePositions: (moves) => {
      for (const [id] of moves) db.nodeIdToNode.get(id)!.position = new Vec2(7, 8)
    },
  })
  const a = nodeNamed(db, 'a')
  const result = valueOf(await moveNodes(deps, { moves: [{ node_id: a, x: 1, y: 2 }] }))
  expect(result.moved).toEqual([{ id: a, position: { x: 7, y: 8 } }])
})

test('move_nodes affects no expression, and passes the call deadline to the session', async () => {
  const { deps, db, session } = makeDeps()
  await moveNodes(deps, { moves: [{ node_id: nodeNamed(db, 'a'), x: 1, y: 2 }] })
  expect(session.affected).toEqual([{}])
  expect(session.deadlines).toEqual([DEADLINE])
})

test('move_nodes tells the session whether the module changed', async () => {
  const { deps, db, session, setNodePositions, moduleChanged } = makeDeps()
  const a = nodeNamed(db, 'a')
  const { x, y } = db.nodeIdToNode.get(a)!.position
  const result = valueOf(await moveNodes(deps, { moves: [{ node_id: a, x, y }] }))
  expect(result.moved).toEqual([{ id: a, position: { x, y } }])
  // The store is still asked: it also releases the nodes this one was pushing.
  expect(setNodePositions).toHaveBeenCalledOnce()
  expect(moduleChanged).toHaveBeenCalledOnce()
  await moveNodes(deps, { moves: [{ node_id: a, x: x + 1, y }] })
  expect(session.unchanged).toEqual([true, false])
})

test('move_nodes refuses an unknown node, and moves nothing', async () => {
  const { deps, db, setNodePositions } = makeDeps()
  const error = errorOf(
    await moveNodes(deps, {
      moves: [
        { node_id: nodeNamed(db, 'a'), x: 1, y: 2 },
        { node_id: 'nope', x: 1, y: 2 },
      ],
    }),
  )
  expect(error).toContain('No node with id nope')
  expect(setNodePositions).not.toHaveBeenCalled()
})

test('move_nodes refuses the same node twice, and moves nothing', async () => {
  const { deps, db, setNodePositions } = makeDeps()
  const a = nodeNamed(db, 'a')
  const error = errorOf(
    await moveNodes(deps, {
      moves: [
        { node_id: a, x: 1, y: 2 },
        { node_id: a, x: 3, y: 4 },
      ],
    }),
  )
  expect(error).toContain(a)
  expect(error).toContain('twice')
  expect(setNodePositions).not.toHaveBeenCalled()
})

test('move_nodes takes 1 to 200 moves', async () => {
  expect(MOVE_NODES_MAX).toBe(200)
  const { deps, db, setNodePositions } = makeDeps()
  expect(errorOf(await moveNodes(deps, { moves: [] }))).toContain('1 to 200')
  const a = nodeNamed(db, 'a')
  const many = Array.from({ length: 201 }, () => ({ node_id: a, x: 0, y: 0 }))
  expect(errorOf(await moveNodes(deps, { moves: many }))).toContain('1 to 200')
  expect(setNodePositions).not.toHaveBeenCalled()
})

test('move_nodes refuses a coordinate that is not finite or beyond ±1,000,000', async () => {
  expect(MOVE_COORDINATE_LIMIT).toBe(1_000_000)
  const { deps, db, setNodePositions } = makeDeps()
  const a = nodeNamed(db, 'a')
  for (const [x, y] of [
    [Infinity, 0],
    [0, NaN],
    [1_000_001, 0],
    [0, -1_000_001],
  ] as const) {
    expect(errorOf(await moveNodes(deps, { moves: [{ node_id: a, x, y }] }))).toContain('1,000,000')
  }
  const edge = await moveNodes(deps, { moves: [{ node_id: a, x: -1_000_000, y: 1_000_000 }] })
  expect(edge.ok).toBe(true)
  expect(setNodePositions).toHaveBeenCalledOnce()
})

test('move_nodes in Live mode is refused by the session, and nothing moves', async () => {
  const session = new EditSession({
    isLive: () => true,
    isActive: () => true,
    holdUndoStep: () => () => {},
    onForeignEdit: () => () => {},
    historyDepth: () => ({ undo: 0, redo: 0 }),
    undo: () => {},
    redo: () => {},
    saveVersion: async () => {},
    watchGraphUpdate: () => ({ updated: async () => true, cancel: () => {} }),
    watchExecution: () => ({ settled: async () => true, cancel: () => {} }),
    now: () => 0,
    setTimeout: () => undefined,
    clearTimeout: () => {},
  })
  const { deps, db, setNodePositions } = makeDeps({ session })
  const result = await moveNodes(deps, { moves: [{ node_id: nodeNamed(db, 'a'), x: 1, y: 2 }] })
  expect(errorOf(result)).toBe(LIVE_EDIT_ERROR)
  expect(setNodePositions).not.toHaveBeenCalled()
})

test('move_nodes refuses, at its turn, a changed method or a removed node', async () => {
  const before = vi.fn(() => {})
  const { deps, db, setNodePositions } = makeDeps({ session: fakeSession(() => before()) })
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')

  before.mockImplementationOnce(() => {
    deps.currentMethod.pointer = Ok(otherPointer)
  })
  const changed = await moveNodes(deps, { moves: [{ node_id: a, x: 1, y: 2 }] })
  expect(errorOf(changed)).toBe(METHOD_CHANGED_ERROR)
  deps.currentMethod.pointer = Ok(pointer)

  before.mockImplementationOnce(() => {
    db.nodeIdToNode.delete(b)
  })
  const removed = await moveNodes(deps, {
    moves: [
      { node_id: a, x: 1, y: 2 },
      { node_id: b, x: 1, y: 2 },
    ],
  })
  expect(errorOf(removed)).toContain(`No node with id ${b}`)
  expect(setNodePositions).not.toHaveBeenCalled()
})

// === arrange_nodes ===

test('arrange_nodes offers the menu commands', () => {
  expect(ARRANGE_ACTIONS).toEqual([
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
  ])
  expect(ARRANGE_NODES_MAX).toBe(500)
})

test('tidy lays out the whole graph without node_ids or with fewer than two', async () => {
  const { deps, db, tidy } = makeDeps()
  const a = nodeNamed(db, 'a')
  for (const args of [{}, { node_ids: [a] }]) {
    tidy.mockClear()
    const result = valueOf(await arrangeNodes(deps, { action: 'tidy', ...args }))
    expect(tidy).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(result).toEqual({ action: 'tidy', arranged: 0, settled: true })
  }
})

test('tidy with two or more node_ids lays out only those', async () => {
  const { deps, db, tidy } = makeDeps()
  const ids = [nodeNamed(db, 'b'), nodeNamed(db, 'a')]
  await arrangeNodes(deps, { action: 'tidy', node_ids: ids })
  expect(tidy).toHaveBeenCalledExactlyOnceWith(ids)
})

test.each([
  ['align_left', 'alignLeftNodes'],
  ['align_right', 'alignRightNodes'],
  ['align_center', 'alignCenterNodes'],
  ['align_top', 'alignTopNodes'],
  ['align_bottom', 'alignBottomNodes'],
  ['space', 'spaceVerticalNodes'],
  ['space_tight', 'spaceVerticalNodesTight'],
  ['space_wide', 'spaceVerticalNodesWide'],
  ['space_none', 'spaceVerticalNodesZero'],
] as const)('%s runs %s with the nodes of node_ids, and nothing else', async (action, handler) => {
  const { deps, db, alignment, tidy } = makeDeps()
  const ids = [nodeNamed(db, 'c'), nodeNamed(db, 'a')]
  const result = valueOf(await arrangeNodes(deps, { action, node_ids: ids }))
  expect(result).toEqual({ action, arranged: 0, settled: true })
  expect(alignment[handler]).toHaveBeenCalledExactlyOnceWith(
    ids.map((id) => db.nodeIdToNode.get(id)),
  )
  for (const [name, other] of Object.entries(alignment)) {
    if (name !== handler) expect(other, name).not.toHaveBeenCalled()
  }
  expect(tidy).not.toHaveBeenCalled()
})

test('align and space need at least two node_ids', async () => {
  const { deps, db, alignment } = makeDeps()
  const a = nodeNamed(db, 'a')
  for (const action of ARRANGE_ACTIONS.filter((action) => action !== 'tidy')) {
    for (const args of [{}, { node_ids: [a] }]) {
      expect(errorOf(await arrangeNodes(deps, { action, ...args })), action).toContain(
        'at least two',
      )
    }
  }
  for (const handler of Object.values(alignment)) expect(handler).not.toHaveBeenCalled()
})

test('arrange_nodes counts the nodes whose position changed', async () => {
  const fixture: { db?: GraphDb } = {}
  const { deps, db } = makeDeps({
    // As the store does: the handler moves the nodes it lays out, in one call.
    tidy: () => {
      const nodes = [...fixture.db!.nodeIdToNode.values()]
      nodes[0]!.position = new Vec2(-5, -5)
      nodes[1]!.position = new Vec2(-6, -6)
      // The same position again is not a change.
      nodes[2]!.position = new Vec2(nodes[2]!.position.x, nodes[2]!.position.y)
    },
  })
  fixture.db = db
  const result = valueOf(await arrangeNodes(deps, { action: 'tidy' }))
  expect(result).toEqual({ action: 'tidy', arranged: 2, settled: true })
})

test('arrange_nodes does not count a move made after its edit, while the session waits', async () => {
  const fixture: { db?: GraphDb } = {}
  const inner = fakeSession()
  const { deps, db } = makeDeps({
    tidy: () => {
      fixture.db!.nodeIdToNode.get(nodeNamed(fixture.db!, 'a'))!.position = new Vec2(-5, -5)
    },
    session: {
      // The edit runs, then someone else moves another node before the session answers.
      async run(caller, edit, options) {
        const outcome = await inner.run(caller, edit, options)
        fixture.db!.nodeIdToNode.get(nodeNamed(fixture.db!, 'b'))!.position = new Vec2(-9, -9)
        return outcome
      },
    },
  })
  fixture.db = db
  const result = valueOf(await arrangeNodes(deps, { action: 'tidy' }))
  expect(result).toEqual({ action: 'tidy', arranged: 1, settled: true })
})

test('arrange_nodes tells the session whether the module changed', async () => {
  const fixture: { db?: GraphDb } = {}
  const { deps, db, session } = makeDeps({
    tidy: (ids) => {
      if (ids == null) return
      fixture.db!.nodeIdToNode.get(ids[0]!)!.position = new Vec2(-5, -5)
    },
  })
  fixture.db = db
  // Already tidy: the whole graph, which the fake leaves as it is.
  expect(valueOf(await arrangeNodes(deps, { action: 'tidy' })).arranged).toBe(0)
  await arrangeNodes(deps, { action: 'tidy', node_ids: [nodeNamed(db, 'a'), nodeNamed(db, 'b')] })
  expect(session.unchanged).toEqual([true, false])
})

test('arrange_nodes refuses an unknown or repeated node, and arranges nothing', async () => {
  const { deps, db, tidy, alignment } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  expect(
    errorOf(await arrangeNodes(deps, { action: 'align_left', node_ids: [a, 'nope'] })),
  ).toContain('No node with id nope')
  const twice = errorOf(await arrangeNodes(deps, { action: 'tidy', node_ids: [a, b, a] }))
  expect(twice).toContain(a)
  expect(twice).toContain('twice')
  expect(tidy).not.toHaveBeenCalled()
  expect(alignment.alignLeftNodes).not.toHaveBeenCalled()
})

test('arrange_nodes takes at most 500 node_ids', async () => {
  const { deps, tidy } = makeDeps()
  const many = Array.from({ length: 501 }, (_, i) => `node-${i}`)
  expect(errorOf(await arrangeNodes(deps, { action: 'tidy', node_ids: many }))).toContain('500')
  expect(tidy).not.toHaveBeenCalled()
})

test('arrange_nodes refuses an action it does not know', async () => {
  const { deps } = makeDeps()
  expect(errorOf(await arrangeNodes(deps, { action: 'shuffle' }))).toContain('tidy')
})

test('arrange_nodes affects no expression, and passes the call deadline to the session', async () => {
  const { deps, session } = makeDeps()
  await arrangeNodes(deps, { action: 'tidy' })
  expect(session.affected).toEqual([{}])
  expect(session.deadlines).toEqual([DEADLINE])
})

test('arrange_nodes in Live mode is refused by the session, and nothing is arranged', async () => {
  const session = new EditSession({
    isLive: () => true,
    isActive: () => true,
    holdUndoStep: () => () => {},
    onForeignEdit: () => () => {},
    historyDepth: () => ({ undo: 0, redo: 0 }),
    undo: () => {},
    redo: () => {},
    saveVersion: async () => {},
    watchGraphUpdate: () => ({ updated: async () => true, cancel: () => {} }),
    watchExecution: () => ({ settled: async () => true, cancel: () => {} }),
    now: () => 0,
    setTimeout: () => undefined,
    clearTimeout: () => {},
  })
  const { deps, tidy } = makeDeps({ session })
  expect(errorOf(await arrangeNodes(deps, { action: 'tidy' }))).toBe(LIVE_EDIT_ERROR)
  expect(tidy).not.toHaveBeenCalled()
})

test('arrange_nodes refuses, at its turn, a changed method or a removed node', async () => {
  const before = vi.fn(() => {})
  const { deps, db, tidy, alignment } = makeDeps({ session: fakeSession(() => before()) })
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')

  before.mockImplementationOnce(() => {
    deps.currentMethod.pointer = Ok(otherPointer)
  })
  expect(errorOf(await arrangeNodes(deps, { action: 'tidy' }))).toBe(METHOD_CHANGED_ERROR)
  deps.currentMethod.pointer = Ok(pointer)

  before.mockImplementationOnce(() => {
    db.nodeIdToNode.delete(b)
  })
  const removed = await arrangeNodes(deps, { action: 'align_left', node_ids: [a, b] })
  expect(errorOf(removed)).toContain(`No node with id ${b}`)
  expect(tidy).not.toHaveBeenCalled()
  expect(alignment.alignLeftNodes).not.toHaveBeenCalled()
})
