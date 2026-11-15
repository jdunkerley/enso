import { describe, expect, test } from 'vitest'
import {
  isoTime,
  parseTimeExpression,
  timeExpressionCode,
  timeLabel,
  type TimeChoice,
} from '../timeExpression'

describe('parseTimeExpression', () => {
  test.each([
    ['Time_Of_Day.now', { kind: 'now' }],
    ['Time_Of_Day.new 14 30', { kind: 'time', hour: 14, minute: 30, second: 0 }],
    ['Time_Of_Day.new 14 30 15', { kind: 'time', hour: 14, minute: 30, second: 15 }],
    ['  Time_Of_Day.new   23  59  59 ', { kind: 'time', hour: 23, minute: 59, second: 59 }],
    ['Time_Of_Day.new 0 0 0', { kind: 'time', hour: 0, minute: 0, second: 0 }],
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
    'Time_Of_Day.new 14 30 15 7',
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
  ] satisfies [TimeChoice, string][])('%j writes %s', (choice, code) => {
    expect(timeExpressionCode(choice)).toBe(code)
    // What a choice writes is what it reads back as.
    expect(parseTimeExpression(code)).toEqual(choice)
  })
})

describe('timeLabel', () => {
  test.each([
    [{ kind: 'now' }, 'Now'],
    [{ kind: 'time', hour: 0, minute: 0, second: 0 }, '00:00'],
    [{ kind: 'time', hour: 14, minute: 0, second: 0 }, '14:00'],
    [{ kind: 'time', hour: 14, minute: 30, second: 0 }, '14:30'],
    [{ kind: 'time', hour: 9, minute: 5, second: 7 }, '09:05:07'],
    [{ kind: 'time', hour: 14, minute: 30, second: 15 }, '14:30:15'],
  ] satisfies [TimeChoice, string][])('%j is labelled %s', (choice, label) => {
    expect(timeLabel(choice)).toBe(label)
  })

  test('isoTime pads, and shows seconds on request', () => {
    expect(isoTime({ hour: 3, minute: 4, second: 5 }, false)).toBe('03:04')
    expect(isoTime({ hour: 3, minute: 4, second: 5 }, true)).toBe('03:04:05')
  })
})
