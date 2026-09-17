import { describe, expect, test } from 'vitest'
import { useCommunityCellRange } from '../communityCellRange'

const columnIds = () => ['a', 'b', 'c', 'd']

describe('useCommunityCellRange', () => {
  test('has no range until startAt is called', () => {
    const { range, isInRange } = useCommunityCellRange(columnIds)
    expect(range.value).toBeUndefined()
    expect(isInRange({ rowIndex: 0, colId: 'a' })).toBe(false)
  })

  test('startAt sets a single-cell range', () => {
    const { rectangle, startAt, isInRange } = useCommunityCellRange(columnIds)
    startAt({ rowIndex: 2, colId: 'b' })
    expect(rectangle()).toEqual({ rowIndices: [2], colIds: ['b'] })
    expect(isInRange({ rowIndex: 2, colId: 'b' })).toBe(true)
    expect(isInRange({ rowIndex: 2, colId: 'c' })).toBe(false)
  })

  test('extendTo grows the rectangle regardless of drag direction', () => {
    const { rectangle, startAt, extendTo, isInRange } = useCommunityCellRange(columnIds)
    startAt({ rowIndex: 3, colId: 'c' })
    extendTo({ rowIndex: 1, colId: 'a' })
    expect(rectangle()).toEqual({
      rowIndices: [1, 2, 3],
      colIds: ['a', 'b', 'c'],
    })
    expect(isInRange({ rowIndex: 1, colId: 'a' })).toBe(true)
    expect(isInRange({ rowIndex: 3, colId: 'c' })).toBe(true)
    expect(isInRange({ rowIndex: 0, colId: 'a' })).toBe(false)
    expect(isInRange({ rowIndex: 1, colId: 'd' })).toBe(false)
  })

  test('extendTo without a prior startAt is a no-op', () => {
    const { rectangle, extendTo } = useCommunityCellRange(columnIds)
    extendTo({ rowIndex: 1, colId: 'a' })
    expect(rectangle()).toBeUndefined()
  })

  test('clear removes the range', () => {
    const { rectangle, startAt, extendTo, clear } = useCommunityCellRange(columnIds)
    startAt({ rowIndex: 0, colId: 'a' })
    extendTo({ rowIndex: 1, colId: 'b' })
    clear()
    expect(rectangle()).toBeUndefined()
  })

  test('a second startAt replaces the previous range rather than extending it', () => {
    const { rectangle, startAt } = useCommunityCellRange(columnIds)
    startAt({ rowIndex: 0, colId: 'a' })
    startAt({ rowIndex: 5, colId: 'd' })
    expect(rectangle()).toEqual({ rowIndices: [5], colIds: ['d'] })
  })
})
