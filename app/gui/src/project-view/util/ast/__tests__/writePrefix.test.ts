import { assertDefined } from '@/util/assert'
import { Ast } from '@/util/ast'
import { nodeFromAst, prefixes } from '@/util/ast/node'
import { describe, expect, test } from 'vitest'

const WRITE = 'Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output'

// What `isRecordingOverridden`'s setter in `GraphNode.vue` does.
function toggle(line: string, on: boolean) {
  const ast = Ast.parseBlockStatement(line)
  assertDefined(ast)
  const edit = ast.module.edit()
  const node = nodeFromAst(ast, false)
  assertDefined(node)
  prefixes.value.modify(edit.getVersion(node.rootExpr), {
    enableRecording: on ? [] : undefined,
    enableRecordingLegacy: undefined,
  })
  return edit.getVersion(ast).code()
}

describe('Write prefix', () => {
  test('the current two-argument form is recognised', () => {
    const ast = Ast.parseBlockStatement(`x = ${WRITE} <| a + b`)
    assertDefined(ast)
    const node = nodeFromAst(ast, false)
    assertDefined(node)
    expect(node.prefixes.enableRecording).toBeDefined()
    expect(node.innerExpr.code()).toBe('a + b')
  })

  test('the legacy three-argument form is recognised', () => {
    const ast = Ast.parseBlockStatement(`x = ${WRITE} "design" <| a + b`)
    assertDefined(ast)
    const node = nodeFromAst(ast, false)
    assertDefined(node)
    expect(node.prefixes.enableRecording).toBeDefined()
    expect(node.innerExpr.code()).toBe('a + b')
  })

  test('a plain node has no Write prefix', () => {
    const ast = Ast.parseBlockStatement('x = a + b')
    assertDefined(ast)
    expect(nodeFromAst(ast, false)?.prefixes.enableRecording).toBeUndefined()
  })

  test('turning Write on writes the current form', () => {
    expect(toggle('x = a + b', true)).toBe(`x = ${WRITE} <| a + b`)
  })

  test('turning Write on keeps the current form unchanged', () => {
    expect(toggle(`x = ${WRITE} <| a + b`, true)).toBe(`x = ${WRITE} <| a + b`)
  })

  test('turning Write on replaces a legacy prefix with the current form', () => {
    expect(toggle(`x = ${WRITE} "design" <| a + b`, true)).toBe(`x = ${WRITE} <| a + b`)
  })

  test.each([`${WRITE} <| a + b`, `${WRITE} "design" <| a + b`])(
    'turning Write off removes %s',
    (e) => {
      expect(toggle(`x = ${e}`, false)).toBe('x = a + b')
    },
  )
})
