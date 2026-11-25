/**
 * @file Which kind of a union an expression is, and the code that switching to a kind writes.
 */
import {
  flattenChoice,
  type UnionKind,
  type WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { stripOuterParentheses } from '$/providers/openedProjects/widgetRegistry/unionKinds'
import { DATE_CALLS } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { DATE_TIME_CALLS } from '@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression'
import { isCallOfShape } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { regexPattern } from '@/components/GraphEditor/widgets/WidgetRegex/regexExpression'
import { TIME_CALLS } from '@/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression'
import { Ast } from '@/util/ast'

/**
 * The index in `kinds` of the kind `value` is, or `undefined` if it is none of them. An unset
 * argument is kind 0. A vector is the first `Vector_Editor` kind whose item widget every item
 * matches (so `[]` is the first of them, and `[1]` is `Vector Integer` in
 * `Vector Text | Vector Integer`), else the first kind that takes any vector.
 */
export function matchKind(
  kinds: readonly UnionKind[],
  value: Ast.Expression | undefined,
): number | undefined {
  if (value === undefined) return 0
  const ast = withoutParentheses(value)
  const byItems = kinds.findIndex((kind) => isKind(kind.config, ast, true))
  if (byItems >= 0) return byItems
  const index = kinds.findIndex((kind) => isKind(kind.config, ast, false))
  return index < 0 ? undefined : index
}

/** Whether `ast` is a value of the item widget `config` (any kind of it, for a union). */
function isItemKind(config: WidgetConfiguration, ast: Ast.Expression): boolean {
  return config.kind === 'Union' ?
      config.kinds.some((kind) => isKind(kind.config, ast, true))
    : isKind(config, ast, true)
}

/** The code switching to a kind writes, or `undefined` if the kind cannot be offered. */
export function kindDefaultCode(config: WidgetConfiguration | null): string | undefined {
  if (config === null) return 'Nothing'
  switch (config.kind) {
    case 'Text_Input':
    case 'File_Browse':
    case 'Folder_Browse':
      return "''"
    case 'Numeric_Input':
      return config.minimum != null && config.minimum > 0 ? String(config.minimum) : '0'
    case 'Boolean_Input':
      return 'False'
    case 'Date_Input':
      return 'Date.today'
    case 'Time_Input':
      return 'Time_Of_Day.now'
    case 'Date_Time_Input':
      return 'Date_Time.now'
    case 'Regex_Input':
      return "regex '.*'"
    case 'Single_Choice':
      return config.values.flatMap(flattenChoice)[0]?.value
    case 'Multiple_Choice':
    case 'Vector_Editor':
      return '[]'
    case 'Secret_Browse':
      return "Enso_Secret.get ''"
    default:
      return undefined
  }
}

/**
 * The code an explicit switch in the kind picker writes, from the kind `value` is (`from`) to `to`.
 * Two switches carry the value across:
 * - Text → a list whose items take it wraps it: `'x'` becomes `['x']`;
 * - a list → Text keeps a list's single text literal (`['a']` becomes `'a'`). Anything else gives
 *   `''`, losing the list: the owner chose that over refusing the switch.
 *
 * Every other switch writes `to`'s default code ({@link kindDefaultCode}), as does an unset value.
 */
export function kindSwitchCode(
  from: WidgetConfiguration | null | undefined,
  to: WidgetConfiguration | null,
  value: Ast.Expression | undefined,
): string | undefined {
  const ast = value && withoutParentheses(value)
  if (ast != null && from != null && to != null) {
    if (
      from.kind === 'Text_Input' &&
      to.kind === 'Vector_Editor' &&
      ast instanceof Ast.TextLiteral &&
      isItemKind(to.item_editor, ast)
    )
      return `[${ast.code()}]`
    if (from.kind === 'Vector_Editor' && to.kind === 'Text_Input' && ast instanceof Ast.Vector) {
      const items = [...ast.values()].map(withoutParentheses)
      if (items.length === 1 && items[0] instanceof Ast.TextLiteral) return items[0].code()
    }
  }
  return kindDefaultCode(to)
}

function withoutParentheses(ast: Ast.Expression): Ast.Expression {
  while (ast instanceof Ast.Group && ast.expression) ast = ast.expression
  return ast
}

function applicationHead(ast: Ast.Expression): Ast.Expression {
  while (ast instanceof Ast.App) ast = ast.function
  return ast
}

function isApplicationOf(ast: Ast.Expression, heads: readonly string[]): boolean {
  if (!(ast instanceof Ast.App)) return false
  const head = applicationHead(ast).code()
  return heads.some((h) => head === h || head.endsWith(`.${h}`))
}

/** `itemsMatch`: a `Vector_Editor` takes a vector only if its item widget takes every item. */
function isKind(
  config: WidgetConfiguration | null,
  ast: Ast.Expression,
  itemsMatch: boolean,
): boolean {
  if (config === null) {
    const code = ast.code()
    return code === 'Nothing' || code === 'Standard.Base.Nothing.Nothing'
  }
  switch (config.kind) {
    case 'Text_Input':
      return ast instanceof Ast.TextLiteral
    case 'Regex_Input':
      return regexPattern(ast) !== undefined
    case 'Numeric_Input':
      return (
        ast instanceof Ast.NumericLiteral ||
        (ast instanceof Ast.NegationApp && ast.argument instanceof Ast.NumericLiteral)
      )
    case 'Boolean_Input':
      return ['True', 'False', 'Boolean.True', 'Boolean.False'].includes(ast.code())
    case 'Date_Input':
      return isCallOfShape(ast, DATE_CALLS)
    case 'Time_Input':
      return isCallOfShape(ast, TIME_CALLS)
    case 'Date_Time_Input':
      return isCallOfShape(ast, DATE_TIME_CALLS)
    case 'Single_Choice': {
      const code = ast.code()
      return config.values.flatMap(flattenChoice).some(({ value }) => {
        const option = stripOuterParentheses(value)
        if (code === option) return true
        // An option with arguments (`..Equals that=1`) matches any application of its head.
        const [head, ...rest] = option.split(/\s+/)
        return rest.length > 0 && ast instanceof Ast.App && applicationHead(ast).code() === head
      })
    }
    case 'Multiple_Choice':
      return ast instanceof Ast.Vector
    case 'Vector_Editor':
      return (
        ast instanceof Ast.Vector &&
        (!itemsMatch ||
          [...ast.values()].every((item) =>
            isItemKind(config.item_editor, withoutParentheses(item)),
          ))
      )
    case 'File_Browse':
    case 'Folder_Browse':
      return ast instanceof Ast.TextLiteral || isApplicationOf(ast, ['File.new'])
    case 'Secret_Browse':
      return isApplicationOf(ast, ['Enso_Secret.get'])
    default:
      return false
  }
}
