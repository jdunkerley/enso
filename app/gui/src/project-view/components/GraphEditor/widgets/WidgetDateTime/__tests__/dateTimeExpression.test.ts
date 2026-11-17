import { describe, expect, test } from 'vitest'
import {
  dateTimeExpressionCode,
  keptDateTimeArguments,
  parseDateTimeExpression,
  withKeptArguments,
  type DateTimeChoice,
} from '../dateTimeExpression'

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  kept?: string[],
): DateTimeChoice => ({
  kind: 'dateTime',
  year,
  month,
  day,
  hour,
  minute,
  ...(kept ? { kept } : {}),
})

describe('parseDateTimeExpression', () => {
  test.each([
    ['Date_Time.now', { kind: 'now' }],
    ['Date_Time.new 2020 1 15 9 30', at(2020, 1, 15, 9, 30)],
    ['  Date_Time.new  2020 1 15 9 30 ', at(2020, 1, 15, 9, 30)],
    ['Date_Time.new 2020', at(2020, 1, 1, 0, 0)],
    ['Date_Time.new 2020 2 29', at(2020, 2, 29, 0, 0)],
    ['Date_Time.new 2020 hour=9', at(2020, 1, 1, 9, 0)],
    // Partial or named time parts, as typing into an unset hour or minute writes them: missing parts are 0.
    ['Date_Time.new 2026 11 17 14', at(2026, 11, 17, 14, 0)],
    ['Date_Time.new 2026 11 17 minute=30', at(2026, 11, 17, 0, 30)],
    ['Date_Time.new 2026 11 17 hour=14 minute=30', at(2026, 11, 17, 14, 30)],
    ['Date_Time.new 2026 11 17 14 second=15', at(2026, 11, 17, 14, 0, ['second=15'])],
    ['Date_Time.new year=2026 month=11 day=17 hour=14 minute=30', at(2026, 11, 17, 14, 30)],
    ['Date_Time.new 2026 day=17 hour=14', at(2026, 1, 17, 14, 0)],
    ['Date_Time.new 2020 1 15 9 30 45', at(2020, 1, 15, 9, 30, ['45'])],
    [
      'Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc',
      at(2020, 1, 15, 9, 30, ['second=45', 'zone=Time_Zone.utc']),
    ],
    [
      'Date_Time.new 2020 1 15 zone=(Time_Zone.parse "Europe/London")',
      at(2020, 1, 15, 0, 0, ['zone=(Time_Zone.parse "Europe/London")']),
    ],
    [
      'Date_Time.new 2020 1 15 9 30 45 500 0 0 Time_Zone.utc',
      at(2020, 1, 15, 9, 30, ['45', '500', '0', '0', 'Time_Zone.utc']),
    ],
  ] satisfies [string, DateTimeChoice][])('%j is a choice', (code, expected) => {
    expect(parseDateTimeExpression(code)).toEqual(expected)
  })

  test.each([
    undefined,
    '',
    'Date_Time.new',
    'Date_Time.new y 1 15',
    'Date_Time.new (2000 + 20) 1 15',
    'Date_Time.new 2020 13 1',
    'Date_Time.new 2020 2 30',
    'Date_Time.new 99 1 1',
    'Date_Time.new 2020 1 15 24 0',
    'Date_Time.new 2020 1 15 9 60',
    'Date_Time.new 2020 hour=9 10',
    'Date_Time.new 2020 month=2 month=3',
    'Date_Time.new 2020 1 month=2',
    'Date_Time.new 2020 colour=1',
    'Date_Time.new 2020 1 15 9 30 45 500 0 0 Time_Zone.utc 7',
    'Date_Time.now.hour',
    'Date_Time.now + Period.new',
    'Date.new 2020 1 15',
    'dt1',
  ])('%j is not ours', (code) => {
    expect(parseDateTimeExpression(code)).toBeUndefined()
  })
})

describe('dateTimeExpressionCode', () => {
  test.each([
    [{ kind: 'now' }, 'Date_Time.now'],
    [at(2020, 1, 15, 9, 30), 'Date_Time.new 2020 1 15 9 30'],
    [at(2020, 1, 1, 0, 0), 'Date_Time.new 2020 1 1 0 0'],
    [
      at(2020, 1, 15, 9, 30, ['second=45', 'zone=Time_Zone.utc']),
      'Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc',
    ],
    [at(2020, 1, 15, 9, 30, ['45', '500']), 'Date_Time.new 2020 1 15 9 30 45 500'],
  ] satisfies [DateTimeChoice, string][])('%j writes %s', (choice, code) => {
    expect(dateTimeExpressionCode(choice)).toBe(code)
    expect(parseDateTimeExpression(code)).toEqual(choice)
  })
})

describe('withKeptArguments', () => {
  const current = at(2020, 1, 15, 9, 30, ['second=45', 'zone=Time_Zone.utc'])

  test('an edit keeps the arguments after the minute', () => {
    expect(withKeptArguments(at(2021, 3, 4, 10, 0), current)).toEqual(
      at(2021, 3, 4, 10, 0, ['second=45', 'zone=Time_Zone.utc']),
    )
  })

  test('now replaces the whole value', () => {
    expect(withKeptArguments({ kind: 'now' }, current)).toEqual({ kind: 'now' })
  })

  test('nothing to keep from now, an unset value, or a value without extras', () => {
    const picked = at(2021, 3, 4, 10, 0)
    expect(withKeptArguments(picked, { kind: 'now' })).toEqual(picked)
    expect(withKeptArguments(picked, undefined)).toEqual(picked)
    expect(withKeptArguments(picked, at(2020, 1, 1, 0, 0))).toEqual(picked)
  })
})

describe('keptDateTimeArguments', () => {
  test.each([
    ['Date_Time.new y 1 15 zone=Time_Zone.utc', ['zone=Time_Zone.utc']],
    ['Date_Time.new (2000 + 20) 1 15 9 30 45', ['45']],
    ['Date_Time.new 2020 1 15 9 30 second=45', ['second=45']],
  ])('%s keeps %j', (code, kept) => {
    expect(keptDateTimeArguments(code)).toEqual(kept)
  })

  test.each([
    'Date_Time.new 2020 1 15',
    'Date_Time.new 2020 hour=9 10',
    'Date_Time.new 2020 2020',
    'Date_Time.new 2020 foo=1',
    'Date.new 2020 1 1',
    'foo',
    '',
    undefined,
  ])('%s keeps nothing', (code) => {
    expect(keptDateTimeArguments(code)).toBeUndefined()
  })

  test('a pick over a computed value carries them', () => {
    const kept = keptDateTimeArguments('Date_Time.new y 1 15 zone=Time_Zone.utc')
    expect(withKeptArguments(at(2021, 3, 4, 10, 0), kept)).toEqual(
      at(2021, 3, 4, 10, 0, ['zone=Time_Zone.utc']),
    )
    expect(withKeptArguments({ kind: 'now' }, kept)).toEqual({ kind: 'now' })
  })
})
