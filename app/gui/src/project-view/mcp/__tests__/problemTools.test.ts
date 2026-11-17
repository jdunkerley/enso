import { GraphDb, type NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import {
  ComputedValueRegistry,
  TypeInfo,
} from '$/providers/openedProjects/project/computedValueRegistry'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { nextTick, reactive, ref, watchEffect } from 'vue'
import type { Diagnostic, ExpressionUpdatePayload } from 'ydoc-shared/languageServerTypes'
import type { SourceRange } from 'ydoc-shared/util/data/text'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { GRAPH_NODE_TEXT_CHARS } from '../graphTools'
import {
  PROBLEM_DIAGNOSTICS_MAX,
  PROBLEM_NODES_MAX,
  PROBLEM_TEXT_WAIT_MS,
  getProblems,
  type ProblemToolDeps,
} from '../problemTools'

const CODE = `import Standard.Base.Data.Numbers

other = 5

main =
    a = 1 + 2
    b = a * 2
    c = b + 1
    d = 7
    c`

const METHOD_TEXT = CODE.slice(CODE.indexOf('main ='))

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

function rangeOf(text: string, code = CODE): SourceRange {
  const from = code.indexOf(text)
  assert(from >= 0)
  return { from, to: from + text.length }
}

function makeDeps(overrides: Partial<ProblemToolDeps> = {}, code = CODE) {
  const registry = ComputedValueRegistry.Mock()
  const projectNames = mockProjectNameStore()
  const db = GraphDb.Mock(registry, undefined, projectNames)
  const { root, getSpan } = Ast.parseUpdatingIdMap(code)
  const func = [...root.statements()].find(
    (s) => s instanceof Ast.FunctionDef && s.name.code() === 'main',
  )
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: code, getSpan })
  const errorTexts = reactive(new Map<string, string>())
  const diagnostics = ref<Diagnostic[]>([])
  const deps: ProblemToolDeps = {
    db,
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    dataflowErrorMessage: (id) => errorTexts.get(id),
    diagnostics: () => diagnostics.value,
    methodRange: () => rangeOf(code.slice(code.indexOf('main =')), code),
    expressionRange: () => undefined,
    lineOf: (offset) => code.slice(0, offset).split('\n').length,
    isThisModule: () => true,
    waitMs: 40,
    ...overrides,
  }
  return { deps, db, registry, errorTexts, diagnostics }
}

type Fixture = ReturnType<typeof makeDeps>

function idOf(db: GraphDb, name: string): NodeId {
  const id = db.getIdentDefiningNode(name)
  assert(id != null)
  return id
}

function setPayload(fixture: Fixture, name: string, payload: ExpressionUpdatePayload) {
  fixture.registry.db.set(idOf(fixture.db, name), {
    typeInfo: TypeInfo.fromParsedTypes([stdPath('Standard.Base.Data.Numbers.Integer')], []),
    methodCall: undefined,
    payload,
    profilingInfo: [],
    evaluationId: 1,
  })
}

const dataflowError: ExpressionUpdatePayload = { type: 'DataflowError', trace: [] }

interface ParsedNode {
  id: string
  name: string
  state: string
  message: string | null
  origin?: boolean
  warnings?: number
}

interface ParsedResult {
  method: string
  nodes: ParsedNode[]
  diagnostics: { kind: string; message: string; line?: number }[]
  diagnostics_truncated?: boolean
  errors: number
  warnings: number
  pending: number
  messages_pending?: number
  truncated: boolean
}

function parse(result: McpToolResult): ParsedResult {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return JSON.parse(result.value) as ParsedResult
}

test('a panic, a dataflow error and a warning are each listed with their state and message', async () => {
  const f = makeDeps()
  setPayload(f, 'a', { type: 'Panic', message: 'Boom', trace: [] })
  setPayload(f, 'b', dataflowError)
  f.errorTexts.set(idOf(f.db, 'b'), 'The column was not found.')
  setPayload(f, 'd', { type: 'Value', warnings: { count: 3, value: 'Looks odd' } })
  setPayload(f, 'c', { type: 'Value' })
  const result = parse(await getProblems(f.deps))
  expect(result).toMatchObject({
    method: 'main',
    errors: 2,
    warnings: 1,
    pending: 0,
    truncated: false,
    diagnostics: [],
  })
  expect(result.nodes).toEqual([
    { id: idOf(f.db, 'a'), name: 'a', state: 'panic', message: 'Boom', origin: true },
    {
      id: idOf(f.db, 'b'),
      name: 'b',
      state: 'error',
      message: 'The column was not found.',
      origin: true,
    },
    { id: idOf(f.db, 'd'), name: 'd', state: 'warning', message: 'Looks odd', warnings: 3 },
  ])
  expect(result.messages_pending).toBeUndefined()
})

test('a dataflow error message is cut at its location, as the node shows it', async () => {
  const f = makeDeps()
  setPayload(f, 'a', dataflowError)
  f.errorTexts.set(idOf(f.db, 'a'), 'Boom (at Main.enso:3:4)')
  const result = parse(await getProblems(f.deps))
  expect(result.nodes[0]?.message).toBe('Boom')
})

test('a message is cut to the graph text limit', async () => {
  const f = makeDeps()
  setPayload(f, 'a', {
    type: 'Panic',
    message: 'x'.repeat(GRAPH_NODE_TEXT_CHARS + 50),
    trace: [],
  })
  const result = parse(await getProblems(f.deps))
  expect(result.nodes[0]?.message).toBe('x'.repeat(GRAPH_NODE_TEXT_CHARS) + '…')
})

test('a warning whose text the engine did not send has no message', async () => {
  const f = makeDeps()
  setPayload(f, 'a', { type: 'Value', warnings: { count: 2 } })
  const result = parse(await getProblems(f.deps))
  expect(result.nodes).toEqual([
    { id: idOf(f.db, 'a'), name: 'a', state: 'warning', message: null, warnings: 2 },
  ])
  expect(result.messages_pending).toBeUndefined()
})

test('a value without warnings, and one with a count of zero, are not problems', async () => {
  const f = makeDeps()
  setPayload(f, 'a', { type: 'Value' })
  setPayload(f, 'b', { type: 'Value', warnings: { count: 0 } })
  const result = parse(await getProblems(f.deps))
  expect(result).toMatchObject({ nodes: [], errors: 0, warnings: 0 })
})

test('origin is false for a node whose input has the same message, true for the first of the chain', async () => {
  const f = makeDeps()
  for (const name of ['a', 'b', 'c']) {
    setPayload(f, name, dataflowError)
    f.errorTexts.set(idOf(f.db, name), 'Same (at x)')
  }
  const result = parse(await getProblems(f.deps))
  expect(result.nodes.map((n) => [n.name, n.origin])).toEqual([
    ['a', true],
    ['b', false],
    ['c', false],
  ])
})

test('origin is true when the input has a different message, for panics too', async () => {
  const f = makeDeps()
  setPayload(f, 'a', { type: 'Panic', message: 'One', trace: [] })
  setPayload(f, 'b', { type: 'Panic', message: 'One', trace: [] })
  setPayload(f, 'c', { type: 'Panic', message: 'Two', trace: [] })
  const result = parse(await getProblems(f.deps))
  expect(result.nodes.map((n) => [n.name, n.origin])).toEqual([
    ['a', true],
    ['b', false],
    ['c', true],
  ])
})

test('error text that arrives late is waited for', async () => {
  const f = makeDeps({ waitMs: 2_000 })
  setPayload(f, 'a', dataflowError)
  const pending = getProblems(f.deps)
  setTimeout(() => f.errorTexts.set(idOf(f.db, 'a'), 'Late'), 10)
  const result = parse(await pending)
  expect(result.nodes[0]).toMatchObject({ message: 'Late' })
  expect(result.messages_pending).toBeUndefined()
})

test('error text that never arrives gives a null message and a count, after the wait', async () => {
  const f = makeDeps({ waitMs: 30 })
  setPayload(f, 'a', dataflowError)
  setPayload(f, 'b', dataflowError)
  f.errorTexts.set(idOf(f.db, 'b'), 'Here')
  const started = Date.now()
  const result = parse(await getProblems(f.deps))
  expect(Date.now() - started).toBeGreaterThanOrEqual(25)
  expect(result.messages_pending).toBe(1)
  expect(result.nodes[0]).toMatchObject({ name: 'a', message: null })
  expect(result.nodes[0]).not.toHaveProperty('origin')
  expect(result.nodes[1]).toMatchObject({ name: 'b', message: 'Here' })
})

test('the wait does not start when nothing needs it, and its default is the exported limit', async () => {
  expect(PROBLEM_TEXT_WAIT_MS).toBe(5_000)
  const f = makeDeps({ waitMs: 60_000 })
  setPayload(f, 'a', { type: 'Panic', message: 'x', trace: [] })
  const started = Date.now()
  await getProblems(f.deps)
  expect(Date.now() - started).toBeLessThan(1_000)
})

test('the watcher is stopped after the wait times out: a later arrival reads nothing', async () => {
  let reads = 0
  const f = makeDeps({ waitMs: 20 })
  const original = f.deps.dataflowErrorMessage
  const deps: ProblemToolDeps = {
    ...f.deps,
    dataflowErrorMessage: (id) => {
      reads++
      return original(id)
    },
  }
  setPayload(f, 'a', dataflowError)
  await getProblems(deps)
  const after = reads
  f.errorTexts.set(idOf(f.db, 'a'), 'Too late')
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(reads).toBe(after)
})

test('the watcher is stopped when the text arrives', async () => {
  let reads = 0
  const f = makeDeps({ waitMs: 2_000 })
  const original = f.deps.dataflowErrorMessage
  const deps: ProblemToolDeps = {
    ...f.deps,
    dataflowErrorMessage: (id) => {
      reads++
      return original(id)
    },
  }
  setPayload(f, 'a', dataflowError)
  const pending = getProblems(deps)
  setTimeout(() => f.errorTexts.set(idOf(f.db, 'a'), 'Here'), 5)
  await pending
  const after = reads
  f.errorTexts.set(idOf(f.db, 'a'), 'Changed')
  await nextTick()
  expect(reads).toBe(after)
})

test('nodes still computing are counted as pending', async () => {
  const f = makeDeps()
  setPayload(f, 'a', { type: 'Pending' })
  setPayload(f, 'b', { type: 'Pending' })
  setPayload(f, 'c', { type: 'Value' })
  const result = parse(await getProblems(f.deps))
  expect(result.pending).toBe(2)
})

test('at most the node limit is listed, errors and panics before warnings, in graph order', async () => {
  const lines = ['main =']
  const total = PROBLEM_NODES_MAX + 10
  for (let i = 0; i < total; i++) lines.push(`    n${i} = ${i}`)
  lines.push('    n0')
  const code = lines.join('\n')
  const f = makeDeps({}, code)
  // The first 60 nodes carry warnings, the last 50 panic.
  for (let i = 0; i < total; i++) {
    setPayload(
      f,
      `n${i}`,
      i < 60 ?
        { type: 'Value', warnings: { count: 1, value: `w${i}` } }
      : { type: 'Panic', message: `p${i}`, trace: [] },
    )
  }
  const result = parse(await getProblems(f.deps))
  expect(result.truncated).toBe(true)
  expect(result.nodes).toHaveLength(PROBLEM_NODES_MAX)
  expect(result.errors).toBe(50)
  expect(result.warnings).toBe(60)
  const names = result.nodes.map((n) => n.name)
  // The first 50 warnings and every panic are kept, in graph order.
  expect(names.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => `n${i}`))
  expect(names.slice(50)).toEqual(Array.from({ length: 50 }, (_, i) => `n${60 + i}`))
})

test('compile diagnostics inside the method (or without a position) are listed with a line', async () => {
  const ranges: Record<string, SourceRange> = {
    in: rangeOf('b = a * 2'),
    out: rangeOf('other = 5'),
  }
  const f = makeDeps({ expressionRange: (id) => ranges[id] })
  f.diagnostics.value = [
    { kind: 'Error', message: 'In the method', expressionId: 'in' as ExternalId, stack: [] },
    { kind: 'Warning', message: 'Outside', expressionId: 'out' as ExternalId, stack: [] },
    { kind: 'Warning', message: 'No position', stack: [] },
    {
      kind: 'Error',
      message: 'By location',
      location: { start: { line: 6, character: 0 }, end: { line: 6, character: 3 } },
      stack: [],
    },
    {
      kind: 'Error',
      message: 'By location outside',
      location: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
      stack: [],
    },
  ]
  const result = parse(await getProblems(f.deps))
  expect(CODE.slice(0, rangeOf('b = a * 2').from).split('\n').length).toBe(7)
  expect(METHOD_TEXT.startsWith('main =')).toBe(true)
  expect(result.diagnostics).toEqual([
    { kind: 'error', message: 'In the method', line: 7 },
    { kind: 'warning', message: 'No position' },
    { kind: 'error', message: 'By location', line: 7 },
  ])
})

test('a diagnostic about another module is left out', async () => {
  const f = makeDeps({ isThisModule: (path) => path?.segments.at(-1) === 'Main.enso' })
  f.diagnostics.value = [
    {
      kind: 'Error',
      message: 'Elsewhere',
      path: { rootId: 'r', segments: ['src', 'Other.enso'] },
      stack: [],
    },
    {
      kind: 'Error',
      message: 'Here',
      path: { rootId: 'r', segments: ['src', 'Main.enso'] },
      stack: [],
    },
  ]
  const result = parse(await getProblems(f.deps))
  expect(result.diagnostics.map((d) => d.message)).toEqual(['Here'])
})

test('at most the diagnostics limit is listed', async () => {
  const f = makeDeps()
  f.diagnostics.value = Array.from({ length: PROBLEM_DIAGNOSTICS_MAX + 5 }, (_, i) => ({
    kind: 'Warning' as const,
    message: `m${i}`,
    stack: [],
  }))
  const result = parse(await getProblems(f.deps))
  expect(result.diagnostics).toHaveLength(PROBLEM_DIAGNOSTICS_MAX)
  expect(result.diagnostics_truncated).toBe(true)
})

test('an unreadable method is an error', async () => {
  const f = makeDeps()
  const result = await getProblems({
    ...f.deps,
    currentMethod: { ast: Err('No method.'), pointer: Ok(pointer) },
  })
  expect(result).toEqual({ ok: false, error: 'No method.' })
})
