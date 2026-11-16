/**
 * @file When the code the date and time-of-day widgets write needs parentheses.
 */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { Ast } from '@/util/ast'

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

/** The code of the input's value, without the parentheses around it: `(Date.new 2020 1 15)` is a date. */
export function unparenthesisedCode(input: WidgetInput): string | undefined {
  let value = input.value
  while (value instanceof Ast.Group && value.expression) value = value.expression
  return value instanceof Ast.Ast ? value.code() : WidgetInput.valueRepr(input)
}
