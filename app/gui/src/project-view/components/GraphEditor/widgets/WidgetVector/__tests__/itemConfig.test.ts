/** @file The configuration of a vector's items. */
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { describe, expect, test } from 'vitest'
import { vectorElementType, vectorItemConfig } from '../elementType'

const DATE = 'Standard.Base.Data.Time.Date.Date'
const VECTOR = 'Standard.Base.Data.Vector.Vector'
const typeDefault = (type: string | undefined): WidgetConfiguration | undefined =>
  type === DATE ? { kind: 'Date_Input' } : undefined

describe('vectorItemConfig', () => {
  test('the item editor wins', () => {
    const itemEditor: WidgetConfiguration = { kind: 'Single_Choice', values: [] }
    expect(vectorItemConfig(itemEditor, DATE, typeDefault)).toBe(itemEditor)
  })

  test('otherwise the element type default', () => {
    expect(vectorItemConfig(undefined, DATE, typeDefault)).toEqual({ kind: 'Date_Input' })
  })

  test('an unknown or missing element type has none', () => {
    expect(vectorItemConfig(undefined, 'Standard.Base.Data.Text.Text', typeDefault)).toBeUndefined()
    expect(vectorItemConfig(undefined, undefined, typeDefault)).toBeUndefined()
  })

  test('a Vector Date gets Date_Input', () => {
    const element = vectorElementType(`${VECTOR} ${DATE}`)
    expect(vectorItemConfig(undefined, element, typeDefault)).toEqual({ kind: 'Date_Input' })
  })
})
