/* eslint-disable camelcase -- tool names and argument names are snake_case on the wire */
import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { describe, expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { EVALUATE_RESULT_CHARS, LIVE_MODE_ERROR, evaluateExpression } from '../evaluate'
import { WRITE_REFUSED_ERROR } from '../writeGuard'
import { ENABLING_EXPRESSIONS, HARMLESS_EXPRESSIONS } from './outputEnablingCode'

const CODE = `main =
    a = 1 + 2
    a`

function makeDeps() {
  const db = GraphDb.Mock()
  const { root, getSpan } = Ast.parseUpdatingIdMap(CODE)
  const func = [...root.statements()].find((s) => s instanceof Ast.FunctionDef)
  assert(func instanceof Ast.MutableFunctionDef)
  db.updateExternalIds(root)
  db.updateNodes(func, { watchEffect })
  db.updateBindings(func, { text: CODE, getSpan })
  const pointer: MethodPointer = {
    module: stdPath('Standard.Base.Main'),
    definedOnType: stdPath('Standard.Base.Main'),
    name: 'main' as Identifier,
  }
  const evaluateRaw = vi.fn<
    (scope: ExternalId, expression: string) => Promise<Result<string> | null>
  >(async () => Ok('3'))
  const isLive = vi.fn(() => false)
  return {
    deps: { db, currentMethod: { ast: Ok(func), pointer: Ok(pointer) }, evaluateRaw, isLive },
    isLive,
    db,
    func,
    evaluateRaw,
  }
}

test('Without a node, the expression runs in the scope of the method body', async () => {
  const { deps, func, evaluateRaw } = makeDeps()
  const result = await evaluateExpression(deps, { expression: 'a.to_text' })
  expect(result).toEqual({ ok: true, value: '3' })
  expect(evaluateRaw).toHaveBeenCalledWith(func.body!.externalId, 'a.to_text')
})

test("With a node, the expression runs in the scope of the node's statement", async () => {
  const { deps, db, evaluateRaw } = makeDeps()
  const id = db.getIdentDefiningNode('a')!
  await evaluateExpression(deps, { expression: 'a.to_text', node_id: id })
  expect(evaluateRaw).toHaveBeenCalledWith(
    db.nodeIdToNode.get(id)!.outerAst.externalId,
    'a.to_text',
  )
})

test('An unknown node is reported without evaluating', async () => {
  const { deps, evaluateRaw } = makeDeps()
  const result = await evaluateExpression(deps, { expression: '1', node_id: 'nope' })
  expect(result).toEqual({
    ok: false,
    error: 'No node with id nope in the method on screen. Call get_graph for the current ids.',
  })
  expect(evaluateRaw).not.toHaveBeenCalled()
})

test('A non-Text result gets the hint about converting to Text', async () => {
  const { deps, evaluateRaw } = makeDeps()
  evaluateRaw.mockResolvedValue(Err('Cannot encode class X to byte array.'))
  const result = await evaluateExpression(deps, { expression: 'a' })
  assert(!result.ok)
  expect(result.error).toContain('Expression must evaluate to Text')
  expect(result.error).toContain('`X`')
})

test('No result means the project is still loading', async () => {
  const { deps, evaluateRaw } = makeDeps()
  evaluateRaw.mockResolvedValue(null)
  expect(await evaluateExpression(deps, { expression: 'a' })).toEqual({
    ok: false,
    error: 'The project is still loading. Try again in a moment.',
  })
})

test('A long result is cut, with a line saying how long it was', async () => {
  const { deps, evaluateRaw } = makeDeps()
  evaluateRaw.mockResolvedValue(Ok('r'.repeat(30_000)))
  const result = await evaluateExpression(deps, { expression: 'table.to_text' })
  assert(result.ok)
  expect(result.value.startsWith('r'.repeat(EVALUATE_RESULT_CHARS) + '\n')).toBe(true)
  expect(result.value.slice(EVALUATE_RESULT_CHARS)).toBe(
    '\n… [truncated: 30000 characters in total. Narrow the expression, e.g. with .take or a row limit.]',
  )
})

test('A short result is returned as it is', async () => {
  const { deps, evaluateRaw } = makeDeps()
  evaluateRaw.mockResolvedValue(Ok('r'.repeat(EVALUATE_RESULT_CHARS)))
  expect(await evaluateExpression(deps, { expression: 'a' })).toEqual({
    ok: true,
    value: 'r'.repeat(EVALUATE_RESULT_CHARS),
  })
})

test('A long error is cut to 2,000 characters', async () => {
  const { deps, evaluateRaw } = makeDeps()
  evaluateRaw.mockResolvedValue(Err('x'.repeat(5_000)))
  expect(await evaluateExpression(deps, { expression: 'a' })).toEqual({
    ok: false,
    error: 'x'.repeat(2_000) + '…',
  })
})

test('In Live mode the expression is refused before anything is evaluated', async () => {
  const { deps, evaluateRaw, isLive } = makeDeps()
  isLive.mockReturnValue(true)
  expect(await evaluateExpression(deps, { expression: '"x".write "out.txt"' })).toEqual({
    ok: false,
    error:
      'The project is in Live mode, and evaluate_expression runs only in Design. ' +
      'Ask the user to switch the project back to Design.',
  })
  expect(LIVE_MODE_ERROR).toBe(
    'The project is in Live mode, and evaluate_expression runs only in Design. Ask the user to switch the project back to Design.',
  )
  expect(evaluateRaw).not.toHaveBeenCalled()
})

test('The mode is read at call time: in Design the same expression runs', async () => {
  const { deps, evaluateRaw, isLive } = makeDeps()
  isLive.mockReturnValueOnce(true)
  assert(!(await evaluateExpression(deps, { expression: 'a.to_text' })).ok)
  expect(await evaluateExpression(deps, { expression: 'a.to_text' })).toEqual({
    ok: true,
    value: '3',
  })
  expect(evaluateRaw).toHaveBeenCalledOnce()
  expect(isLive).toHaveBeenCalledTimes(2)
})

describe('code that turns the output context on', () => {
  test.each(ENABLING_EXPRESSIONS)('is refused before anything is evaluated: %s', async (code) => {
    const { deps, evaluateRaw } = makeDeps()
    expect(await evaluateExpression(deps, { expression: code })).toEqual({
      ok: false,
      error: WRITE_REFUSED_ERROR,
    })
    expect(evaluateRaw).not.toHaveBeenCalled()
  })

  test('is refused in a node scope and in a block of several lines', async () => {
    const { deps, db, evaluateRaw } = makeDeps()
    const id = db.getIdentDefiningNode('a')!
    const nested = `x = 1\n${ENABLING_EXPRESSIONS[0]}`
    expect(await evaluateExpression(deps, { expression: nested, node_id: id })).toEqual({
      ok: false,
      error: WRITE_REFUSED_ERROR,
    })
    expect(evaluateRaw).not.toHaveBeenCalled()
  })

  test.each(HARMLESS_EXPRESSIONS)('similar names are evaluated: %s', async (code) => {
    const { deps, evaluateRaw } = makeDeps()
    expect((await evaluateExpression(deps, { expression: code })).ok).toBe(true)
    expect(evaluateRaw).toHaveBeenCalledWith(expect.anything(), code)
  })
})
