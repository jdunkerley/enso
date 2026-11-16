/** @file When what the date and time widgets write is parenthesised. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import { parenthesisedApplication, unparenthesisedCode } from '../parentheses'

/** The node of the parsed block `code` whose code is `subject`; the outermost one. */
function find(code: string, subject: string): Ast.Ast {
  const root = Ast.parseBlock(code)
  let found: Ast.Ast | undefined
  Ast.visitRecursive(root, (ast) => {
    if (found == null && ast.code() === subject) found = ast
    return found == null
  })
  return found!
}

const NEW = 'Date.new 2020 1 15'

describe('parenthesisedApplication', () => {
  const portOf = (ast: Ast.Ast) => ast.id as WidgetInput['portId']

  test('an argument is parenthesised', () => {
    const ast = find('x = foo Date.today', 'Date.today')
    expect(parenthesisedApplication(NEW, ast, portOf(ast))).toBe(`(${NEW})`)
  })

  test('a group is replaced with its parentheses, so the code keeps them', () => {
    const inner = find(`x = foo (${NEW})`, NEW)
    const group = inner.parent()!
    expect(group).toBeInstanceOf(Ast.Group)
    expect(parenthesisedApplication(NEW, inner, portOf(group))).toBe(`(${NEW})`)
  })

  test('an operand is parenthesised', () => {
    const ast = find(`x = a + (${NEW})`, NEW)
    expect(parenthesisedApplication(NEW, ast, portOf(ast.parent()!))).toBe(`(${NEW})`)
  })

  test('an unset argument has no AST and is parenthesised', () => {
    expect(parenthesisedApplication(NEW, undefined, 'p' as WidgetInput['portId'])).toBe(`(${NEW})`)
  })

  test('a vector item and a whole node are bare', () => {
    const item = find(`x = [${NEW}, 1]`, NEW)
    expect(parenthesisedApplication(NEW, item, portOf(item))).toBe(NEW)
    const root = find(`x = ${NEW}`, NEW)
    expect(parenthesisedApplication(NEW, root, portOf(root))).toBe(NEW)
  })
})

describe('unparenthesisedCode', () => {
  test.each([
    [`x = foo (${NEW})`, `(${NEW})`, NEW],
    [`x = foo ((${NEW}))`, `((${NEW}))`, NEW],
    ['x = foo Date.today', 'Date.today', 'Date.today'],
  ])('%s', (code, subject, expected) => {
    expect(unparenthesisedCode(WidgetInput.FromAst(find(code, subject)))).toBe(expected)
  })

  test('an unset argument has its default, as code', () => {
    const input = { portId: 'p' as WidgetInput['portId'], value: 'Date.today' }
    expect(unparenthesisedCode(input)).toBe('Date.today')
  })
})
