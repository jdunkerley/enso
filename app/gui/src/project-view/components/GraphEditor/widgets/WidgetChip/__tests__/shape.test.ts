/** @file Which expressions the chips take (never a whole node) and when what they write is parenthesised. */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import { parseDateExpression } from '../../WidgetDate/dateExpression'
import { isPickableShape, parenthesisedApplication } from '../shape'

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

describe('isPickableShape', () => {
  test.each([
    [`date1 = ${NEW}`, NEW],
    [NEW, NEW],
    [`date1 = (${NEW})`, NEW],
    ['date1 = Date.today', 'Date.today'],
    ['t = Time_Of_Day.now', 'Time_Of_Day.now'],
  ])('a whole node is not a chip: %s', (code, subject) => {
    const parse = subject.startsWith('Date') ? parseDateExpression : () => ({})
    expect(isPickableShape(find(code, subject), parse)).toBe(false)
  })

  test.each([
    [`x = foo (${NEW})`, NEW],
    [`x = foo Date.today`, 'Date.today'],
    [`x = [${NEW}, ${NEW}]`, NEW],
    [`x = a + Date.today`, 'Date.today'],
  ])('an argument, an operand or an item is: %s', (code, subject) => {
    expect(isPickableShape(find(code, subject), parseDateExpression)).toBe(true)
  })
})

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
