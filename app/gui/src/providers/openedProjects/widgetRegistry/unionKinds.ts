/**
 * @file Composing the widget of a declared union (`A | B | Nothing`) from its members' widgets and
 * conversions.
 */
import { equalityDeep } from 'lib0/function'
import type { Choice, UnionKind, WidgetConfiguration } from './configuration'

export const NOTHING_TYPE = 'Standard.Base.Nothing.Nothing'

/** Remove balanced parentheses wrapping the whole text, as many layers as there are. */
function stripOuterParentheses(text: string): string {
  let result = text.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wraps = true
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i] === '(') depth++
      else if (result[i] === ')') depth--
      if (depth === 0) {
        wraps = false
        break
      }
    }
    if (!wraps) break
    result = result.slice(1, -1).trim()
  }
  return result
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
 * - a member A is dropped when another member B with a widget has `converts(A, B)`; of two members
 *   converting to each other the earlier stays; if every member would go, the first stays;
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
  const survivors = withWidget.filter((a, i) => {
    return !withWidget.some(
      (b, j) =>
        j !== i && converts(a.typeName, b.typeName) && !(converts(b.typeName, a.typeName) && j > i),
    )
  })
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
