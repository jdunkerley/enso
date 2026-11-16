/**
 * @file The parameters of a call that are not shown, for the `…` menu: unset arguments with a
 * default that the widget tree hides unless the node is being edited.
 */
import type { PortId } from '@/providers/portInfo'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentPlaceholder } from '@/util/callTree'

export interface HiddenParameter {
  /** The placeholder's port, the `origin` of the update that inserts it. */
  portId: PortId
  name: string
  /** The short type: the last segment of each union member, joined with ` | `. */
  type: string | undefined
  /** The code inserted: the default value's code. */
  defaultCode: string
}

function shortType(type: string | undefined): string | undefined {
  if (!type) return undefined
  return type
    .split('|')
    .map((member) => member.trim().split('.').pop() ?? '')
    .filter((member) => member !== '')
    .join(' | ')
}

/** The call's parameters that are not shown: placeholders hidden by default, in parameter order. */
export function hiddenParameters(
  application: ArgumentApplication | Ast.Expression,
): HiddenParameter[] {
  if (!(application instanceof ArgumentApplication)) return []
  const result: HiddenParameter[] = []
  for (const { argument } of application.iterApplications()) {
    if (
      argument instanceof ArgumentPlaceholder &&
      argument.hideByDefault &&
      argument.argInfo.defaultValue != null
    ) {
      result.push({
        portId: argument.portId,
        name: argument.argInfo.name,
        type: shortType(argument.argInfo.reprType),
        defaultCode: argument.argInfo.defaultValue,
      })
    }
  }
  // Iteration runs from the outermost application inwards.
  return result.reverse()
}
