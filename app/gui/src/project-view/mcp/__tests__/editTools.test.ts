/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { describe, expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { EditSession, LIVE_EDIT_ERROR, type EditOutcome, type EditRunOptions } from '../editSession'
import {
  METHOD_CHANGED_ERROR,
  MISSING_NODES_NOTE,
  UNSETTLED_NOTE,
  addNodes,
  editNode,
  parseNodeExpression,
  parseNodeStatement,
  removeNodes,
  setNodeComment,
  setVisualization,
  writeOnNodeError,
  type EditToolDeps,
} from '../editTools'
import type { AffectedExpressions } from '../projectEvents'
import { WRITE_REFUSED_ERROR } from '../writeGuard'
import {
  ENABLING_EXPRESSIONS,
  ENABLING_IMPORTS,
  HARMLESS_EXPRESSIONS,
  WRITE_PREFIX,
} from './outputEnablingCode'

// === parseNodeStatement ===

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

test('An assignment gives its name and expression', () => {
  expect(parseNodeStatement('a = 1 + 2')).toEqual(Ok({ binding: 'a', expression: '1 + 2' }))
})

test('A bare expression has no name', () => {
  expect(parseNodeStatement('Data.read "x"')).toEqual(
    Ok({ binding: undefined, expression: 'Data.read "x"' }),
  )
})

test('An expression continued on indented lines is one statement', () => {
  const statement = 'a = foo\n    . bar\n    . baz'
  const parsed = parseNodeStatement(statement)
  expect(parsed).toEqual(Ok({ binding: 'a', expression: 'foo\n    . bar\n    . baz' }))
  assert(parsed.ok)
  // The expression is what node creation parses again.
  expect(Ast.parseExpression(parsed.value.expression)?.code()).toBe(parsed.value.expression)
})

test('A function definition is refused', () => {
  expect(errorOf(parseNodeStatement('f x = x + 1'))).toContain('function definition')
})

test('An import is refused, pointing at `imports`', () => {
  expect(errorOf(parseNodeStatement('import Standard.Base'))).toContain('`imports`')
})

test('An assignment without an expression is refused', () => {
  expect(errorOf(parseNodeStatement('a = '))).toContain('no expression')
})

test('Two statements, an empty statement and a syntax error are refused', () => {
  expect(errorOf(parseNodeStatement('a = 1\nb = 2'))).toContain('not one statement')
  expect(errorOf(parseNodeStatement('   '))).toContain('not one statement')
  expect(errorOf(parseNodeStatement('a = foo ('))).toContain('syntax error')
})

test('A pattern on the left is refused, asking for one name', () => {
  expect(errorOf(parseNodeStatement('[a, b] = foo'))).toContain('Bind one name')
  expect(errorOf(parseNodeStatement('Foo = 1'))).toContain('Bind one name')
})

// === The tools ===

const CODE = `main =
    a = 1 + 2
    ## Doubles the sum.
    b = a * 2
    b`

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

const caller = { kind: 'external', name: 'claude-code' } as const
/** The call's deadline, which each tool passes on to the session. */
const DEADLINE = 123_456

/**
 * A session that runs each edit at once and reports `settled`. `affected` lists, per successful
 * run, the expression ids the tool said its edit affects.
 */
function fakeSession(settled = true): Pick<EditSession, 'run'> & {
  affected: AffectedExpressions[]
  deadlines: (number | undefined)[]
} {
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
      deadlines.push(options?.deadline)
      const result = await edit()
      if (!result.ok) return result
      affected.push(options?.affected?.(result.value) ?? {})
      return Ok<EditOutcome<T>>({ value: result.value, settled })
    },
  }
}

function makeDeps(overrides: Partial<EditToolDeps> = {}, code = CODE) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(code)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  const createNodes = vi.fn<EditToolDeps['createNodes']>(async (nodes) =>
    Ok(
      nodes.map((n, i) => {
        const id = asNodeId(crypto.randomUUID() as ExternalId)
        db.mockNode(n.binding ?? `node${i + 1}`, id, n.expression)
        return id
      }),
    ),
  )
  const deps: EditToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    moduleRoot: () => root,
    printType: projectNames.printProjectPath,
    evaluate: vi.fn(async () => Ok('text')),
    session: fakeSession(),
    caller,
    deadline: DEADLINE,
    createNodes,
    setNodeContent: vi.fn(() => Ok()),
    deleteNodes: vi.fn(async () => Ok()),
    setNodeComment: vi.fn(() => Ok()),
    setVisualization: vi.fn(() => Ok()),
    ...overrides,
  }
  return { deps, db, createNodes }
}

function nodeNamed(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function outputNode(db: GraphDb): NodeId {
  const entry = [...db.nodeIdToNode.entries()].find(([, node]) => node.type === 'output')
  assert(entry != null)
  return entry[0]
}

function valueOf(result: McpToolResult) {
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.error}`)
  return JSON.parse(result.value)
}

function toolError(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

test('add_nodes passes the parsed nodes, the anchor and the imports, and answers with the new nodes', async () => {
  const { deps, db, createNodes } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(
    await addNodes(deps, {
      statements: ['c = b + 1', 'c.to_text'],
      after_node: a,
      imports: ['from Standard.Table import all'],
    }),
  )
  expect(createNodes).toHaveBeenCalledWith(
    [
      { binding: 'c', expression: 'b + 1' },
      { binding: undefined, expression: 'c.to_text' },
    ],
    a,
    ['from Standard.Table import all'],
  )
  expect(result.settled).toBe(true)
  expect(result).not.toHaveProperty('note')
  expect(result.nodes.map((n: { name: string; code: string }) => [n.name, n.code])).toEqual([
    ['c', 'b + 1'],
    ['node2', 'c.to_text'],
  ])
  expect(result.nodes.every((n: object) => !('preview' in n))).toBe(true)
})

test('add_nodes with an unknown `after_node` changes nothing', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1'], after_node: 'nope' })
  expect(toolError(result)).toBe(
    'No node with id nope in the method on screen. Call get_graph for the current ids.',
  )
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a name already used in the method', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'a = 2'] })
  expect(toolError(result)).toContain('`a`')
  expect(toolError(result)).toContain('already')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a name taken while the call waited in the queue', async () => {
  const graph: { db?: GraphDb } = {}
  const queued: Pick<EditSession, 'run'> = {
    async run<T>(callerArg: McpCaller, edit: () => Result<T> | Promise<Result<T>>) {
      // An earlier edit in the queue adds a node named `c` before this call's turn.
      graph.db!.mockNode('c', asNodeId(crypto.randomUUID() as ExternalId), '0')
      return fakeSession().run(callerArg, edit)
    },
  }
  const fixture = makeDeps({ session: queued })
  graph.db = fixture.db
  const result = await addNodes(fixture.deps, { statements: ['c = 1'] })
  expect(toolError(result)).toContain('`c`')
  expect(toolError(result)).toContain('already')
  expect(fixture.createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a name bound twice in the call', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'c = 2'] })
  expect(toolError(result)).toContain('`c`')
  expect(toolError(result)).toContain('twice')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses a statement that does not parse, naming it', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1', 'f x = x'] })
  expect(toolError(result)).toContain('Statement 2')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes refuses an import that does not parse', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, { statements: ['c = 1'], imports: ['Standard.Table'] })
  expect(toolError(result)).toContain('Not an import line: `Standard.Table`')
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes reports an error from creating the nodes', async () => {
  const { deps } = makeDeps({ createNodes: vi.fn(async () => Err('No current method')) })
  expect(toolError(await addNodes(deps, { statements: ['c = 1'] }))).toBe('No current method')
})

test('add_nodes in Live mode is refused by the session, and nothing is created', async () => {
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
  const { deps, createNodes } = makeDeps({ session })
  expect(toolError(await addNodes(deps, { statements: ['c = 1'] }))).toBe(LIVE_EDIT_ERROR)
  expect(createNodes).not.toHaveBeenCalled()
})

test('add_nodes adds a note when execution has not finished', async () => {
  const { deps } = makeDeps({ session: fakeSession(false) })
  const result = valueOf(await addNodes(deps, { statements: ['c = 1'] }))
  expect(result.settled).toBe(false)
  expect(result.note).toBe(UNSETTLED_NOTE)
  expect(UNSETTLED_NOTE).toBe(
    'The engine had not reported results for the changed nodes within 20 seconds: call get_node later.',
  )
})

test('add_nodes says so when a new node is not in the graph yet', async () => {
  const { deps } = makeDeps({
    createNodes: vi.fn(async () => Ok([asNodeId(crypto.randomUUID() as ExternalId)])),
  })
  const result = valueOf(await addNodes(deps, { statements: ['c = 1'] }))
  expect(result).toEqual({ nodes: [], settled: true, note: MISSING_NODES_NOTE })
})

test('edit_node sets the content and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await editNode(deps, { node_id: a, expression: '5 * 5' }))
  expect(deps.setNodeContent).toHaveBeenCalledWith(a, '5 * 5')
  expect(result).toEqual({ nodes: [expect.objectContaining({ id: a, name: 'a' })], settled: true })
})

test('edit_node refuses an unknown node, a statement and a syntax error', async () => {
  const { deps, db } = makeDeps()
  expect(toolError(await editNode(deps, { node_id: 'nope', expression: '1' }))).toContain(
    'No node with id nope',
  )
  const a = nodeNamed(db, 'a')
  expect(toolError(await editNode(deps, { node_id: a, expression: 'x = 1' }))).toContain(
    'Give only the expression; the node keeps its name.',
  )
  expect(toolError(await editNode(deps, { node_id: a, expression: 'foo (' }))).toContain(
    'syntax error',
  )
  expect(
    toolError(await editNode(deps, { node_id: a, expression: 'import Standard.Base' })),
  ).toContain('is an import')
  expect(deps.setNodeContent).not.toHaveBeenCalled()
})

test('edit_node passes a multi-line expression on', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const expression = 'foo\n    . bar\n    . baz'
  valueOf(await editNode(deps, { node_id: a, expression }))
  expect(deps.setNodeContent).toHaveBeenCalledWith(a, expression)
})

// What the parser makes of statement-like text, which is why an expression is checked as a
// block statement: `parseExpression` takes an import line for an expression.
test('The parser takes an import line for an expression, and an assignment for none', () => {
  expect(Ast.parseExpression('import Standard.Base')?.code()).toBe('import Standard.Base')
  expect(Ast.parseBlockStatement('import Standard.Base')).toBeInstanceOf(Ast.ExpressionStatement)
  expect(Ast.parseModuleStatement('import Standard.Base')).toBeInstanceOf(Ast.Import)
  expect(Ast.parseExpression('x = 1')).toBeUndefined()
  expect(Ast.parseBlockStatement('x = 1')).toBeInstanceOf(Ast.Assignment)
})

test('parseNodeExpression accepts exactly what a node can hold', () => {
  expect(parseNodeExpression('1 + 2')).toEqual(Ok('1 + 2'))
  expect(parseNodeExpression('foo\n    . bar')).toEqual(Ok('foo\n    . bar'))
  expect(errorOf(parseNodeExpression('import Standard.Base'))).toContain('is an import')
  expect(errorOf(parseNodeExpression('from Standard.Table import all'))).toContain('is an import')
  expect(errorOf(parseNodeExpression('x = 1'))).toContain(
    'Give only the expression; the node keeps its name.',
  )
  expect(errorOf(parseNodeExpression('f x = x + 1'))).toContain('function definition')
  expect(errorOf(parseNodeExpression('type T'))).toContain('not an expression')
  expect(errorOf(parseNodeExpression('a\nb'))).toContain('not one expression')
  expect(errorOf(parseNodeExpression('   '))).toContain('not one expression')
  expect(errorOf(parseNodeExpression('foo ('))).toContain('syntax error')
})

test('remove_nodes with one unknown id removes nothing', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = await removeNodes(deps, { node_ids: [a, 'nope'] })
  expect(toolError(result)).toContain('No node with id nope')
  expect(deps.deleteNodes).not.toHaveBeenCalled()
})

test('remove_nodes refuses the output node', async () => {
  const { deps, db } = makeDeps()
  const result = await removeNodes(deps, { node_ids: [outputNode(db)] })
  expect(toolError(result)).toContain('cannot be removed')
  expect(deps.deleteNodes).not.toHaveBeenCalled()
})

test('remove_nodes deletes the nodes and lists them', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(await removeNodes(deps, { node_ids: [a, b, a] }))
  expect(deps.deleteNodes).toHaveBeenCalledWith([a, b])
  expect(result).toEqual({ removed: [a, b], settled: true })
})

test('set_node_comment writes the comment and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const b = nodeNamed(db, 'b')
  const result = valueOf(await setNodeComment(deps, { node_id: b, text: 'Hello' }))
  expect(deps.setNodeComment).toHaveBeenCalledWith(b, 'Hello')
  // Nothing is computed again, so it has settled: every edit result has the field.
  expect(result).toEqual({ node: expect.objectContaining({ id: b, name: 'b' }), settled: true })
})

test('set_visualization shows the visualization and answers with the node', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const result = valueOf(await setVisualization(deps, { node_id: a, visible: true }))
  expect(deps.setVisualization).toHaveBeenCalledWith(a, true)
  expect(result).toEqual({ node: expect.objectContaining({ id: a }), settled: true })
  expect(toolError(await setVisualization(deps, { node_id: 'nope', visible: false }))).toContain(
    'No node with id nope',
  )
})

test('set_node_comment and set_visualization affect no expression, so they do not wait', async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const a = nodeNamed(db, 'a')
  await setNodeComment(deps, { node_id: a, text: 'Hello' })
  await setVisualization(deps, { node_id: a, visible: true })
  expect(session.affected).toEqual([{}, {}])
})

test('add_nodes waits for the new nodes; edit_node for the edited node', async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const added = valueOf(await addNodes(deps, { statements: ['c = 1', 'd = c + 1'] }))
  // New nodes: any report after the edit counts.
  expect(session.affected[0]).toEqual({ added: added.nodes.map((n: { id: string }) => n.id) })
  expect(session.affected[0]!.added).toHaveLength(2)
  const a = nodeNamed(db, 'a')
  await editNode(deps, { node_id: a, expression: '7' })
  // An existing node: its result counts once the engine has taken the edit up.
  expect(session.affected[1]).toEqual({ changed: [a] })
})

test('remove_nodes waits for the nodes that used a removed one, read before the deletion', async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  vi.mocked(deps.deleteNodes).mockImplementation(async (ids) => {
    // Once deleted, a node has no users to look up.
    for (const id of ids) db.nodeIdToNode.delete(id)
    return Ok()
  })
  await removeNodes(deps, { node_ids: [a] })
  expect(session.affected[0]).toEqual({ changed: [b] })
})

test("remove_nodes of a node and its only user waits for the method's output node, which used it", async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  await removeNodes(deps, { node_ids: [a, b] })
  // `b` is used only by the method's output, which is not removed: it is the one user.
  expect(session.affected[0]).toEqual({ changed: [outputNode(db)] })
})

// === Code that turns the output context on ===

test('parseNodeStatement and parseNodeExpression refuse code that turns the output context on', () => {
  for (const expression of ENABLING_EXPRESSIONS) {
    expect(errorOf(parseNodeStatement(expression)), expression).toBe(WRITE_REFUSED_ERROR)
    expect(errorOf(parseNodeStatement(`x = ${expression}`)), expression).toBe(WRITE_REFUSED_ERROR)
    expect(errorOf(parseNodeExpression(expression)), expression).toBe(WRITE_REFUSED_ERROR)
    expect(
      errorOf(
        parseNodeExpression(`foo
    . bar (${expression})`),
      ),
      expression,
    ).toBe(WRITE_REFUSED_ERROR)
  }
})

test('parseNodeStatement and parseNodeExpression accept similar names that do not turn it on', () => {
  for (const expression of HARMLESS_EXPRESSIONS) {
    expect(parseNodeStatement(`x = ${expression}`).ok, expression).toBe(true)
    expect(parseNodeExpression(expression).ok, expression).toBe(true)
  }
  expect(parseNodeStatement('enabled = True')).toEqual(
    Ok({ binding: 'enabled', expression: 'True' }),
  )
})

test('add_nodes refuses a statement wrapped in the Write prefix, and creates nothing', async () => {
  const { deps, createNodes } = makeDeps()
  const result = await addNodes(deps, {
    statements: ['c = 1', `w = ${WRITE_PREFIX}"x".write "x.txt"`],
  })
  expect(toolError(result)).toBe(`Statement 2: ${WRITE_REFUSED_ERROR}`)
  expect(createNodes).not.toHaveBeenCalled()
})

test.each(ENABLING_IMPORTS)(
  'add_nodes refuses an import of the enabling function, and creates nothing: %s',
  async (line) => {
    const { deps, createNodes } = makeDeps()
    const result = await addNodes(deps, { statements: ['c = 1'], imports: [line] })
    expect(toolError(result)).toBe(WRITE_REFUSED_ERROR)
    expect(createNodes).not.toHaveBeenCalled()
  },
)

test('edit_node refuses an expression that turns the output context on', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  for (const expression of ENABLING_EXPRESSIONS) {
    expect(toolError(await editNode(deps, { node_id: a, expression })), expression).toBe(
      WRITE_REFUSED_ERROR,
    )
  }
  expect(deps.setNodeContent).not.toHaveBeenCalled()
})

const WRITE_ON_CODE = `main =
    a = 1 + 2
    w = ${WRITE_PREFIX}a.to_text.write "x.txt"
    w`

test('edit_node refuses a node the user turned Write on for, and leaves it as it is', async () => {
  const { deps, db } = makeDeps({}, WRITE_ON_CODE)
  const w = nodeNamed(db, 'w')
  expect(db.nodeIdToNode.get(w)!.prefixes.enableRecording).toBeDefined()
  expect(toolError(await editNode(deps, { node_id: w, expression: 'a.to_text' }))).toBe(
    writeOnNodeError(w),
  )
  expect(deps.setNodeContent).not.toHaveBeenCalled()
  // Its comment and visualization are not code: those still work.
  expect((await setNodeComment(deps, { node_id: w, text: 'Saved' })).ok).toBe(true)
  expect((await setVisualization(deps, { node_id: w, visible: true })).ok).toBe(true)
})

test("Every edit tool passes the call's deadline to the session", async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const a = nodeNamed(db, 'a')
  await addNodes(deps, { statements: ['c = 1'] })
  await editNode(deps, { node_id: a, expression: '7' })
  await setNodeComment(deps, { node_id: a, text: 'x' })
  await setVisualization(deps, { node_id: a, visible: true })
  await removeNodes(deps, { node_ids: [a] })
  expect(session.deadlines).toEqual([DEADLINE, DEADLINE, DEADLINE, DEADLINE, DEADLINE])
})

// === The method on screen and the nodes, checked again at the edit's turn ===

const otherPointer: MethodPointer = { ...pointer, name: 'other' as Identifier }

/** A session where, before the edit's turn, `before` runs (the user or open_method acts). */
function sessionWith(before: () => void): Pick<EditSession, 'run'> {
  return {
    async run<T>(
      callerArg: McpCaller,
      edit: () => Result<T> | Promise<Result<T>>,
      options?: EditRunOptions<T>,
    ) {
      before()
      return fakeSession().run(callerArg, edit, options)
    },
  }
}

describe('at the turn of a queued edit', () => {
  function changedMethodDeps() {
    const fixture: { deps?: EditToolDeps } = {}
    const made = makeDeps({
      session: sessionWith(() => {
        fixture.deps!.currentMethod.pointer = Ok(otherPointer)
      }),
    })
    fixture.deps = made.deps
    return made
  }

  test('the method-changed text', () => {
    expect(METHOD_CHANGED_ERROR).toBe(
      'The method on screen changed before this edit ran. Nothing was changed; call get_graph and try again.',
    )
  })

  test('every node tool refuses when the method on screen changed, before changing anything', async () => {
    const { deps, db, createNodes } = changedMethodDeps()
    const a = nodeNamed(db, 'a')
    const calls: [string, () => Promise<McpToolResult>][] = [
      ['add_nodes', () => addNodes(deps, { statements: ['c = 1'] })],
      ['add_nodes after', () => addNodes(deps, { statements: ['c = 1'], after_node: a })],
      ['edit_node', () => editNode(deps, { node_id: a, expression: '7' })],
      ['remove_nodes', () => removeNodes(deps, { node_ids: [a] })],
      ['set_node_comment', () => setNodeComment(deps, { node_id: a, text: 'x' })],
      ['set_visualization', () => setVisualization(deps, { node_id: a, visible: true })],
    ]
    for (const [name, call] of calls) {
      // Validated with `main` on screen; `other` is on screen at the edit's turn.
      deps.currentMethod.pointer = Ok(pointer)
      expect(toolError(await call()), name).toBe(METHOD_CHANGED_ERROR)
    }
    expect(createNodes).not.toHaveBeenCalled()
    expect(deps.setNodeContent).not.toHaveBeenCalled()
    expect(deps.deleteNodes).not.toHaveBeenCalled()
    expect(deps.setNodeComment).not.toHaveBeenCalled()
    expect(deps.setVisualization).not.toHaveBeenCalled()
  })

  test('every node tool refuses a node removed before its turn, as an unknown id', async () => {
    const fixture: { db?: GraphDb; id?: NodeId } = {}
    const { deps, db, createNodes } = makeDeps({
      session: sessionWith(() => {
        fixture.db!.nodeIdToNode.delete(fixture.id!)
      }),
    })
    fixture.db = db
    const a = nodeNamed(db, 'a')
    const b = nodeNamed(db, 'b')
    const unknown = (id: string) =>
      `No node with id ${id} in the method on screen. Call get_graph for the current ids.`
    const check = async (id: NodeId, call: () => Promise<McpToolResult>) => {
      // Each call is validated with the node present; the session removes it before the turn.
      db.nodeIdToNode.set(id, original.get(id)!)
      fixture.id = id
      expect(toolError(await call())).toBe(unknown(id))
    }
    const original = new Map([
      [a, db.nodeIdToNode.get(a)!],
      [b, db.nodeIdToNode.get(b)!],
    ])
    await check(a, () => addNodes(deps, { statements: ['c = 1'], after_node: a }))
    await check(a, () => editNode(deps, { node_id: a, expression: '7' }))
    await check(b, () => removeNodes(deps, { node_ids: [a, b] }))
    await check(a, () => setNodeComment(deps, { node_id: a, text: 'x' }))
    await check(a, () => setVisualization(deps, { node_id: a, visible: true }))
    expect(createNodes).not.toHaveBeenCalled()
    expect(deps.setNodeContent).not.toHaveBeenCalled()
    expect(deps.deleteNodes).not.toHaveBeenCalled()
    expect(deps.setNodeComment).not.toHaveBeenCalled()
    expect(deps.setVisualization).not.toHaveBeenCalled()
  })

  test('the same method, entered again, is not a change', async () => {
    const { deps, db } = makeDeps({
      session: sessionWith(() => {
        deps.currentMethod.pointer = Ok({ ...pointer })
      }),
    })
    expect((await editNode(deps, { node_id: nodeNamed(db, 'a'), expression: '7' })).ok).toBe(true)
  })
})

test('edit_node refuses a node the user turned Write on for while the edit waited', async () => {
  const fixture: { db?: GraphDb; id?: NodeId } = {}
  const { deps, db } = makeDeps({
    session: sessionWith(() => {
      // As the GUI's Write switch does: the node is read again with the prefix.
      const node = fixture.db!.nodeIdToNode.get(fixture.id!)!
      fixture.db!.nodeIdToNode.set(fixture.id!, {
        ...node,
        prefixes: { enableRecording: [] },
      })
    }),
  })
  fixture.db = db
  const a = nodeNamed(db, 'a')
  fixture.id = a
  expect(toolError(await editNode(deps, { node_id: a, expression: '7' }))).toBe(writeOnNodeError(a))
  expect(deps.setNodeContent).not.toHaveBeenCalled()
})

test('edit_node to the code the node already has waits for nothing: the engine computes nothing', async () => {
  const session = fakeSession()
  const { deps, db } = makeDeps({ session })
  const a = nodeNamed(db, 'a')
  const result = valueOf(await editNode(deps, { node_id: a, expression: '1 + 2' }))
  expect(result.settled).toBe(true)
  expect(session.affected[0]).toEqual({})
  // A different text waits for the node.
  await editNode(deps, { node_id: a, expression: '1 + 3' })
  expect(session.affected[1]).toEqual({ changed: [a] })
})
