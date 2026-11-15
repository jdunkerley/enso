/* eslint-disable camelcase -- tool names and argument names are snake_case on the wire */
import { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import { stdPath } from '@/util/projectPath'
import type { Identifier } from '@/util/qualifiedName'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test, vi } from 'vitest'
import { watchEffect } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { evaluateExpression } from '../evaluate'

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
  return {
    deps: { db, currentMethod: { ast: Ok(func), pointer: Ok(pointer) }, evaluateRaw },
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
