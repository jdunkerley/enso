/**
 * @file The time-of-day widget's expression <-> choice mapping: which code a value holds as a
 * time, and the code a choice writes. Framework-free, so it is unit-tested
 * alone (`docs/superpowers/specs/2026-11-15-date-widget-design.md`, "Time_Of_Day").
 */
import type { CallShapes } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'

/** The qualified name of the `Time_Of_Day` type, which a typed argument's `reprType` or `expectedType` has. */
export const TIME_OF_DAY_TYPE = 'Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day'

/** A time of day. `hour` is 0 to 23, `minute` and `second` 0 to 59. */
export interface HourMinuteSecond {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** What the value stands for: the current time, or a specific one. */
export type TimeChoice =
  | { readonly kind: 'now' }
  | ({ readonly kind: 'time' } & HourMinuteSecond & {
        /**
         * The millisecond, microsecond and nanosecond arguments as they were written (`500`,
         * `millisecond=500`), kept by an edit. Absent when there are none.
         */
        readonly finer?: readonly string[]
      })

/** `Time_Of_Day.new`, then its arguments. */
const TIME_NEW = /^Time_Of_Day\.new((?:\s+\S+)*)$/
const INTEGER = /^\d+$/
const NAMED = /^(hour|minute|second|millisecond|microsecond|nanosecond)=(\d+)$/
/** `Time_Of_Day.new`'s arguments, in its order. */
const PARTS = ['hour', 'minute', 'second', 'millisecond', 'microsecond', 'nanosecond'] as const
type Part = (typeof PARTS)[number]
/**
 * Each part's largest value, as `Time_Of_Day.new` documents them. These are the
 * largest values it accepts for each part on its own (it sums the sub-second
 * parts into one nanosecond count), which are wider than the 0–999 ranges its
 * number widgets offer.
 */
const MAX: Readonly<Record<Part, number>> = {
  hour: 23,
  minute: 59,
  second: 59,
  millisecond: 999,
  microsecond: 999_999,
  nanosecond: 999_999_999,
}
/** The parts the menu edits; the others are kept as they were written. */
const EDITED: ReadonlySet<Part> = new Set(['hour', 'minute', 'second'])

/**
 * The choice that the code stands for, or `undefined` when the code is not one of the shapes:
 * `Time_Of_Day.now`, and `Time_Of_Day.new` with any of its arguments as integer literals,
 * positional or named; a part not given is 0, as it is `Time_Of_Day.new`'s default. So a bare
 * `Time_Of_Day.new`, `Time_Of_Day.new 14` (what typing an hour into the unset `hour` writes) and
 * `Time_Of_Day.new hour=14` are all times. Anything else (a variable, a computed argument, an
 * argument given twice, a positional argument after a named one, an hour of 24) is not ours.
 */
export function parseTimeExpression(code: string | undefined): TimeChoice | undefined {
  const text = code?.trim()
  if (text == null) return undefined
  if (text === 'Time_Of_Day.now') return { kind: 'now' }
  const match = TIME_NEW.exec(text)
  if (match == null) return undefined
  const values: Partial<Record<Part, number>> = {}
  const finer: string[] = []
  let named = false
  let next = 0
  for (const arg of (match[1] ?? '').split(/\s+/).filter(Boolean)) {
    let name: Part
    let value: number
    if (INTEGER.test(arg)) {
      const positional = PARTS[next++]
      if (named || positional == null) return undefined
      name = positional
      value = Number(arg)
    } else {
      const byName = NAMED.exec(arg)
      if (byName == null) return undefined
      named = true
      name = byName[1] as Part
      value = Number(byName[2])
    }
    if (name in values || !Number.isSafeInteger(value) || value > MAX[name]) return undefined
    values[name] = value
    if (!EDITED.has(name)) finer.push(arg)
  }
  const time = { hour: values.hour ?? 0, minute: values.minute ?? 0, second: values.second ?? 0 }
  return finer.length > 0 ? { kind: 'time', ...time, finer } : { kind: 'time', ...time }
}

/**
 * The code that a choice writes: the second when it is not zero or a finer part follows it
 * positionally (which needs it), then the finer parts as they were written.
 */
export function timeExpressionCode(choice: TimeChoice): string {
  if (choice.kind === 'now') return 'Time_Of_Day.now'
  const { hour, minute, second } = choice
  const finer = choice.finer ?? []
  const withSecond = second !== 0 || finer.some((arg) => INTEGER.test(arg))
  return [
    `Time_Of_Day.new ${hour} ${minute}`,
    ...(withSecond ? [String(second)] : []),
    ...finer,
  ].join(' ')
}

/** `picked`, with the finer parts of `current` when both are specific times: an edit keeps them. */
export function withKeptParts(picked: TimeChoice, current: TimeChoice | undefined): TimeChoice {
  if (picked.kind !== 'time' || current?.kind !== 'time' || current.finer == null) return picked
  return { ...picked, finer: current.finer }
}

/** The local time of `now`, with seconds. */
export function localNow(now: Date = new Date()): HourMinuteSecond {
  return { hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() }
}

/** The whole-node calls the picker draws itself (see `isCallOfShape`). */
export const TIME_CALLS: CallShapes = { bare: ['Time_Of_Day.now'], applied: ['Time_Of_Day.new'] }
