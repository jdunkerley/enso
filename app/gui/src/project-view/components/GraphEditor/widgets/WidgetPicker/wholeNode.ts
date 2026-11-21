/**
 * @file Recognising the date and time-of-day widgets' own expressions when they are a whole node.
 */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { isTypeDefault } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
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
export function isWholeNodeCall(input: WidgetInput, shapes: CallShapes): boolean {
  const ast = input.value
  return ast instanceof Ast.Ast && isNodeRoot(ast) && isCallOfShape(ast, shapes)
}

/** The calls a picker draws itself: see {@link isWholeNodeCall}. */
export interface CallShapes {
  bare: readonly string[]
  applied: readonly string[]
}

/** Whether the expression is one of the given calls, wherever it is (a node's own or an argument's value). */
export function isCallOfShape(ast: Ast.Ast, shapes: CallShapes): boolean {
  if (!(ast instanceof Ast.App)) return shapes.bare.includes(ast.code())
  let callee: Ast.Ast = ast
  while (callee instanceof Ast.App) callee = callee.function
  return shapes.applied.includes(callee.code())
}

/**
 * Whether a picker typed by `Date_Input` and the like claims the input. A configuration that came from
 * a type's default (and not from an annotation) claims only an unset argument or a call of its own
 * kind: a reference, `_`, `Nothing` or a vector keeps the widget that draws it.
 */
export function pickerClaimsInput(input: WidgetInput, ownCalls: CallShapes): boolean {
  if (!isTypeDefault(input.dynamicConfig)) return true
  if (WidgetInput.isPlaceholder(input)) return true
  return input.value instanceof Ast.Ast && isCallOfShape(input.value, ownCalls)
}
