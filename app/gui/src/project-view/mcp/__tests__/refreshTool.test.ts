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

const caller = { kind: 'external', name: 'claude-code' } as const
const DEADLINE = 123_456

const CODE = `import Standard.Base.Data.Numbers

main =
    a = 1 + 2
    b = a * 2
    b`

const CODE_WITH_ENABLING_FUNCTION = `import Standard.Base.Data.Numbers

other =
    Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output "design" <|
        1

main =
    a = 1 + 2
    a`

const CODE_WITH_ARGUMENT = `import Standard.Base.Data.Numbers

main x =
    y = x * 3
    y`

function makeDeps(
  overrides: Partial<RefreshToolDeps> = {},
  { code = CODE, settled = true, beforeTurn = () => {} } = {},
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

test('a node with Write on in the method refuses, nothing called', async () => {
  const { deps, db, recompute } = makeDeps({
    // The action runs at once: the node database would otherwise rebuild the node first.
    session: {
      async runUnstepped<T>(_caller: unknown, action: () => Result<T> | Promise<Result<T>>) {
        const result = await action()
        return result.ok ? Ok({ value: result.value, settled: true }) : result
      },
    },
  })
  const [id, node] = [...db.nodeIdToNode.entries()][0]!
  db.nodeIdToNode.set(id, { ...node, prefixes: { enableRecording: [] } })
  expect(errorOf(await refreshTool(deps))).toBe(WRITE_ON_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('a node that has Write switched on while the call waited for its turn refuses', async () => {
  const fixture: { db?: GraphDb } = {}
  const { deps, db, recompute } = makeDeps(
    {},
    {
      beforeTurn: () => {
        const [id, node] = [...fixture.db!.nodeIdToNode.entries()][0]!
        fixture.db!.nodeIdToNode.set(id, { ...node, prefixes: { enableRecording: [] } })
      },
    },
  )
  fixture.db = db
  expect(errorOf(await refreshTool(deps))).toBe(WRITE_ON_REFRESH_ERROR)
  expect(recompute).not.toHaveBeenCalled()
})

test('code in another function of the module that enables output refuses, nothing called', async () => {
  const { deps, recompute } = makeDeps({}, { code: CODE_WITH_ENABLING_FUNCTION })
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
