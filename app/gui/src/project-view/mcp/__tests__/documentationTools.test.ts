import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import {
  DOCUMENTATION_CHARS,
  getDocumentation,
  setDocumentation,
  type SetDocumentationDeps,
} from '../documentationTools'
import { EditSession, LIVE_EDIT_ERROR, type EditOutcome, type EditRunOptions } from '../editSession'
import { METHOD_CHANGED_ERROR } from '../editTools'
import { NO_METHOD_ERROR } from '../viewTools'

const CODE = `## Adds two numbers.
main =
    a = 1 + 2
    a`

const pointer: MethodPointer = {
  module: stdPath('Standard.Base.Main'),
  definedOnType: stdPath('Standard.Base.Main'),
  name: 'main' as Identifier,
}

const caller = { kind: 'external', name: 'claude-code' } as const
const DEADLINE = 123_456

/** A session that runs each edit at once, counting the runs and recording what `unchanged` said. */
function fakeSession(onRun: () => void = () => {}) {
  const session = {
    runs: 0,
    deadlines: [] as (number | undefined)[],
    unchanged: [] as (boolean | undefined)[],
    async run<T>(
      _caller: unknown,
      edit: () => Result<T> | Promise<Result<T>>,
      options?: EditRunOptions<T>,
    ) {
      session.runs += 1
      session.deadlines.push(options?.deadline)
      onRun()
      const result = await edit()
      if (!result.ok) return result
      session.unchanged.push(options?.unchanged?.(result.value))
      return Ok<EditOutcome<T>>({ value: result.value, settled: true })
    },
  }
  return session
}

function makeDeps(overrides: Partial<SetDocumentationDeps> = {}) {
  const { root } = Ast.parseUpdatingIdMap(CODE)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  const editModule = vi.fn(<T>(f: (edit: Ast.MutableModule) => Result<T>) => f(root.module))
  const deps: SetDocumentationDeps = {
    db: GraphDb.Mock(),
    currentMethod: { ast: Ok(func), pointer: Ok(pointer) },
    session: fakeSession(),
    caller,
    deadline: DEADLINE,
    editModule,
    ...overrides,
  }
  return { deps, func, editModule }
}

function valueOf(result: McpToolResult) {
  assert(result.ok, `expected ok, got ${result.ok ? '' : result.error}`)
  return JSON.parse(result.value)
}

function errorOf(result: McpToolResult): string {
  assert(!result.ok, 'expected an error')
  return result.error
}

test('get_documentation reads the Markdown of the method on screen', async () => {
  const { deps } = makeDeps()
  expect(valueOf(await getDocumentation(deps))).toEqual({
    method: 'main',
    text: 'Adds two numbers.',
    truncated: false,
  })
})

test(`get_documentation gives at most ${DOCUMENTATION_CHARS} characters, then says it cut them`, async () => {
  const { deps, func } = makeDeps()
  const markdown = func.mutableDocumentationMarkdown()
  markdown.delete(0, markdown.length)
  markdown.insert(0, 'x'.repeat(DOCUMENTATION_CHARS + 1))
  const long = valueOf(await getDocumentation(deps))
  expect(long.text).toBe('x'.repeat(DOCUMENTATION_CHARS))
  expect(long.truncated).toBe(true)
  markdown.delete(DOCUMENTATION_CHARS, 1)
  const exact = valueOf(await getDocumentation(deps))
  expect(exact.text).toHaveLength(DOCUMENTATION_CHARS)
  expect(exact.truncated).toBe(false)
})

test('with no method on screen, both tools answer the editor shows none', async () => {
  const { deps } = makeDeps({
    currentMethod: { ast: Err('No current method'), pointer: Err('No current method') },
  })
  expect(errorOf(await getDocumentation(deps))).toBe(NO_METHOD_ERROR)
  expect(errorOf(await setDocumentation(deps, { text: 'New' }))).toBe(NO_METHOD_ERROR)
  expect(NO_METHOD_ERROR).toBe('The graph editor shows no method now. Call get_graph.')
})

test('set_documentation replaces the whole text in one edit of one session run', async () => {
  const session = fakeSession()
  const { deps, func, editModule } = makeDeps({ session })
  const text = '# Totals\n\nAdds *two* numbers.\n\n![chart](images/chart.png)'
  expect(valueOf(await setDocumentation(deps, { text }))).toEqual({
    method: 'main',
    characters: text.length,
    settled: true,
  })
  expect(func.mutableDocumentationMarkdown().toJSON()).toBe(text)
  expect(valueOf(await getDocumentation(deps)).text).toBe(text)
  expect(session.runs).toBe(1)
  expect(session.deadlines).toEqual([DEADLINE])
  // A real edit: the session waits for the graph update.
  expect(session.unchanged).toEqual([false])
  expect(editModule).toHaveBeenCalledTimes(1)
})

test('set_documentation with an empty text clears it', async () => {
  const { deps, func } = makeDeps()
  expect(valueOf(await setDocumentation(deps, { text: '' }))).toEqual({
    method: 'main',
    characters: 0,
    settled: true,
  })
  expect(func.mutableDocumentationMarkdown().toJSON()).toBe('')
})

test('set_documentation with the text as it is at its turn makes no module edit', async () => {
  const session = fakeSession()
  const { deps, editModule } = makeDeps({ session })
  const text = 'Adds two numbers.'
  expect(valueOf(await setDocumentation(deps, { text }))).toEqual({
    method: 'main',
    characters: text.length,
    settled: true,
    unchanged: true,
  })
  // Compared at the edit's turn, inside the session's run, which answers without waiting.
  expect(session.runs).toBe(1)
  expect(session.unchanged).toEqual([true])
  expect(editModule).not.toHaveBeenCalled()
})

/** A real session, in Design or Live mode, whose watches resolve at once. */
function realSession(live: boolean, saveVersion: () => Promise<void> = async () => {}) {
  return new EditSession({
    isLive: () => live,
    isActive: () => true,
    holdUndoStep: () => () => {},
    onForeignEdit: () => () => {},
    historyDepth: () => ({ undo: 0, redo: 0 }),
    undo: () => false,
    redo: () => false,
    enablesOutput: () => false,
    saveVersion,
    watchGraphUpdate: () => ({ updated: async () => true, cancel: () => {} }),
    watchExecution: () => ({ editApplied: () => {}, settled: async () => true, cancel: () => {} }),
    now: () => 0,
    setTimeout: () => undefined,
    clearTimeout: () => {},
  })
}

test('two calls at once: the second compares with the text the first left, and writes', async () => {
  const { deps, func } = makeDeps({ session: realSession(false) })
  const original = 'Adds two numbers.'
  const first = setDocumentation(deps, { text: 'X' })
  const second = setDocumentation(deps, { text: original })
  expect(valueOf(await first)).toEqual({ method: 'main', characters: 1, settled: true })
  expect(valueOf(await second)).toEqual({
    method: 'main',
    characters: original.length,
    settled: true,
  })
  expect(func.mutableDocumentationMarkdown().toJSON()).toBe(original)
})

test('the current text saves no version; a real change does', async () => {
  const saveVersion = vi.fn(async () => {})
  const { deps } = makeDeps({ session: realSession(false, saveVersion) })
  const text = 'Adds two numbers.'
  expect(valueOf(await setDocumentation(deps, { text }))).toEqual({
    method: 'main',
    characters: text.length,
    settled: true,
    unchanged: true,
  })
  expect(saveVersion).not.toHaveBeenCalled()
  expect(valueOf(await setDocumentation(deps, { text: 'New' })).unchanged).toBeUndefined()
  expect(saveVersion).toHaveBeenCalledTimes(1)
})

test('in Live mode the current text is refused like any other', async () => {
  const { deps, editModule } = makeDeps({ session: realSession(true) })
  expect(errorOf(await setDocumentation(deps, { text: 'Adds two numbers.' }))).toBe(LIVE_EDIT_ERROR)
  expect(editModule).not.toHaveBeenCalled()
})

test("set_documentation passes on the session's refusal, and changes nothing", async () => {
  const { deps, func, editModule } = makeDeps({ session: realSession(true) })
  expect(errorOf(await setDocumentation(deps, { text: 'New' }))).toBe(LIVE_EDIT_ERROR)
  expect(editModule).not.toHaveBeenCalled()
  expect(func.mutableDocumentationMarkdown().toJSON()).toBe('Adds two numbers.')
})

test('set_documentation is refused when the method on screen changed before its turn', async () => {
  const other: MethodPointer = { ...pointer, name: 'other' as Identifier }
  const fixture: { deps?: SetDocumentationDeps } = {}
  const made = makeDeps({
    session: fakeSession(() => {
      fixture.deps!.currentMethod.pointer = Ok(other)
    }),
  })
  fixture.deps = made.deps
  expect(errorOf(await setDocumentation(made.deps, { text: 'New' }))).toBe(METHOD_CHANGED_ERROR)
  expect(made.editModule).not.toHaveBeenCalled()
  expect(made.func.mutableDocumentationMarkdown().toJSON()).toBe('Adds two numbers.')
})
