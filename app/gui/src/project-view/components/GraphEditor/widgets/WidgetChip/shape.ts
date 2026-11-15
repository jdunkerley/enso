/**
 * @file What the date and time-of-day chips share about the code they show and write: when an
 * expression is a value to pick (and not the target of a call, or a whole node), and when what they
 * write needs parentheses.
 */
import type { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'

/**
 * Whether the expression is a shape the chip shows (`parse` recognises its code), and nothing is
 * built on it. `Date.today.add_days 3` and `Date.today + x` have a shape's code inside them, but
 * their `Date.today` is the target of a call, not a value to pick: the chip would replace the target.
 *
 * A whole node is never a chip either: `date1 = Date.new 2020 1 15` keeps `WidgetFunction`'s fields,
 * which have ports an edge can connect to. The chip is for an argument, an operand that is not a call
 * target, and a vector item.
 */
export function isPickableShape(ast: Ast.Ast, parse: (code: string) => unknown): boolean {
  if (!(ast instanceof Ast.App || ast instanceof Ast.PropertyAccess)) return false
  if (parse(ast.code()) == null) return false
  if (isNodeRoot(ast)) return false
  const parent = ast.parent()
  if (parent instanceof Ast.PropertyAccess) return parent.lhs?.id !== ast.id
  if (parent instanceof Ast.App) return parent.function.id !== ast.id
  if (parent instanceof Ast.OprApp) return parent.lhs?.id !== ast.id
  return true
}

/** Whether the expression is the whole expression of a node (parentheses around it do not count). */
function isNodeRoot(ast: Ast.Ast): boolean {
  let parent = ast.parent()
  while (parent instanceof Ast.Group) parent = parent.parent()
  return parent instanceof Ast.Assignment || parent instanceof Ast.ExpressionStatement
}

/**
 * The code of an application (`Date.new 2020 1 15`), as it is written in place of what the port
 * `portId` names. The port is the value itself, or an ancestor of it: `WidgetGroup` hands its inner
 * expression on with the group's port, so writing there replaces the parentheses too. Where the
 * port's own parent takes arguments (an application or an operator) the code needs its parentheses:
 * as a string it is parsed in place, and an application inserted unparenthesised there is split into
 * one group per argument. An unset argument has no AST and is parenthesised. Anywhere else (a node's
 * expression, a vector item, inside parentheses already) it is bare.
 */
export function parenthesisedApplication(
  code: string,
  current: WidgetInput['value'],
  portId: WidgetInput['portId'],
): string {
  if (!(current instanceof Ast.Ast)) return `(${code})`
  let port: Ast.Ast | undefined = current
  while (port != null && port.id !== portId) port = port.parent()
  if (port == null) return `(${code})`
  const parent = port.parent()
  const bare =
    parent == null ||
    parent instanceof Ast.Assignment ||
    parent instanceof Ast.ExpressionStatement ||
    parent instanceof Ast.BodyBlock ||
    parent instanceof Ast.Group ||
    parent instanceof Ast.Vector
  return bare ? code : `(${code})`
}
