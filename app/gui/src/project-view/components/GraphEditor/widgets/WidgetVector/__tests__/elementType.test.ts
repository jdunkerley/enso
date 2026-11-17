/** @file The element type of a `Vector`-typed argument. */
import { describe, expect, test } from 'vitest'
import { defaultItemCode, vectorElementType } from '../elementType'

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
