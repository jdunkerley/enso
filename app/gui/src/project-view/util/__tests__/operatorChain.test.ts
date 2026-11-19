import { Ast } from '@/util/ast'
import { visitRecursive } from '@/util/ast/abstract'
import { expect, test } from 'vitest'
import { chainRole, isCapsuledGroup } from '../operatorChain'

function find<T extends Ast.Ast>(
  code: string,
  sub: string,
  type: abstract new (...args: any[]) => T,
): T {
  const root = Ast.parseExpression(code)!
  let found: T | undefined
  visitRecursive(root, (ast) => {
    if (ast instanceof type && ast.code() === sub) found = ast
    return true
  })
  expect(found, `${sub} in ${code}`).toBeDefined()
  return found!
}

test.each([
  ['a + b + c', 'a + b + c', 'root'],
  ['a + b + c', 'a + b', 'continue'],
  ['a + b - c', 'a + b', 'continue'],
  ['a * b + c', 'a * b', 'capsule'],
  ['a + b * c', 'b * c', 'capsule'],
  ['a > 0 && b == 1', 'a > 0', 'capsule'],
  ['a > 0 && b == 1', 'b == 1', 'capsule'],
  ['(a + b) + c', 'a + b', 'capsule'],
  ['a + (b + c)', 'b + c', 'capsule'],
  ['a+b * c', 'b * c', 'capsule'],
  ['a+b - c', 'a+b - c', 'root'],
  ['f <| g <| x', 'g <| x', 'continue'],
  ['x.foo (a + b)', 'a + b', 'root'],
  ['x.foo a+b', 'a+b', 'root'],
] as const)('%s: %s is %s', (code, sub, role) => {
  expect(chainRole(find(code, sub, Ast.OprApp))).toBe(role)
})

test('a group is capsuled only when its chain is', () => {
  expect(isCapsuledGroup(find('(a + b) * c', '(a + b)', Ast.Group))).toBe(true)
  expect(isCapsuledGroup(find('x.foo (a + b)', '(a + b)', Ast.Group))).toBe(false)
  expect(isCapsuledGroup(find('(a) + b', '(a)', Ast.Group))).toBe(false)
})
