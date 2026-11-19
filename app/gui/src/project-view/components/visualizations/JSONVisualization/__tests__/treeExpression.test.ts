import { Ast } from '@/util/ast'
import { MODULE_CALL } from '@/util/moduleCall'
import { expect, test } from 'vitest'
import {
  childrenExpression,
  isNodeExpression,
  nodeExpressionPattern,
  TREE_MODULE,
} from '../treeExpression'

test('childrenExpression calls Tree.children through Standard.Base, on the node', () => {
  const ast = childrenExpression(['a', 3], 100, 50)('node1')
  const { func, args } = Ast.analyzeAppLike(ast)
  expect(func.code()).toBe(MODULE_CALL)
  expect(args.map((arg) => arg.code().replace(/\s/g, ''))).toEqual([
    `'${TREE_MODULE}'`,
    "'children'",
    "[['a',3],100,50]",
    'node1',
  ])
})

test('childrenExpression of the root passes an empty path', () => {
  const { args } = Ast.analyzeAppLike(childrenExpression([], 0, 100)('node1'))
  expect(args[2]!.code().replace(/\s/g, '')).toBe('[[],0,100]')
})

test('isNodeExpression accepts a method call and nothing else', () => {
  expect(isNodeExpression('.at 3')).toBe(true)
  expect(isNodeExpression(".get 'name'")).toBe(true)
  expect(isNodeExpression('.name')).toBe(true)
  expect(isNodeExpression('at 3')).toBe(false)
  expect(isNodeExpression('. at 3')).toBe(false)
  expect(isNodeExpression('')).toBe(false)
})

test('nodeExpressionPattern chains steps with the spaced dot', () => {
  const pattern = nodeExpressionPattern([".get 'tags'", '.at 3', '.name'])
  const source = Ast.parseExpression('data')!
  expect(pattern?.instantiateCopied([source]).code()).toBe("data.get 'tags' . at 3 . name")
})

test('nodeExpressionPattern of one step', () => {
  const pattern = nodeExpressionPattern(['.at 0'])
  expect(pattern?.instantiateCopied([Ast.parseExpression('data')!]).code()).toBe('data.at 0')
})

test('nodeExpressionPattern refuses an empty chain, a bad step or invalid code', () => {
  expect(nodeExpressionPattern([])).toBeUndefined()
  expect(nodeExpressionPattern(['at 3'])).toBeUndefined()
  expect(nodeExpressionPattern(['.at ('])).toBeUndefined()
})
