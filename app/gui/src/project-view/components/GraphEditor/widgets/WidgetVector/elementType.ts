/** @file The element type of a `Vector`-typed argument, so each item gets the widget its type asks for. */
import { DATE_TYPE } from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { DATE_TIME_TYPE } from '@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression'
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
 * Only a single named element type counts; a bare `Vector`, a union, or a nested application gives
 * `undefined`, and the items are drawn as before.
 */
export function vectorElementType(type: string | undefined): string | undefined {
  if (type == null) return undefined
  let reprType = type.trim()
  while (reprType.startsWith('(') && reprType.endsWith(')')) reprType = reprType.slice(1, -1).trim()
  if (!reprType.startsWith(VECTOR_TYPE + ' ')) return undefined
  const element = reprType.slice(VECTOR_TYPE.length + 1).trim()
  return /^[\w.]+$/.test(element) ? element : undefined
}
