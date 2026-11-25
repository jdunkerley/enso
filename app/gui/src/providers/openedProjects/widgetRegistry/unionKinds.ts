/**
 * @file Composing the widget of a declared union (`A | B | Nothing`) from its members' widgets and
 * conversions.
 */
import { equalityDeep } from 'lib0/function'
import type { Choice, UnionKind, WidgetConfiguration } from './configuration'

export const NOTHING_TYPE = 'Standard.Base.Nothing.Nothing'

/**
 * Remove balanced parentheses wrapping the whole text, as many layers as there are: `((a b))` gives
 * `a b`, while `(a) + (b)` is left as it is. Parentheses inside a text literal (`'…'`, `"…"`) are not
 * counted. Used on type names and on the code of choice values.
 */
export function stripOuterParentheses(text: string): string {
  let result = text.trim()
  while (
    result.startsWith('(') &&
    result.endsWith(')') &&
    closingOfFirst(result) === result.length - 1
  )
    result = result.slice(1, -1).trim()
  return result
}

/** The index of the `)` closing the `(` at index 0, or -1 if none does. */
function closingOfFirst(code: string): number {
  let depth = 0
  let quote: string | undefined
  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (quote != null) {
      if (char === '\\') i++
      else if (char === quote) quote = undefined
    } else if (char === "'" || char === '"') quote = char
    else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * The members of a declared type, split on top-level `|` only (`Vector Header | (Pair Text Text)` has
 * two), outer parentheses removed. A type that is not a union gives one member.
 */
export function unionMembers(reprType: string): string[] {
  const whole = stripOuterParentheses(reprType)
  const members: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < whole.length; i++) {
    const char = whole[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === '|' && depth === 0) {
      members.push(whole.slice(start, i))
      start = i + 1
    }
  }
  members.push(whole.slice(start))
  return members.map(stripOuterParentheses)
}

/** A member and what is known of its widget: `'pending'` while its type default is being asked. */
export type MemberWidget = {
  typeName: string
  config: WidgetConfiguration | undefined | 'pending'
}

/** Whether `target.from (that : source)` exists (both fully qualified type names). */
export type Converts = (source: string, target: string) => boolean

/** The label a kind is listed under: the member's last path segment, applied types kept (`Vector Text`). */
export function kindLabel(typeName: string): string {
  return stripOuterParentheses(typeName)
    .split(/\s+/)
    .map((part) => stripOuterParentheses(part).split('.').pop() ?? part)
    .join(' ')
}

/**
 * The widget of a union from its members' widgets:
 * - `'pending'` while any member is pending;
 * - `Nothing` is a kind of its own, never absorbed and never absorbing;
 * - members without a widget are dropped (and absorb nothing);
 * - a member A is dropped when another member B with a widget has `converts(A, B)`, directly or
 *   through other members, and B does not convert back; of members that all convert to each other
 *   (two, or a cycle of more) the earliest stays; if every member would go, the first stays;
 * - members with deep-equal widgets collapse into the first;
 * - every remaining non-Nothing kind a `Single_Choice` → one merged `Single_Choice` (`Nothing` an option;
 *   it keeps the first kind's other fields);
 * - one kind (Nothing not counted unless present) → that kind's widget alone, `undefined` if it is only Nothing;
 * - otherwise a `Union` (`Nothing` last).
 */
export function composeUnion(
  members: MemberWidget[],
  converts: Converts,
): WidgetConfiguration | undefined | 'pending' {
  if (members.some((member) => member.config === 'pending')) return 'pending'
  const hasNothing = members.some((member) => member.typeName === NOTHING_TYPE)
  const withWidget = members.filter(
    (member): member is MemberWidget & { config: WidgetConfiguration } =>
      member.typeName !== NOTHING_TYPE && member.config != null && member.config !== 'pending',
  )
  // `reach[i][j]`: member i converts to member j, directly or through other members.
  const reach = withWidget.map((a) =>
    withWidget.map((b) => a !== b && converts(a.typeName, b.typeName)),
  )
  for (let k = 0; k < reach.length; k++)
    for (const row of reach) if (row[k]) row.forEach((_, j) => (row[j] ||= reach[k]![j]!))
  // A member goes when it reaches one that does not convert back (that one absorbs it), and among
  // members that all reach each other (a cycle of conversions) only the earliest stays.
  const survivors = withWidget.filter(
    (_, i) => !reach[i]!.some((reaches, j) => reaches && (!reach[j]![i] || j < i)),
  )
  const remaining = survivors.length > 0 ? survivors : withWidget.slice(0, 1)

  const kinds: (UnionKind & { config: WidgetConfiguration })[] = []
  for (const { typeName, config } of remaining) {
    if (kinds.some((kind) => equalityDeep(kind.config, config))) continue
    kinds.push({ label: kindLabel(typeName), config })
  }

  if (kinds.length === 0) return undefined
  const nothingChoice: Choice = { value: 'Nothing', label: 'Nothing', parameters: [] }
  if (kinds.every((kind) => kind.config.kind === 'Single_Choice')) {
    const choices = kinds.flatMap((kind) =>
      kind.config.kind === 'Single_Choice' ? kind.config.values : [],
    )
    const values = choices.filter(
      (choice, i) => choices.findIndex((other) => other.value === choice.value) === i,
    )
    if (hasNothing) values.push(nothingChoice)
    const first = kinds[0]!.config
    return { ...first, kind: 'Single_Choice', values }
  }
  if (kinds.length === 1 && !hasNothing) return kinds[0]!.config
  return {
    kind: 'Union',
    kinds: [...kinds, ...(hasNothing ? [{ label: 'Nothing', config: null }] : [])],
  }
}
