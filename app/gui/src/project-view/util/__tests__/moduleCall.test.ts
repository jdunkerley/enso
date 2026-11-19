import { Ast } from '@/util/ast'
import { MODULE_CALL, moduleCall } from '@/util/moduleCall'
import { expect, test } from 'vitest'

test('names only Standard.Base, so it compiles in a module that imports no other library', () => {
  const module = Ast.MutableModule.Transient()
  const call = moduleCall(module, 'Standard.Visualization.Tree', 'children', [
    Ast.parseExpression("['a', 3]", module)!,
    Ast.parseExpression('100', module)!,
  ])
  const code = Ast.OprApp.new(module, call, '<|', Ast.parseExpression('node1', module)!).code()
  expect(code).toBe(
    "Standard.Base.Meta.call_module_method 'Standard.Visualization.Tree' 'children' [['a', 3], 100] _ <| node1",
  )
  const { func, args } = Ast.analyzeAppLike(Ast.parseExpression(code)!)
  expect(func.code()).toBe(MODULE_CALL)
  expect(args.at(-1)?.code()).toBe('node1')
})
