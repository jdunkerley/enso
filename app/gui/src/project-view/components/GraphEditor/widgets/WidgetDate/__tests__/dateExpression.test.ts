import { describe, expect, test } from 'vitest'
import {
  addDays,
  dateExpressionCode,
  dateLabel,
  daysInMonth,
  isoDate,
  parseDateExpression,
  resolveChoice,
  type DateChoice,
} from '../dateExpression'

describe('parseDateExpression', () => {
  test.each([
    ['Date.today', { kind: 'today' }],
    ['Date.yesterday', { kind: 'yesterday' }],
    ['Date.tomorrow', { kind: 'tomorrow' }],
    ['Date.new 2020 1 15', { kind: 'date', year: 2020, month: 1, day: 15 }],
    ['  Date.new 2024  2   29 ', { kind: 'date', year: 2024, month: 2, day: 29 }],
  ] satisfies [string, DateChoice][])('%j is a date choice', (code, expected) => {
    expect(parseDateExpression(code)).toEqual(expected)
  })

  test.each([
    undefined,
    '',
    'date1',
    'Date.yesterday ..Week',
    'Date.today.previous',
    'Date.today.next',
    'Date.today.add_days 3',
    'Date.new',
    'Date.new 2020',
    'Date.new 2020 1',
    'Date.new 2020 1 15 3',
    // A real date is required: `Date.new 2020 2 30` fails at run time, so it is not a date chip.
    'Date.new 2020 2 30',
    'Date.new 2023 2 29',
    'Date.new 2020 0 10',
    'Date.new 2020 13 10',
    'Date.new 2020 1 0',
    'Date.new 2020 1 32',
    // Non-literal or non-integer arguments.
    'Date.new year 1 15',
    'Date.new 2020 (month + 1) 15',
    'Date.new 2020 1.5 15',
    'Date.new -2020 1 15',
    'Date.new 2020 1 15 . to_text',
    'Time.today',
    'Date.today2',
    'Standard.Base.Data.Time.Date.Date.today',
  ])('%j is not ours', (code) => {
    expect(parseDateExpression(code)).toBeUndefined()
  })
})

describe('dateExpressionCode', () => {
  test.each([
    [{ kind: 'today' }, 'Date.today'],
    [{ kind: 'yesterday' }, 'Date.yesterday'],
    [{ kind: 'tomorrow' }, 'Date.tomorrow'],
    [{ kind: 'date', year: 2020, month: 1, day: 15 }, 'Date.new 2020 1 15'],
  ] satisfies [DateChoice, string][])('%j writes %s', (choice, code) => {
    expect(dateExpressionCode(choice)).toBe(code)
    // What a choice writes is what it reads back as.
    expect(parseDateExpression(code)).toEqual(choice)
  })
})

describe('dateLabel', () => {
  test.each([
    [{ kind: 'today' }, 'Today'],
    [{ kind: 'yesterday' }, 'Yesterday'],
    [{ kind: 'tomorrow' }, 'Tomorrow'],
    [{ kind: 'date', year: 2020, month: 1, day: 15 }, '2020-01-15'],
    [{ kind: 'date', year: 1000, month: 12, day: 3 }, '1000-12-03'],
  ] satisfies [DateChoice, string][])('%j is labelled %s', (choice, label) => {
    expect(dateLabel(choice)).toBe(label)
  })

  test('isoDate pads', () => {
    expect(isoDate({ year: 2020, month: 3, day: 4 })).toBe('2020-03-04')
  })
})

describe('calendar arithmetic', () => {
  test('daysInMonth knows leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2023, 4)).toBe(30)
    expect(daysInMonth(2023, 12)).toBe(31)
  })

  test('addDays crosses month and year ends', () => {
    expect(addDays({ year: 2020, month: 3, day: 1 }, -1)).toEqual({ year: 2020, month: 2, day: 29 })
    expect(addDays({ year: 2020, month: 12, day: 31 }, 1)).toEqual({
      year: 2021,
      month: 1,
      day: 1,
    })
  })

  test('resolveChoice gives the day a chip stands for', () => {
    const today = { year: 2021, month: 1, day: 1 }
    expect(resolveChoice({ kind: 'today' }, today)).toEqual(today)
    expect(resolveChoice({ kind: 'yesterday' }, today)).toEqual({ year: 2020, month: 12, day: 31 })
    expect(resolveChoice({ kind: 'tomorrow' }, today)).toEqual({ year: 2021, month: 1, day: 2 })
    const date = { kind: 'date', year: 1999, month: 5, day: 6 } as const
    expect(resolveChoice(date, today)).toEqual(date)
  })
})
