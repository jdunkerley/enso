import { describe, expect, test } from 'vitest'
import {
  parseTimeExpression,
  timeExpressionCode,
  withKeptParts,
  type TimeChoice,
} from '../timeExpression'

describe('parseTimeExpression', () => {
  test.each([
    ['Time_Of_Day.now', { kind: 'now' }],
    ['Time_Of_Day.new 14 30', { kind: 'time', hour: 14, minute: 30, second: 0 }],
    ['Time_Of_Day.new 14 30 15', { kind: 'time', hour: 14, minute: 30, second: 15 }],
    ['  Time_Of_Day.new   23  59  59 ', { kind: 'time', hour: 23, minute: 59, second: 59 }],
    ['Time_Of_Day.new 0 0 0', { kind: 'time', hour: 0, minute: 0, second: 0 }],
    ['Time_Of_Day.new 14 30 second=15', { kind: 'time', hour: 14, minute: 30, second: 15 }],
    [
      'Time_Of_Day.new 14 30 15 7',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['7'] },
    ],
    [
      'Time_Of_Day.new 14 30 second=15 millisecond=500',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['millisecond=500'] },
    ],
    [
      'Time_Of_Day.new 14 30 millisecond=500',
      { kind: 'time', hour: 14, minute: 30, second: 0, finer: ['millisecond=500'] },
    ],
    [
      'Time_Of_Day.new 14 30 15 7 8 9',
      { kind: 'time', hour: 14, minute: 30, second: 15, finer: ['7', '8', '9'] },
    ],
  ] satisfies [string, TimeChoice][])('%j is a time choice', (code, expected) => {
    expect(parseTimeExpression(code)).toEqual(expected)
  })

  test.each([
    undefined,
    '',
    'Time_Of_Day.new',
    'Time_Of_Day.new 14',
    'time1',
    'Time_Of_Day.new 24',
    'Time_Of_Day.new 14 60',
    'Time_Of_Day.new 14 30 60',
    'Time_Of_Day.new 14 30 15 second=16',
    'Time_Of_Day.new 14 30 second=15 second=16',
    'Time_Of_Day.new 14 30 second=x',
    'Time_Of_Day.new 14 30 zone=15',
    'Time_Of_Day.new 14 30 15 7 8 9 10',
    'Time_Of_Day.new 14 30 15 millisecond=1000',
    // Named arguments, and other literals or computed arguments.
    'Time_Of_Day.new hour=14',
    'Time_Of_Day.new 14 minute=30',
    'Time_Of_Day.new 14.5',
    'Time_Of_Day.new -1',
    "Time_Of_Day.new '14'",
    'Time_Of_Day.new h 30',
    'Time_Of_Day.new (h + 1) 30',
    'Time_Of_Day.new 14 30 . to_text',
    'Time_Of_Day.now.hour',
    'Time_Of_Day.parse "14:30"',
    'Time_Of_Day.nowish',
    'Date.today',
  ])('%j is not ours', (code) => {
    expect(parseTimeExpression(code)).toBeUndefined()
  })
})

describe('timeExpressionCode', () => {
  test.each([
    [{ kind: 'now' }, 'Time_Of_Day.now'],
    [{ kind: 'time', hour: 14, minute: 30, second: 0 }, 'Time_Of_Day.new 14 30'],
    [{ kind: 'time', hour: 0, minute: 0, second: 0 }, 'Time_Of_Day.new 0 0'],
    [{ kind: 'time', hour: 14, minute: 30, second: 15 }, 'Time_Of_Day.new 14 30 15'],
    [
      { kind: 'time', hour: 9, minute: 5, second: 0, finer: ['millisecond=500'] },
      'Time_Of_Day.new 9 5 millisecond=500',
    ],
    [{ kind: 'time', hour: 9, minute: 5, second: 0, finer: ['500'] }, 'Time_Of_Day.new 9 5 0 500'],
    [
      { kind: 'time', hour: 9, minute: 5, second: 15, finer: ['7', '8'] },
      'Time_Of_Day.new 9 5 15 7 8',
    ],
  ] satisfies [TimeChoice, string][])('%j writes %s', (choice, code) => {
    expect(timeExpressionCode(choice)).toBe(code)
    // What a choice writes is what it reads back as.
    expect(parseTimeExpression(code)).toEqual(choice)
  })
})

describe('withKeptParts', () => {
  const current: TimeChoice = {
    kind: 'time',
    hour: 14,
    minute: 30,
    second: 15,
    finer: ['millisecond=500'],
  }

  test('an edited time keeps the finer parts of the current one', () => {
    expect(withKeptParts({ kind: 'time', hour: 9, minute: 0, second: 15 }, current)).toEqual({
      kind: 'time',
      hour: 9,
      minute: 0,
      second: 15,
      finer: ['millisecond=500'],
    })
  })

  test('now replaces the whole value', () => {
    expect(withKeptParts({ kind: 'now' }, current)).toEqual({ kind: 'now' })
  })

  test('nothing to keep from now, an unset value or a time without finer parts', () => {
    const picked: TimeChoice = { kind: 'time', hour: 9, minute: 0, second: 0 }
    expect(withKeptParts(picked, { kind: 'now' })).toEqual(picked)
    expect(withKeptParts(picked, undefined)).toEqual(picked)
    expect(withKeptParts(picked, { kind: 'time', hour: 1, minute: 2, second: 3 })).toEqual(picked)
  })
})
