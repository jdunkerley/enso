/** @file The element type of a `Vector`-typed argument. */
import { describe, expect, test } from 'vitest'
import {
  defaultItemCode,
  vectorElementType,
  vectorItemDefault,
  vectorItemKind,
} from '../elementType'

const DATE = 'Standard.Base.Data.Time.Date.Date'
const VECTOR = 'Standard.Base.Data.Vector.Vector'

describe('vectorElementType', () => {
  test.each([
    [`${VECTOR} ${DATE}`, DATE],
    [`(${VECTOR} ${DATE})`, DATE],
    [` ${VECTOR}  ${DATE} `, DATE],
  ])('%s has elements of %s', (type, element) => {
    expect(vectorElementType(type)).toBe(element)
  })

  test.each([
    undefined,
    VECTOR,
    DATE,
    `${VECTOR} (${VECTOR} ${DATE})`,
    `${VECTOR} ${DATE} | Standard.Base.Nothing.Nothing`,
    `Standard.Base.Data.Vector.Vector_Like ${DATE}`,
  ])('%s has no single element type', (type) => {
    expect(vectorElementType(type)).toBeUndefined()
  })
})

describe('defaultItemCode', () => {
  test('a new date or time starts as today or now', () => {
    expect(defaultItemCode(DATE)).toBe('Date.today')
    expect(defaultItemCode('Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day')).toBe(
      'Time_Of_Day.now',
    )
  })

  test('a new date-time starts as now', () => {
    expect(defaultItemCode('Standard.Base.Data.Time.Date_Time.Date_Time')).toBe('Date_Time.now')
  })

  test('other types keep the placeholder', () => {
    expect(defaultItemCode('Standard.Base.Data.Text.Text')).toBeUndefined()
    expect(defaultItemCode(undefined)).toBeUndefined()
  })
})

test('a union element type', () => {
  expect(
    vectorElementType(
      `${VECTOR} (Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer)`,
    ),
  ).toBe('Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer')
})

test.each([
  [{ kind: 'Single_Choice', values: [{ value: '..A', label: 'A', parameters: [] }] }, '..A'],
  [
    {
      kind: 'Union',
      kinds: [
        { label: 'Text', config: { kind: 'Text_Input' } },
        { label: 'Nothing', config: null },
      ],
    },
    "''",
  ],
  [
    {
      kind: 'Union',
      kinds: [
        { label: 'Odd', config: { kind: 'Union', kinds: [] } },
        { label: 'Text', config: { kind: 'Text_Input' } },
      ],
    },
    "''",
  ],
  [{ kind: 'Numeric_Input' }, '0'],
  [{ kind: 'Date_Input' }, 'Date.today'],
  [{ kind: 'Regex_Input' }, "regex '.*'"],
  [undefined, undefined],
] as const)('vectorItemDefault(%o)', (config, expected) => {
  expect(vectorItemDefault(config as never)).toBe(expected)
})

test('vectorItemKind is the kind whose default (and imports) a new item takes', () => {
  const secret = { kind: 'Secret_Browse' } as const
  const union = {
    kind: 'Union',
    kinds: [
      { label: 'Odd', config: { kind: 'Any_To_Target' } },
      { label: 'Enso_Secret', config: secret },
      { label: 'Text', config: { kind: 'Text_Input' } },
    ],
  } as const
  expect(vectorItemKind(union as never)).toBe(secret)
  expect(vectorItemKind(secret)).toBe(secret)
  expect(vectorItemKind({ kind: 'Any_To_Target' })).toBeUndefined()
  expect(vectorItemKind({ kind: 'Union', kinds: [{ label: 'Nothing', config: null }] })).toBeNull()
  expect(vectorItemDefault(union as never)).toBe("Enso_Secret.get ''")
})
