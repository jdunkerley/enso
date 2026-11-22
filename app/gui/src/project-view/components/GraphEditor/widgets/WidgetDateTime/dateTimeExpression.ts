/**
 * @file The date-time widget's expression <-> choice mapping: which code a value holds as a date
 * and time, the code a choice writes, and the arguments an edit keeps. The arguments are read from
 * the AST, so a kept one (`zone=(Time_Zone.parse "Europe/London")`) is carried over verbatim
 * (`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`, part D).
 */
import {
  isValidDate,
  type YearMonthDay,
} from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import type { CallShapes } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { Ast } from '@/util/ast'

/** The qualified name of the `Date_Time` type. */
export const DATE_TIME_TYPE = 'Standard.Base.Data.Time.Date_Time.Date_Time'

/** A date and a time to the second: what the picker writes. */
export interface DateTimeParts extends YearMonthDay {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** What the value stands for: the current instant, or a specific one. */
export type DateTimeChoice =
  | { readonly kind: 'now' }
  | ({ readonly kind: 'dateTime' } & DateTimeParts & {
        /** The arguments after the second, as written (`500`, `millisecond=500`, `zone=Time_Zone.utc`); absent when none. */
        readonly kept?: readonly string[]
      })

/** The parameters the picker writes, in `Date_Time.new`'s order. */
const PICKED = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const
type Picked = (typeof PICKED)[number]
/** The parameters an edit keeps, in `Date_Time.new`'s order after the second. */
const KEPT = ['millisecond', 'microsecond', 'nanosecond', 'zone'] as const
const INTEGER = /^\d+$/
/** A kept argument written by name (`zone=…`); any other was written positionally. */
const NAMED = /^\w+=/

/** The arguments of an application chain, first to last, and its callee. */
function callArguments(expr: Ast.Ast): {
  callee: Ast.Ast
  args: { name: string | undefined; code: string }[]
} {
  const args: { name: string | undefined; code: string }[] = []
  let node = expr
  while (node instanceof Ast.App) {
    args.unshift({
      name: node.argumentName?.code(),
      code: node.argument.code(),
    })
    node = node.function
  }
  return { callee: node, args }
}

/**
 * The arguments of a well-formed `Date_Time.new` call: the code written for year to second, by
 * name, and the kept arguments as written. A positional argument after a named one, an argument
 * given twice, an unknown name or too many positional arguments make a call malformed.
 */
function dateTimeNewArguments(
  code: string | undefined,
): { picked: Partial<Record<Picked, string>>; kept: string[] } | undefined {
  const text = code?.trim()
  if (!text) return undefined
  const expr = Ast.parseExpression(text)
  if (expr == null) return undefined
  const { callee, args } = callArguments(expr)
  if (callee.code() !== 'Date_Time.new' || args.length === 0) return undefined
  const picked: Partial<Record<Picked, string>> = {}
  const seen = new Set<string>()
  const kept: string[] = []
  let named = false
  let position = 0
  for (const { name: given, code: argCode } of args) {
    let name: string
    if (given == null) {
      if (named || position >= PICKED.length + KEPT.length) return undefined
      name = position < PICKED.length ? PICKED[position]! : KEPT[position - PICKED.length]!
      position += 1
    } else {
      named = true
      name = given
    }
    if (seen.has(name)) return undefined
    seen.add(name)
    if ((PICKED as readonly string[]).includes(name)) picked[name as Picked] = argCode
    else if ((KEPT as readonly string[]).includes(name))
      kept.push(given == null ? argCode : `${given}=${argCode}`)
    else return undefined
  }
  return { picked, kept }
}

/**
 * The choice that the code stands for, or `undefined` when it is not `Date_Time.now` or a
 * `Date_Time.new` whose year (required) and month, day, hour, minute and second (each optional) are integer
 * literals, positional or named, followed by any of `Date_Time.new`'s other arguments, which are
 * kept as written. A positional argument after a named one, an argument given twice, an unknown
 * name, a computed year … second, or an impossible date or time is not ours.
 */
export function parseDateTimeExpression(code: string | undefined): DateTimeChoice | undefined {
  if (code?.trim() === 'Date_Time.now') return { kind: 'now' }
  const call = dateTimeNewArguments(code)
  if (call == null) return undefined
  const parts: Partial<Record<Picked, number>> = {}
  for (const [name, argCode] of Object.entries(call.picked)) {
    if (!INTEGER.test(argCode)) return undefined
    parts[name as Picked] = Number(argCode)
  }
  const { kept } = call
  if (parts.year == null) return undefined
  const value = {
    year: parts.year,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
  if (!isValidDate(value) || value.hour > 23 || value.minute > 59 || value.second > 59)
    return undefined
  return kept.length > 0 ? { kind: 'dateTime', ...value, kept } : { kind: 'dateTime', ...value }
}

/**
 * The arguments after the second of a well-formed `Date_Time.new` call, as written, whether or not
 * its year … second are literals (`Date_Time.new y 1 15 zone=Time_Zone.utc` keeps `zone=…`);
 * `undefined` for any other code or when there are none.
 */
export function keptDateTimeArguments(code: string | undefined): readonly string[] | undefined {
  const kept = dateTimeNewArguments(code)?.kept
  return kept != null && kept.length > 0 ? kept : undefined
}

/**
 * The code that a choice writes: year to minute positionally (each a port), the second when it is not
 * zero or a kept argument follows it positionally (which needs it), then the kept arguments.
 */
export function dateTimeExpressionCode(choice: DateTimeChoice): string {
  if (choice.kind === 'now') return 'Date_Time.now'
  const { year, month, day, hour, minute, second } = choice
  const kept = choice.kept ?? []
  const withSecond = second !== 0 || kept.some((arg) => !NAMED.test(arg))
  return [
    `Date_Time.new ${year} ${month} ${day} ${hour} ${minute}`,
    ...(withSecond ? [String(second)] : []),
    ...kept,
  ].join(' ')
}

/**
 * `picked`, with the kept arguments of `current` when `picked` is specific: an edit keeps them.
 * `current` is a parsed choice or the kept list of a computed value (`keptDateTimeArguments`).
 */
export function withKeptArguments(
  picked: DateTimeChoice,
  current: DateTimeChoice | readonly string[] | undefined,
): DateTimeChoice {
  if (picked.kind !== 'dateTime' || current == null) return picked
  const kept =
    'kind' in current ?
      current.kind === 'dateTime' ?
        current.kept
      : undefined
    : current
  return kept == null || kept.length === 0 ? picked : { ...picked, kept }
}

/** The local date and time of `now`, to the second. */
export function localDateTimeNow(now: Date = new Date()): DateTimeParts {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  }
}

/** The whole-node calls the picker draws itself (see `isCallOfShape`). */
export const DATE_TIME_CALLS: CallShapes = { bare: ['Date_Time.now'], applied: ['Date_Time.new'] }
