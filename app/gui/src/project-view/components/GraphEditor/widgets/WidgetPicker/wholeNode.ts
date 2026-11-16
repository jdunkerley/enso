/**
 * @file Recognising the date and time-of-day widgets' own expressions when they are a whole node.
 */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'

/** Whether the expression is the whole expression of a node (parentheses around it do not count). */
export function isNodeRoot(ast: Ast.Ast): boolean {
  let parent = ast.parent()
  while (parent instanceof Ast.Group) parent = parent.parent()
  return parent instanceof Ast.Assignment || parent instanceof Ast.ExpressionStatement
}

/**
 * Whether the input is a node's whole expression, and one of the given calls: `bare` are the
 * property accesses taken as they are (`Date.today`), `applied` are callees taking any arguments,
 * whatever they are and however many (`Date.new yr 1 15`). Only the expression that is the node's
 * own counts: `Date.today` inside `Date.today.add_days 3` does not.
 */
export function isWholeNodeCall(
  input: WidgetInput,
  shapes: { bare: readonly string[]; applied: readonly string[] },
): boolean {
  let ast = input.value
  if (!(ast instanceof Ast.Ast) || !isNodeRoot(ast)) return false
  if (!(ast instanceof Ast.App)) return shapes.bare.includes(ast.code())
  while (ast instanceof Ast.App) ast = ast.function
  return shapes.applied.includes(ast.code())
}
