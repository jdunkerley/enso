/**
 * @file The date widget's expression <-> choice mapping: which code a value holds as a date, and the code a choice writes. Framework-free, so it is
 * unit-tested alone (`docs/superpowers/specs/2026-11-15-date-widget-design.md`).
 */

/** The qualified name of the `Date` type, which a typed argument's `reprType` or `expectedType` has. */
export const DATE_TYPE = 'Standard.Base.Data.Time.Date.Date'

/** A calendar date. `month` is 1 to 12. */
export interface YearMonthDay {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** What the value stands for: a relative day, or a specific date. */
export type DateChoice =
  | { readonly kind: 'today' }
  | { readonly kind: 'yesterday' }
  | { readonly kind: 'tomorrow' }
  | ({ readonly kind: 'date' } & YearMonthDay)

/** The relative choices, in the order the menu lists them. */
export const RELATIVE_CHOICES = [
  { kind: 'today' },
  { kind: 'yesterday' },
  { kind: 'tomorrow' },
] as const satisfies readonly DateChoice[]

const DATE_NEW = /^Date\.new\s+(\d+)\s+(\d+)\s+(\d+)$/

/** Whether `year` is a leap year in the proleptic Gregorian calendar, as Enso's `Date` is. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** The number of days in the month. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** Whether `Date.new` takes the date: years 100 to 9999, and a day the month has. */
export function isValidDate({ year, month, day }: YearMonthDay): boolean {
  return (
    Number.isSafeInteger(year) &&
    year >= 100 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

/**
 * The choice that the code stands for, or `undefined` when the code is not one of the four shapes:
 * `Date.today`, `Date.yesterday`, `Date.tomorrow` and `Date.new <year> <month> <day>`, with
 * three integer literals that make a real date (year 100 to 9999). Anything else (a variable, a computed argument, an
 * impossible date such as `Date.new 2020 2 30`) is not ours.
 */
export function parseDateExpression(code: string | undefined): DateChoice | undefined {
  const text = code?.trim()
  if (text == null) return undefined
  switch (text) {
    case 'Date.today':
      return { kind: 'today' }
    case 'Date.yesterday':
      return { kind: 'yesterday' }
    case 'Date.tomorrow':
      return { kind: 'tomorrow' }
  }
  const match = DATE_NEW.exec(text)
  if (match == null) return undefined
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  return isValidDate(date) ? { kind: 'date', ...date } : undefined
}

/** The code that a choice writes. */
export function dateExpressionCode(choice: DateChoice): string {
  switch (choice.kind) {
    case 'today':
      return 'Date.today'
    case 'yesterday':
      return 'Date.yesterday'
    case 'tomorrow':
      return 'Date.tomorrow'
    case 'date':
      return `Date.new ${choice.year} ${choice.month} ${choice.day}`
  }
}

/** The date `days` days after (or, if negative, before) `date`. */
export function addDays(date: YearMonthDay, days: number): YearMonthDay {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** The calendar day a choice stands for, given today's date. */
export function resolveChoice(choice: DateChoice, today: YearMonthDay): YearMonthDay {
  switch (choice.kind) {
    case 'today':
      return today
    case 'yesterday':
      return addDays(today, -1)
    case 'tomorrow':
      return addDays(today, 1)
    case 'date':
      return choice
  }
}

/** The local date of `now`. */
export function localToday(now: Date = new Date()): YearMonthDay {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}
