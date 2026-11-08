/** @file The drive's column widths: defaults, clamping, saving and resetting. */
import { Column, COLUMN_WIDTH_LIMITS } from '#/pages/dashboard/components/column/columnUtils'
import LocalStorage from '$/utils/LocalStorage'
import { afterEach, describe, expect, test } from 'vitest'
import { useColumnWidths } from '../columnWidths'

afterEach(() => {
  LocalStorage.getInstance().delete('driveColumnWidths')
})

describe('useColumnWidths', () => {
  test('starts at the default widths, with the name column filling', () => {
    const widths = useColumnWidths()
    expect(widths.widthOf(Column.name)).toBeNull()
    expect(widths.widthOf(Column.modified)).toBe(COLUMN_WIDTH_LIMITS[Column.modified].defaultWidth)
  })

  test('clamps a new width to the column’s limits', () => {
    const widths = useColumnWidths()
    widths.setWidth(Column.labels, 1)
    expect(widths.widthOf(Column.labels)).toBe(COLUMN_WIDTH_LIMITS[Column.labels].min)
    widths.setWidth(Column.labels, 100_000)
    expect(widths.widthOf(Column.labels)).toBe(COLUMN_WIDTH_LIMITS[Column.labels].max)
  })

  test('changes a width at once, and saves it only when asked', () => {
    const widths = useColumnWidths()
    widths.setWidth(Column.createdAt, 210)
    widths.setWidth(Column.createdAt, 220)
    expect(widths.widthOf(Column.createdAt)).toBe(220)
    expect(LocalStorage.getInstance().get('driveColumnWidths')).toBeUndefined()
    widths.persist()
    expect(LocalStorage.getInstance().get('driveColumnWidths')).toEqual({ createdAt: 220 })
  })

  test('saves the widths, so that a later drive starts with them', () => {
    const first = useColumnWidths()
    first.setWidth(Column.createdAt, 210)
    first.persist()
    const second = useColumnWidths()
    second.setWidth(Column.name, 300)
    second.persist()
    const later = useColumnWidths()
    expect(later.widthOf(Column.createdAt)).toBe(210)
    expect(later.widthOf(Column.name)).toBe(300)
    expect(LocalStorage.getInstance().get('driveColumnWidths')).toEqual({
      createdAt: 210,
      name: 300,
    })
  })

  test('resets one column to its default, and forgets its saved width', () => {
    const widths = useColumnWidths()
    widths.setWidth(Column.modified, 200)
    widths.setWidth(Column.name, 300)
    widths.persist()
    widths.resetWidth(Column.name)
    expect(widths.widthOf(Column.name)).toBeNull()
    expect(widths.widthOf(Column.modified)).toBe(200)
    expect(useColumnWidths().widthOf(Column.name)).toBeNull()
    expect(LocalStorage.getInstance().get('driveColumnWidths')).toEqual({ modified: 200 })
  })

  describe('tableWidth', () => {
    const others = [Column.modified, Column.createdAt] as const
    const othersWidth = others.reduce(
      (sum, column) => sum + (COLUMN_WIDTH_LIMITS[column].defaultWidth ?? 0),
      0,
    )

    test('fills the panel while the name column fills, but never squeezes it below its minimum', () => {
      const widths = useColumnWidths()
      expect(widths.tableWidth([Column.name, ...others])).toBe(
        `max(100%, ${othersWidth + COLUMN_WIDTH_LIMITS[Column.name].min}px)`,
      )
    })

    test('is the sum of the widths once the name column has one', () => {
      const widths = useColumnWidths()
      widths.setWidth(Column.name, 300)
      expect(widths.tableWidth([Column.name, ...others])).toBe(`${othersWidth + 300}px`)
    })

    test('counts only the columns shown', () => {
      const widths = useColumnWidths()
      widths.setWidth(Column.name, 300)
      expect(widths.tableWidth([Column.name, Column.modified])).toBe(
        `${300 + (COLUMN_WIDTH_LIMITS[Column.modified].defaultWidth ?? 0)}px`,
      )
    })
  })
})
