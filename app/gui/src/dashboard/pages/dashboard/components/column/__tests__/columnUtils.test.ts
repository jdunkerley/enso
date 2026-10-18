import { describe, expect, test } from 'vitest'
import {
  Column,
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
