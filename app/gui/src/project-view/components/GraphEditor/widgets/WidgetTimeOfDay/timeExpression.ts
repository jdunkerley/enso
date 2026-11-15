/**
 * @file The time-of-day widget's expression <-> choice mapping: which code an argument holds as a
 * time chip, the chip's label, and the code a choice writes. Framework-free, so it is unit-tested
 * alone (`docs/superpowers/specs/2026-11-15-date-widget-design.md`, "Time_Of_Day").
 */

/** The qualified name of the `Time_Of_Day` type, which a typed argument's `reprType` or `expectedType` has. */
export const TIME_OF_DAY_TYPE = 'Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day'

/** A time of day. `hour` is 0 to 23, `minute` and `second` 0 to 59. */
export interface HourMinuteSecond {
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** What the chip stands for: the current time, or a specific one. */
export type TimeChoice = { readonly kind: 'now' } | ({ readonly kind: 'time' } & HourMinuteSecond)

/** `Time_Of_Day.new` and up to three integer literals: hour, minute, second. */
const TIME_NEW = /^Time_Of_Day\.new((?:\s+\d+){0,3})$/

function isValidTime({ hour, minute, second }: HourMinuteSecond): boolean {
  return (
    Number.isSafeInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

/**
 * The choice that the code stands for, or `undefined` when the code is not one of the shapes:
 * `Time_Of_Day.now` and `Time_Of_Day.new` with zero to three integer literals (hour, minute,
 * second; the ones left out are zero). Anything else (a variable, a computed argument, a named
 * argument such as `hour=14`, an hour of 24) is not ours.
 */
export function parseTimeExpression(code: string | undefined): TimeChoice | undefined {
  const text = code?.trim()
  if (text == null) return undefined
  if (text === 'Time_Of_Day.now') return { kind: 'now' }
  const match = TIME_NEW.exec(text)
  if (match == null) return undefined
  const numbers = (match[1] ?? '').split(/\s+/).filter(Boolean).map(Number)
  const [hour = 0, minute = 0, second = 0] = numbers
  const time = { hour, minute, second }
  return isValidTime(time) ? { kind: 'time', ...time } : undefined
}

/** The code that a choice writes: seconds only when they are not zero. */
export function timeExpressionCode(choice: TimeChoice): string {
  if (choice.kind === 'now') return 'Time_Of_Day.now'
  const { hour, minute, second } = choice
  return `Time_Of_Day.new ${hour} ${minute}${second !== 0 ? ` ${second}` : ''}`
}

/** A time as `14:30`, or `14:30:15` when `withSeconds`. */
export function isoTime({ hour, minute, second }: HourMinuteSecond, withSeconds: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hour)}:${pad(minute)}${withSeconds ? `:${pad(second)}` : ''}`
}

/** The chip's label for a choice: `Now`, `14:30` or `14:30:15` (seconds only when they are set). */
export function timeLabel(choice: TimeChoice): string {
  return choice.kind === 'now' ? 'Now' : isoTime(choice, choice.second !== 0)
}

/** The local time of `now`, with seconds. */
export function localNow(now: Date = new Date()): HourMinuteSecond {
  return { hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds() }
}
