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
  MOVE_COORDINATE_LIMIT,
  MOVE_NODES_MAX,
  moveNodes,
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
 * the affected expressions and the deadline of each successful run.
 */
function fakeSession(before: () => void = () => {}) {
  const affected: AffectedExpressions[] = []
  const deadlines: (number | undefined)[] = []
  return {
    affected,
    deadlines,
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
      return Ok<EditOutcome<T>>({ value: result.value, settled: true })
    },
  }
}

function makeDeps(overrides: Partial<LayoutToolDeps> = {}) {
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
  const deps: LayoutToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    session,
    caller,
    deadline: DEADLINE,
    setNodePositions,
    ...overrides,
  }
  return { deps, db, session, setNodePositions }
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
