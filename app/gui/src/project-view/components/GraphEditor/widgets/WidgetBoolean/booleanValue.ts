/**
 * @file Booleans in the graph editor: which inputs take one, the value a literal stands for, and
 * the dropdown's two entries. Framework-free, so it is unit-tested alone
 * (`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`, part B).
 */
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { ExpressionTag } from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'

/** The qualified name of the `Boolean` type, as a typed argument's `reprType` or `expectedType` has it. */
export const BOOLEAN_TYPE = 'Standard.Base.Data.Boolean.Boolean'

const TRUE_CODES = new Set(['True', 'Boolean.True', `${BOOLEAN_TYPE}.True`])
const FALSE_CODES = new Set(['False', 'Boolean.False', `${BOOLEAN_TYPE}.False`])

/** The value a literal's code stands for: `True`, `Boolean.True` and the fully qualified name, and the same for `False`; otherwise `undefined`. */
export function booleanFromCode(code: string | undefined): boolean | undefined {
  const text = code?.trim()
  if (text == null) return undefined
  if (TRUE_CODES.has(text)) return true
  if (FALSE_CODES.has(text)) return false
  return undefined
}

/** The value of the input's AST when it is a `True`/`False` literal (`True`, `Boolean.False`, …); `undefined` for anything else, a placeholder included. */
export function booleanLiteral(value: WidgetInput['value']): boolean | undefined {
  if (!(value instanceof Ast.Ast)) return undefined
  if (!(value instanceof Ast.Ident || value instanceof Ast.PropertyAccess)) return undefined
  return booleanFromCode(value.code())
}

function hasBooleanTags(tagValues: readonly string[] | null | undefined) {
  return (
    tagValues != null &&
    tagValues.length === 2 &&
    tagValues.includes('True') &&
    tagValues.includes('False')
  )
}

/**
 * Whether the input is an argument that takes a Boolean: its tag values are exactly `True` and
 * `False`, or its `reprType` or expected type is `Boolean`, or - only for an argument with no
 * tag values of its own and no dynamic configuration - its value is a `True`/`False` literal. An
 * `Any`-typed argument with its own dropdown (tags `A`, `B`) whose value happens to be `True`
 * therefore keeps its own options.
 */
export function isBooleanArgument(input: WidgetInput): boolean {
  const info = input[ArgumentInfoKey]?.info
  if (info == null) return false
  if (hasBooleanTags(info.tagValues)) return true
  if (info.reprType === BOOLEAN_TYPE || input.expectedType === BOOLEAN_TYPE) return true
  return (
    info.tagValues == null && input.dynamicConfig == null && booleanLiteral(input.value) != null
  )
}

/** The two dropdown entries, `True` then `False`, each carrying the import of its constructor. */
export function booleanExpressionTags(
  db: Parameters<typeof requiredImportsByProjectPath>[0],
): ExpressionTag[] {
  return (['True', 'False'] as const).map(
    (name) =>
      new ExpressionTag(
        name,
        name,
        undefined,
        requiredImportsByProjectPath(
          db,
          ProjectPath.create(
            'Standard.Base' as QualifiedName,
            `Data.Boolean.Boolean.${name}` as QualifiedName,
          ),
          true,
        ),
      ),
  )
}
