/**
 * @file What the date and time-of-day chips share about the code they show and write: when an
 * expression is a value to pick (and not the target of a call), and when what they write needs
 * parentheses.
 */
import type { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'

/**
 * Whether the expression is a shape the chip shows (`parse` recognises its code), and nothing is
 * built on it. `Date.today.add_days 3` and `Date.today + x` have a shape's code inside them, but
 * their `Date.today` is the target of a call, not a value to pick: the chip would replace the target.
 */
export function isPickableShape(ast: Ast.Ast, parse: (code: string) => unknown): boolean {
  if (!(ast instanceof Ast.App || ast instanceof Ast.PropertyAccess)) return false
  if (parse(ast.code()) == null) return false
  const parent = ast.parent()
  if (parent instanceof Ast.PropertyAccess) return parent.lhs?.id !== ast.id
  if (parent instanceof Ast.App) return parent.function.id !== ast.id
  if (parent instanceof Ast.OprApp) return parent.lhs?.id !== ast.id
  return true
}

/**
 * The code of an application (`Date.new 2020 1 15`), as it is written in place of `current`: where it
 * becomes an argument (an unset argument, or a value that is itself an argument or an operand) it
 * needs its parentheses. As a string the new code is parsed in place, and an application inserted
 * unparenthesised there is split into one group per argument. Inside parentheses already, or on its
 * own, it is bare.
 */
export function parenthesisedApplication(code: string, current: WidgetInput['value']): string {
  const parent = current instanceof Ast.Ast ? current.parent() : undefined
  const needsParens =
    !(current instanceof Ast.Ast) || parent instanceof Ast.App || parent instanceof Ast.OprApp
  return needsParens ? `(${code})` : code
}
