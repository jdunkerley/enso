/**
 * @file Which kind of a union an expression is, and the code that switching to a kind writes.
 */
import {
  flattenChoice,
  type UnionKind,
  type WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { DATE_CALLS } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { DATE_TIME_CALLS } from '@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression'
import { isCallOfShape } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { regexPattern } from '@/components/GraphEditor/widgets/WidgetRegex/regexExpression'
import { TIME_CALLS } from '@/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression'
import { Ast } from '@/util/ast'

/** The index in `kinds` of the kind `value` is, or `undefined` if it is none of them. An unset argument is kind 0. */
export function matchKind(
  kinds: readonly UnionKind[],
  value: Ast.Expression | undefined,
): number | undefined {
  if (value === undefined) return 0
  const ast = withoutParentheses(value)
  const index = kinds.findIndex((kind) => isKind(kind.config, ast))
  return index < 0 ? undefined : index
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
      return String(config.minimum ?? 0)
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

function isKind(config: WidgetConfiguration | null, ast: Ast.Expression): boolean {
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
        const option = value.trim()
        if (code === option) return true
        return ast instanceof Ast.App && applicationHead(ast).code() === option.split(/\s+/)[0]
      })
    }
    case 'Multiple_Choice':
    case 'Vector_Editor':
      return ast instanceof Ast.Vector
    case 'File_Browse':
    case 'Folder_Browse':
      return ast instanceof Ast.TextLiteral || isApplicationOf(ast, ['File.new'])
    case 'Secret_Browse':
      return isApplicationOf(ast, ['Enso_Secret.get'])
    default:
      return false
  }
}
