import { describe, expect, test } from 'vitest'
import {
  Column,
  COLUMN_WIDTH_LIMITS,
  columnWidthsSchema,
  DEFAULT_ENABLED_COLUMNS,
  enabledColumnsSchema,
  getColumnList,
} from '../columnUtils'

describe('getColumnList: the labels column', () => {
  test('is shown for a backend that supports labels', () => {
    expect(getColumnList('local', false, true)).toContain(Column.labels)
  })

  test('is hidden for a backend that supports none', () => {
    expect(getColumnList('local', false, false)).not.toContain(Column.labels)
  })
})

describe('enabledColumnsSchema', () => {
  test('drops the unknown columns of a mixed list, and keeps the rest', () => {
    expect(enabledColumnsSchema.parse(['name', 'sharedWith', 'labels', 'userPermissions'])).toEqual(
      [Column.name, Column.labels],
    )
  })

  test('falls back to the default columns when none of the saved ones exist', () => {
    expect(enabledColumnsSchema.parse(['sharedWith', 'userPermissions'])).toEqual([
      ...DEFAULT_ENABLED_COLUMNS,
    ])
  })

  test('keeps a list of known columns as it is', () => {
    expect(enabledColumnsSchema.parse(['size', 'name'])).toEqual([Column.size, Column.name])
  })
})

describe('columnWidthsSchema', () => {
  test('keeps the saved widths of known columns', () => {
    expect(columnWidthsSchema.parse({ name: 400, modified: 150 })).toEqual({
      name: 400,
      modified: 150,
    })
  })

  test('drops columns that no longer exist, and values that are not widths', () => {
    expect(
      columnWidthsSchema.parse({ sharedWith: 200, labels: 'wide', path: Number.NaN, size: 120 }),
    ).toEqual({ size: 120 })
  })

  test('brings a saved width inside its column’s limits', () => {
    const { min, max } = COLUMN_WIDTH_LIMITS[Column.modified]
    expect(columnWidthsSchema.parse({ modified: 1, createdAt: 99_999 })).toEqual({
      modified: min,
      createdAt: COLUMN_WIDTH_LIMITS[Column.createdAt].max,
    })
    expect(min).toBeLessThan(max)
  })

  test('reads anything that is not an object as no saved widths', () => {
    expect(columnWidthsSchema.safeParse([100, 200]).success).toBe(false)
  })
})

describe('COLUMN_WIDTH_LIMITS', () => {
  test('every default width lies inside its limits', () => {
    for (const column of Object.values(Column)) {
      const { min, max, defaultWidth } = COLUMN_WIDTH_LIMITS[column]
      expect(min).toBeGreaterThan(0)
      if (defaultWidth != null) {
        expect(defaultWidth).toBeGreaterThanOrEqual(min)
        expect(defaultWidth).toBeLessThanOrEqual(max)
      }
    }
  })

  test('only the name column fills the remaining space by default', () => {
    expect(COLUMN_WIDTH_LIMITS[Column.name].defaultWidth).toBeNull()
    for (const column of Object.values(Column).filter((other) => other !== Column.name)) {
      expect(COLUMN_WIDTH_LIMITS[column].defaultWidth).not.toBeNull()
    }
  })
})
