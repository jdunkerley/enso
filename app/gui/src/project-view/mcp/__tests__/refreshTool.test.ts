import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import { LIVE_EDIT_ERROR, type EditOutcome, type EditRunOptions } from '../editSession'
import { UNSETTLED_NOTE } from '../editTools'
import {
  LIVE_REFRESH_ERROR,
  NO_MODULE_ERROR,
  WRITE_ON_REFRESH_ERROR,
  refreshTool,
  type RefreshToolDeps,
} from '../refreshTool'
import { WRITE_PREFIX } from './outputEnablingCode'

const caller = { kind: 'external', name: 'claude-code' } as const
const DEADLINE = 123_456

const CODE = `import Standard.Base.Data.Numbers

main =
    a = 1 + 2
    b = a * 2
    b`

/**
 * Code that really writes on the current engine, in another function of the module than the one on
 * screen: `with_enabled_context` takes two parameters, the context and the action.
 */
const CODE_WITH_ENABLING_FUNCTION = `import Standard.Base.Data.Numbers

other p =
    Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output <| "x".write p

main =
    a = 1 + 2
    a`

/** The method form, which really writes too, in a node of the method on screen. */
const CODE_WITH_ENABLING_METHOD = `import Standard.Base.Data.Numbers

main =
    a = 1 + 2
    w = Standard.Base.Runtime.Context.Output.with_enabled <| "x".write "x.txt"
    a`

/** A node with the GUI's Write prefix (`util/ast/node.ts`), in another function of the module. */
const CODE_WITH_WRITE_PREFIX_NODE = `import Standard.Base.Data.Numbers

other =
    w = ${WRITE_PREFIX}"x".write "x.txt"
    w

main =
    a = 1 + 2
    a`

/** A node with the GUI's Write prefix in the method on screen. */
const CODE_WITH_WRITE_PREFIX_NODE_ON_SCREEN = `import Standard.Base.Data.Numbers

main =
    a = 1 + 2
    w = ${WRITE_PREFIX}"x".write "x.txt"
    a`

const CODE_WITH_ARGUMENT = `import Standard.Base.Data.Numbers

main x =
    y = x * 3
    y`

function makeDeps(
  overrides: Partial<RefreshToolDeps> = {},
  {
    code = CODE,
    settled = true,
    beforeTurn = () => {},
  }: { code?: string; settled?: boolean; beforeTurn?: () => void } = {},
) {
  const db = GraphDb.Mock(undefined, undefined, mockProjectNameStore())
  const { root } = Ast.parseUpdatingIdMap(code)
  const func = [...root.statements()].find(
    (s) => s instanceof Ast.FunctionDef && s.name.code() === 'main',
  )
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  const recompute = vi.fn<RefreshToolDeps['executionContext']['recompute']>()
  const runOptions: EditRunOptions<readonly string[]>[] = []
  /** What each action returned: the ids the refresh waits for. */
  const actionValues: unknown[] = []
  const session: RefreshToolDeps['session'] = {
    async runUnstepped<T>(
      _caller: unknown,
      action: () => Result<T> | Promise<Result<T>>,
      options: EditRunOptions<T> = {},
    ): Promise<Result<EditOutcome<T>>> {
      // The action runs at the session's turn, which is later than the call.
      await Promise.resolve()
      beforeTurn()
      runOptions.push(options as EditRunOptions<readonly string[]>)
      const result = await action()
      if (result.ok) actionValues.push(result.value)
      return result.ok ? Ok({ value: result.value, settled }) : result
    },
  }
  const deps: RefreshToolDeps = {
    session,
    caller,
    deadline: DEADLINE,
    isLive: () => false,
    db,
    moduleRoot: () => root,
    executionContext: { recompute },
    ...overrides,
  }
  return { deps, db, recompute, runOptions, actionValues }
}

function valueOf(result: McpToolResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return JSON.parse(result.value) as Record<string, unknown>
}

function errorOf(result: McpToolResult): string {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

test('recomputes everything with exactly one argument, "all", and nothing else', async () => {
  const { deps, recompute } = makeDeps()
  expect(valueOf(await refreshTool(deps))).toEqual({ refreshed: true, settled: true })
  expect(recompute).toHaveBeenCalledTimes(1)
  // Not an environment, not per-expression configs: the arguments are exactly ['all'].
  expect(recompute.mock.calls[0]).toEqual(['all'])
  expect(recompute.mock.calls[0]).toHaveLength(1)
})

test('settles on the computed nodes of the method on screen, as changed', async () => {
  const { deps, db, runOptions } = makeDeps()
  await refreshTool(deps)
  const ids = [...db.nodeIdToNode.entries()]
    .filter(([, node]) => node.type === 'component')
    .map(([id]) => id)
  expect(ids.length).toBeGreaterThan(0)
  expect(runOptions).toHaveLength(1)
  expect(runOptions[0]?.deadline).toBe(DEADLINE)
  const affected = runOptions[0]?.affected?.(ids)
  expect(affected).toEqual({ changed: ids })
})

test('leaves out the input and output nodes, which the engine does not report on', async () => {
  const { deps, db, actionValues } = makeDeps({}, { code: CODE_WITH_ARGUMENT })
  await refreshTool(deps)
  const all = [...db.nodeIdToNode.values()]
  expect(all.some((node) => node.type === 'input')).toBe(true)
  expect(all.some((node) => node.type === 'output')).toBe(true)
  const components = [...db.nodeIdToNode.entries()]
    .filter(([, node]) => node.type === 'component')
    .map(([id]) => id)
  expect(components).toHaveLength(1)
  expect(actionValues).toEqual([components])
})

test('does not wait for a graph update, which a refresh never causes', async () => {
  const { deps, runOptions } = makeDeps()
  await refreshTool(deps)
  expect(runOptions[0]?.awaitsGraphUpdate).toBe(false)
})

test('an unsettled refresh says so', async () => {
  const { deps } = makeDeps({}, { settled: false })
  expect(valueOf(await refreshTool(deps))).toEqual({
    refreshed: true,
    settled: false,
    note: UNSETTLED_NOTE,
  })
})

test('Live mode is refused with its own sentence, before the session is used', async () => {
  const runUnstepped = vi.fn()
  const { deps, recompute } = makeDeps({
    isLive: () => true,
    session: { runUnstepped },
  })
  expect(errorOf(await refreshTool(deps))).toBe(LIVE_REFRESH_ERROR)
  expect(LIVE_REFRESH_ERROR).not.toBe(LIVE_EDIT_ERROR)
  expect(runUnstepped).not.toHaveBeenCalled()
  expect(recompute).not.toHaveBeenCalled()
})

test('Live mode that begins while the call waits for its turn is refused, nothing called', async () => {
  let live = false
  const { deps, recompute } = makeDeps(
    { isLive: () => live },
    {
      beforeTurn: () => {
        live = true
      },
    },
  )
  expect(errorOf(await refreshTool(deps))).toBe(LIVE_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test.each([
  ['with_enabled_context in another function', CODE_WITH_ENABLING_FUNCTION],
  ['Context.Output.with_enabled in a node on screen', CODE_WITH_ENABLING_METHOD],
  ['a node with the Write prefix in another function', CODE_WITH_WRITE_PREFIX_NODE],
])('code that enables output (%s) refuses, nothing called', async (_name, code) => {
  const { deps, recompute } = makeDeps({}, { code })
  expect(errorOf(await refreshTool(deps))).toBe(WRITE_ON_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('a node with the Write prefix in the method on screen refuses, as the module check', async () => {
  const { deps, db, recompute } = makeDeps({}, { code: CODE_WITH_WRITE_PREFIX_NODE_ON_SCREEN })
  // The node database sees the prefix too; the module check alone refuses it.
  expect([...db.nodeIdToNode.values()].some((node) => node.prefixes.enableRecording != null)).toBe(
    true,
  )
  expect(errorOf(await refreshTool(deps))).toBe(WRITE_ON_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('code that enables output added while the call waited for its turn refuses', async () => {
  const later = Ast.parseUpdatingIdMap(CODE_WITH_ENABLING_FUNCTION).root
  let root: Ast.Ast = Ast.parseUpdatingIdMap(CODE).root
  const { deps, recompute } = makeDeps(
    { moduleRoot: () => root },
    {
      beforeTurn: () => {
        root = later
      },
    },
  )
  expect(errorOf(await refreshTool(deps))).toBe(WRITE_ON_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('a module that cannot be read refuses, nothing called', async () => {
  const { deps, recompute } = makeDeps({ moduleRoot: () => undefined })
  expect(errorOf(await refreshTool(deps))).toBe(NO_MODULE_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('a refusal by the session (Live backstop, off screen, closed) is passed on', async () => {
  const { deps, recompute } = makeDeps({
    session: { runUnstepped: async () => Err('The project is no longer on screen.') },
  })
  expect(errorOf(await refreshTool(deps))).toBe('The project is no longer on screen.')
  expect(recompute).not.toHaveBeenCalled()
})
