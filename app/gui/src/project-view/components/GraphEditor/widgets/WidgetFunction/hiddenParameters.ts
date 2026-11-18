/**
 * @file The parameters of a call that are not shown, for the node's add-argument menu: unset
 * arguments with a default that the widget tree hides.
 */
import type { PortId } from '@/providers/portInfo'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentPlaceholder } from '@/util/callTree'
import { isIdentifier } from '@/util/qualifiedName'

export interface HiddenParameter {
  /** The placeholder's port, the `origin` of the update that inserts it. */
  portId: PortId
  name: string
  /** The short type: the last segment of each union member, joined with ` | `. */
  type: string | undefined
  /** The code inserted: the default value's code. */
  defaultCode: string
}

/** One call's hidden parameters, as the node's add-argument menu lists them. */
export interface HiddenParameterGroup {
  /** The called function's name: the group's heading. */
  callName: string
  /** How deep the call is in the node's expression: outer calls are listed first. */
  depth: number
  /** The order the call registered in, which breaks a tie in `depth`. */
  order: number
  parameters: HiddenParameter[]
  /** Insert one of `parameters` into the call, with its default value. */
  insert: (parameter: HiddenParameter) => void
}

let parameterGroupCount = 0

/** A new {@link HiddenParameterGroup.order}: groups are numbered in the order they register. */
export function nextParameterGroupOrder(): number {
  return parameterGroupCount++
}

/** The groups that have a hidden parameter, outer calls first. */
export function orderedParameterGroups(
  groups: Iterable<HiddenParameterGroup>,
): HiddenParameterGroup[] {
  return [...groups]
    .filter((group) => group.parameters.length > 0)
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
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

/**
 * Apply an argument to a call's prefix application: the placeholder's value, named when the
 * placeholder asks for it (it follows an unset parameter) or when `forceNamed` is set.
 */
export function insertPrefixArgument(
  edit: Ast.MutableModule,
  appTree: Ast.Expression,
  placeholder: ArgumentPlaceholder,
  newArg: Ast.Owned<Ast.MutableExpression>,
  forceNamed: boolean,
) {
  const name =
    (forceNamed || placeholder.insertAsNamed) && isIdentifier(placeholder.argInfo.name) ?
      placeholder.argInfo.name
    : undefined
  edit.getVersion(appTree).updateValue((oldAppTree) => Ast.App.new(edit, oldAppTree, name, newArg))
}
