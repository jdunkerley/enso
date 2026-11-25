/** @file The element type of a `Vector`-typed argument, so each item gets the widget its type asks for. */
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { unionMembers } from '$/providers/openedProjects/widgetRegistry/unionKinds'
import { DATE_TYPE } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { DATE_TIME_TYPE } from '@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression'
import { kindDefaultCode } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindMatch'
import { TIME_OF_DAY_TYPE } from '@/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression'

/**
 * What a new item of a list of these types starts as, when the argument's own `Vector_Editor` does
 * not say: a value, rather than the `_` placeholder that would turn the list into a function.
 */
const DEFAULT_ITEMS: Readonly<Record<string, string>> = {
  [DATE_TYPE]: 'Date.today',
  [TIME_OF_DAY_TYPE]: 'Time_Of_Day.now',
  [DATE_TIME_TYPE]: 'Date_Time.now',
}

/** The code a new item of a list of `elementType` starts as, if that type has one. */
export function defaultItemCode(elementType: string | undefined): string | undefined {
  return elementType != null ? DEFAULT_ITEMS[elementType] : undefined
}

const VECTOR_TYPE = 'Standard.Base.Data.Vector.Vector'

/**
 * The element type of a vector type as the language server reports it: `Vector Date` arrives as
 * `Standard.Base.Data.Vector.Vector Standard.Base.Data.Time.Date.Date`, possibly in parentheses.
 * A single named element type counts, and so does a parenthesised union of them (`Vector (A | B)`
 * gives `A | B`); a bare `Vector` or a nested application gives `undefined`, and the items are drawn
 * as before.
 */
export function vectorElementType(type: string | undefined): string | undefined {
  if (type == null) return undefined
  let reprType = type.trim()
  while (reprType.startsWith('(') && reprType.endsWith(')')) reprType = reprType.slice(1, -1).trim()
  if (!reprType.startsWith(VECTOR_TYPE + ' ')) return undefined
  const element = reprType.slice(VECTOR_TYPE.length + 1).trim()
  if (/^[\w.]+$/.test(element)) return element
  if (!element.startsWith('(') || !element.endsWith(')')) return undefined
  const inner = element.slice(1, -1).trim()
  const members = unionMembers(inner)
  return members.length > 1 && members.every((member) => /^[\w.]+$/.test(member)) ?
      inner
    : undefined
}

/**
 * The widget configuration of a vector's items: the argument's own `item_editor`, else the default
 * widget of the element type.
 */
export function vectorItemConfig(
  itemEditor: WidgetConfiguration | undefined,
  elementType: string | undefined,
  typeDefault: (reprType: string | undefined) => WidgetConfiguration | undefined,
): WidgetConfiguration | undefined {
  return itemEditor ?? typeDefault(elementType)
}

/**
 * The kind whose default code a new item starts as, from the item widget's configuration: a
 * union's first kind that has one (`null`: `Nothing`), else the configuration itself if it has one.
 * Its imports go in with the item (`useKindImports`).
 */
export function vectorItemKind(
  config: WidgetConfiguration | undefined,
): WidgetConfiguration | null | undefined {
  if (config == null) return undefined
  if (config.kind === 'Union')
    return config.kinds.find((kind) => kindDefaultCode(kind.config) != null)?.config
  return kindDefaultCode(config) != null ? config : undefined
}

/** The code a new item starts as: the default code of {@link vectorItemKind}. */
export function vectorItemDefault(config: WidgetConfiguration | undefined): string | undefined {
  const kind = vectorItemKind(config)
  return kind === undefined ? undefined : kindDefaultCode(kind)
}
