/* eslint-disable camelcase -- argument names are snake_case on the wire */
import { GraphDb, asNodeId, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { EditSession, LIVE_EDIT_ERROR, type EditOutcome, type EditRunOptions } from '../editSession'
import {
  METHOD_CHANGED_ERROR,
  MISSING_NODES_NOTE,
  UNSETTLED_NOTE,
  writeOnNodeError,
} from '../editTools'
import {
  addFunction,
  collapseNodesTool,
  parseFunctionDefinition,
  type StructureToolDeps,
} from '../structureTools'
import {
  BUILTIN_REFUSED_ERROR,
  EVAL_REFUSED_ERROR,
  NAME_LOOKUP_REFUSED_ERROR,
  REFLECTION_REFUSED_ERROR,
  WRITE_REFUSED_ERROR,
} from '../writeGuard'
import {
  BUILTIN_FUNCTION,
  ENABLING_EXPRESSIONS,
  ENABLING_FUNCTION,
  EVAL_EXPRESSIONS,
  HARMLESS_EXPRESSIONS,
  NAME_LOOKUP_EXPRESSIONS,
  REFLECTION_EXPRESSIONS,
  WRITE_PREFIX,
} from './outputEnablingCode'

const CODE = `## A helper.
helper x = x

main =
    a = 1 + 2
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

function fakeSession(settled = true) {
  return {
    run: vi.fn(
      async <T>(
        _caller: unknown,
        edit: () => Result<T> | Promise<Result<T>>,
        _options?: EditRunOptions<T>,
      ) => {
        const result = await edit()
        return result.ok ? Ok<EditOutcome<T>>({ value: result.value, settled }) : result
      },
    ),
  }
}

function makeDeps(overrides: Partial<StructureToolDeps> = {}, code = CODE) {
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(undefined, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(code)
  const func = Ast.findModuleMethod(root, 'main')?.statement
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  // `add_function` edits a transient copy of the module, committed when the edit succeeds.
  const edit = Ast.MutableModule.Transient()
  const topLevel = Ast.parseModule(code, edit)
  edit.setRoot(topLevel)
  const session = fakeSession()
  const deps: StructureToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    moduleRoot: () => root,
    printType: projectNames.printProjectPath,
    evaluate: vi.fn(async () => Ok('text')),
    session,
    caller,
    deadline: DEADLINE,
    collapseNodes: vi.fn<StructureToolDeps['collapseNodes']>((_ids, name) => {
      const id = asNodeId(crypto.randomUUID() as ExternalId)
      const functionName = name ?? ('user_defined_component' as Identifier)
      db.mockNode('b', id, `Main.${functionName} a`)
      return Ok({ name: functionName, callNode: id })
    }),
    editModule: <T>(f: (topLevel: Ast.MutableBodyBlock) => Result<T>) => f(topLevel),
    addDetectedImports: vi.fn(),
    ...overrides,
  }
  return { deps, db, topLevel, session }
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

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

// === collapse_nodes ===

test('collapse_nodes passes the nodes and the name, and answers with the call node', async () => {
  const { deps, db } = makeDeps()
  const a = nodeNamed(db, 'a')
  const b = nodeNamed(db, 'b')
  const result = valueOf(await collapseNodesTool(deps, { node_ids: [a, b, a], name: 'double_sum' }))
  expect(deps.collapseNodes).toHaveBeenCalledWith([a, b], 'double_sum')
  expect(result).toEqual({
    name: 'double_sum',
    node: expect.objectContaining({ name: 'b', code: 'Main.double_sum a', kind: 'component' }),
    settled: true,
  })
})

test('collapse_nodes without a name lets the name be generated', async () => {
  const { deps, db } = makeDeps()
  const result = valueOf(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'b')] }))
  expect(deps.collapseNodes).toHaveBeenCalledWith([nodeNamed(db, 'b')], undefined)
  expect(result.name).toBe('user_defined_component')
})

test('collapse_nodes refuses an invalid name before the session', async () => {
  const { deps, db, session } = makeDeps()
  const a = nodeNamed(db, 'a')
  for (const name of ['Double', 'two words', '1abc', 'a.b', '']) {
    const error = toolError(await collapseNodesTool(deps, { node_ids: [a], name }))
    expect(error).toContain('not a valid function name')
  }
  expect(session.run).not.toHaveBeenCalled()
  expect(deps.collapseNodes).not.toHaveBeenCalled()
})

test('collapse_nodes refuses an unknown node and the output node before the session', async () => {
  const { deps, db, session } = makeDeps()
  const a = nodeNamed(db, 'a')
  expect(toolError(await collapseNodesTool(deps, { node_ids: [a, 'nope'] }))).toContain(
    'No node with id nope',
  )
  const output = [...db.nodeIdToNode.entries()].find(([, node]) => node.type === 'output')?.[0]
  assert(output != null)
  expect(toolError(await collapseNodesTool(deps, { node_ids: [a, output] }))).toContain(
    'cannot be collapsed',
  )
  expect(session.run).not.toHaveBeenCalled()
})

const WRITE_ON_CODE = `main =
    a = 1 + 2
    w = ${WRITE_PREFIX}a.to_text.write "x.txt"
    w`

test('collapse_nodes refuses a node the user turned Write on for, before the session', async () => {
  const { deps, db, session } = makeDeps({}, WRITE_ON_CODE)
  const a = nodeNamed(db, 'a')
  const w = nodeNamed(db, 'w')
  expect(db.nodeIdToNode.get(w)!.prefixes.enableRecording).toBeDefined()
  expect(toolError(await collapseNodesTool(deps, { node_ids: [a, w] }))).toBe(writeOnNodeError(w))
  expect(session.run).not.toHaveBeenCalled()
  expect(deps.collapseNodes).not.toHaveBeenCalled()
})

test('collapse_nodes refuses a node the user turned Write on for while the edit waited', async () => {
  const fixture: { db?: GraphDb; id?: NodeId } = {}
  const { deps, db } = makeDeps({
    session: sessionWith(() => {
      const node = fixture.db!.nodeIdToNode.get(fixture.id!)!
      fixture.db!.nodeIdToNode.set(fixture.id!, { ...node, prefixes: { enableRecording: [] } })
    }),
  })
  fixture.db = db
  const a = nodeNamed(db, 'a')
  fixture.id = a
  expect(toolError(await collapseNodesTool(deps, { node_ids: [a] }))).toBe(writeOnNodeError(a))
  expect(deps.collapseNodes).not.toHaveBeenCalled()
})

test('collapse_nodes reports why the nodes cannot be collapsed', async () => {
  const { deps, db } = makeDeps({
    collapseNodes: vi.fn(() => Err('More than one output from collapsed function: a and b')),
  })
  expect(toolError(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] }))).toBe(
    'More than one output from collapsed function: a and b',
  )
})

test('collapse_nodes in Live mode is refused by the session', async () => {
  const session = new EditSession({
    isLive: () => true,
    isActive: () => true,
    holdUndoStep: () => () => {},
    onForeignEdit: () => () => {},
    historyDepth: () => ({ undo: 0, redo: 0 }),
    undo: () => false,
    redo: () => false,
    enablesOutput: () => false,
    saveVersion: async () => {},
    watchGraphUpdate: () => ({ updated: async () => true, cancel: () => {} }),
    watchExecution: () => ({ settled: async () => true, cancel: () => {} }),
    now: () => 0,
    setTimeout: () => undefined,
    clearTimeout: () => {},
  })
  const { deps, db } = makeDeps({ session })
  expect(toolError(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] }))).toBe(
    LIVE_EDIT_ERROR,
  )
  expect(deps.collapseNodes).not.toHaveBeenCalled()
})

test('collapse_nodes notes an unsettled execution and a call node not in the graph yet', async () => {
  const { deps, db } = makeDeps({
    session: fakeSession(false),
    collapseNodes: vi.fn(() =>
      Ok({ name: 'f' as Identifier, callNode: asNodeId(crypto.randomUUID() as ExternalId) }),
    ),
  })
  const result = valueOf(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] }))
  expect(result).toEqual({
    name: 'f',
    node: null,
    settled: false,
    note: `${UNSETTLED_NOTE} ${MISSING_NODES_NOTE}`,
  })
})

// === add_function ===

test('add_function inserts the definition before the current method', async () => {
  const { deps, topLevel } = makeDeps()
  const result = valueOf(await addFunction(deps, { source: 'double x =\n    x * 2' }))
  expect(result).toEqual({ name: 'double', settled: true })
  expect(topLevel.code()).toBe(
    [
      '## A helper.',
      'helper x = x',
      '',
      'double x =',
      '    x * 2',
      '',
      'main =',
      '    a = 1 + 2',
      '    b = a * 2',
      '    b',
    ].join('\n'),
  )
  expect(deps.addDetectedImports).toHaveBeenCalledOnce()
  const [edit, scope] = vi.mocked(deps.addDetectedImports).mock.calls[0]!
  expect(edit).toBe(topLevel.module)
  expect(scope.code()).toBe('double x =\n    x * 2')
})

test('add_function keeps the documentation of the definition', async () => {
  const { deps, topLevel } = makeDeps()
  valueOf(await addFunction(deps, { source: '## Twice x.\ndouble x = x * 2' }))
  expect(topLevel.code()).toContain('## Twice x.\ndouble x = x * 2\n')
})

test('add_function refuses a name already defined at the top level', async () => {
  const { deps, topLevel, session } = makeDeps()
  const before = topLevel.code()
  const error = toolError(await addFunction(deps, { source: 'helper y = y + 1' }))
  expect(error).toContain('`helper`')
  expect(error).toContain('already defined')
  expect(topLevel.code()).toBe(before)
  // Checked at the call's turn in the session: an earlier edit may have added it.
  expect(session.run).toHaveBeenCalled()
  expect(deps.addDetectedImports).not.toHaveBeenCalled()
})

test('add_function refuses what is not one function definition, before the session', async () => {
  const { deps, session } = makeDeps()
  const refusals: [string, string][] = [
    ['f x = 1\ng y = 2', 'not one function definition'],
    ['1 + 2', 'not a function definition'],
    ['import Standard.Base', 'is an import'],
    ['type Foo', 'not a function definition'],
    ['f x = (', 'syntax error'],
    ['f x =', 'no body'],
  ]
  for (const [source, expected] of refusals) {
    expect(toolError(await addFunction(deps, { source })), source).toContain(expected)
  }
  expect(session.run).not.toHaveBeenCalled()
})

test('parseFunctionDefinition accepts exactly one function with a plain name', () => {
  expect(parseFunctionDefinition('double x =\n    x * 2')).toEqual(Ok('double'))
  // At the top level `x = 1` is a method without arguments, as `main = ...` is.
  expect(parseFunctionDefinition('answer = 42')).toEqual(Ok('answer'))
  expect(errorOf(parseFunctionDefinition('Foo x = 1'))).toContain('lowercase name')
  expect(errorOf(parseFunctionDefinition('Text.shout self = self'))).toContain('lowercase name')
  expect(errorOf(parseFunctionDefinition('+ a b = a'))).toContain('lowercase name')
  expect(errorOf(parseFunctionDefinition('   '))).toContain('not one function definition')
})

test('add_function reports an unsettled execution', async () => {
  const { deps } = makeDeps({ session: fakeSession(false) })
  const result = valueOf(await addFunction(deps, { source: 'double x = x * 2' }))
  expect(result).toEqual({ name: 'double', settled: false, note: UNSETTLED_NOTE })
})

// === Code that turns the output context on ===

test('parseFunctionDefinition refuses a body that turns the output context on, in every form', () => {
  expect(errorOf(parseFunctionDefinition(ENABLING_FUNCTION))).toBe(WRITE_REFUSED_ERROR)
  for (const expression of ENABLING_EXPRESSIONS) {
    expect(errorOf(parseFunctionDefinition(`f x = ${expression}`)), expression).toBe(
      WRITE_REFUSED_ERROR,
    )
    expect(
      errorOf(parseFunctionDefinition(`f x =\n    y = x\n    ${expression}`)),
      expression,
    ).toBe(WRITE_REFUSED_ERROR)
  }
})

test('parseFunctionDefinition accepts similar names that do not turn it on', () => {
  for (const expression of HARMLESS_EXPRESSIONS) {
    expect(parseFunctionDefinition(`f x = ${expression}`), expression).toEqual(Ok('f'))
  }
})

test('add_function refuses a body that turns the output context on, before the session', async () => {
  const { deps, topLevel, session } = makeDeps()
  const before = topLevel.code()
  expect(toolError(await addFunction(deps, { source: ENABLING_FUNCTION }))).toBe(
    WRITE_REFUSED_ERROR,
  )
  expect(session.run).not.toHaveBeenCalled()
  expect(topLevel.code()).toBe(before)
})

test('add_function refuses a function bound to a runtime builtin, before the session', async () => {
  const { deps, topLevel, session } = makeDeps()
  const before = topLevel.code()
  expect(errorOf(parseFunctionDefinition(BUILTIN_FUNCTION))).toBe(BUILTIN_REFUSED_ERROR)
  expect(toolError(await addFunction(deps, { source: BUILTIN_FUNCTION }))).toBe(
    BUILTIN_REFUSED_ERROR,
  )
  expect(session.run).not.toHaveBeenCalled()
  expect(topLevel.code()).toBe(before)
})

test('parseFunctionDefinition refuses a body that builds a method name by reflection', () => {
  for (const expression of REFLECTION_EXPRESSIONS) {
    expect(errorOf(parseFunctionDefinition(`f x = ${expression}`)), expression).toBe(
      REFLECTION_REFUSED_ERROR,
    )
  }
})

test('parseFunctionDefinition refuses a body that evaluates text as code', () => {
  for (const expression of EVAL_EXPRESSIONS) {
    expect(errorOf(parseFunctionDefinition(`f x = ${expression}`)), expression).toBe(
      EVAL_REFUSED_ERROR,
    )
  }
  for (const expression of NAME_LOOKUP_EXPRESSIONS) {
    expect(errorOf(parseFunctionDefinition(`f x = ${expression}`)), expression).toBe(
      NAME_LOOKUP_REFUSED_ERROR,
    )
  }
})

test('add_function refuses a body that evaluates text as code, before the session', async () => {
  const { deps, topLevel, session } = makeDeps()
  const before = topLevel.code()
  expect(toolError(await addFunction(deps, { source: `f x = ${EVAL_EXPRESSIONS[0]}` }))).toBe(
    EVAL_REFUSED_ERROR,
  )
  expect(session.run).not.toHaveBeenCalled()
  expect(topLevel.code()).toBe(before)
})

test("collapse_nodes and add_function pass the call's deadline to the session", async () => {
  const { deps, db, session } = makeDeps()
  await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] })
  await addFunction(deps, { source: 'double x = x * 2' })
  expect(session.run.mock.calls.map((call) => call[2]?.deadline)).toEqual([DEADLINE, DEADLINE])
})

// === The method on screen and the nodes, checked again at the edit's turn ===

const otherPointer: MethodPointer = { ...pointer, name: 'other' as Identifier }

/** A session where `before` runs before the edit's turn (the user or open_method acts). */
function sessionWith(before: () => void) {
  const inner = fakeSession()
  return {
    run: vi.fn(
      async <T>(
        callerArg: unknown,
        edit: () => Result<T> | Promise<Result<T>>,
        options?: EditRunOptions<T>,
      ) => {
        before()
        return inner.run(callerArg, edit, options)
      },
    ),
  }
}

test('collapse_nodes and add_function refuse when the method on screen changed, before changing anything', async () => {
  const fixture: { deps?: StructureToolDeps } = {}
  const { deps, db, topLevel } = makeDeps({
    session: sessionWith(() => {
      fixture.deps!.currentMethod.pointer = Ok(otherPointer)
    }),
  })
  fixture.deps = deps
  const before = topLevel.code()
  expect(toolError(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] }))).toBe(
    METHOD_CHANGED_ERROR,
  )
  // Validated with `main` on screen again; `other` is on screen at the edit's turn.
  deps.currentMethod.pointer = Ok(pointer)
  expect(toolError(await addFunction(deps, { source: 'double x = x * 2' }))).toBe(
    METHOD_CHANGED_ERROR,
  )
  expect(deps.collapseNodes).not.toHaveBeenCalled()
  expect(topLevel.code()).toBe(before)
})

test('collapse_nodes refuses a node removed before its turn, as an unknown id', async () => {
  const fixture: { db?: GraphDb; id?: NodeId } = {}
  const { deps, db } = makeDeps({
    session: sessionWith(() => {
      fixture.db!.nodeIdToNode.delete(fixture.id!)
    }),
  })
  fixture.db = db
  const a = nodeNamed(db, 'a')
  fixture.id = a
  expect(toolError(await collapseNodesTool(deps, { node_ids: [a] }))).toBe(
    `No node with id ${a} in the method on screen. Call get_graph for the current ids.`,
  )
  expect(deps.collapseNodes).not.toHaveBeenCalled()
})

test("collapse_nodes waits for the new call node's value; add_function for nothing", async () => {
  const { deps, db, session } = makeDeps()
  const collapsed = valueOf(await collapseNodesTool(deps, { node_ids: [nodeNamed(db, 'a')] }))
  await addFunction(deps, { source: 'double x = x * 2' })
  const affected = session.run.mock.calls.map((call) => call[2]?.affected)
  expect(affected[0]!({ name: 'f' as Identifier, callNode: collapsed.node.id })).toEqual({
    added: [collapsed.node.id],
  })
  expect(affected[1]).toBeUndefined()
})
