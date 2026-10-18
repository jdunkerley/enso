import { describe, expect, test } from 'vitest'
import { Column, getColumnList } from '../columnUtils'

describe('getColumnList: the labels column', () => {
  test('is shown for a backend that supports labels', () => {
    expect(getColumnList('local', false, true)).toContain(Column.labels)
  })

  test('is hidden for a backend that supports none', () => {
    expect(getColumnList('local', false, false)).not.toContain(Column.labels)
  })
})
