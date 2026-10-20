import { expect, test } from 'vitest'
import { isNearBottom, OVERSCAN_ROWS, ROW_HEIGHT_PX, visibleRange } from '../engineLogView'

test('visibleRange covers the viewport and the overscan, within the rows', () => {
  expect(ROW_HEIGHT_PX).toBe(18)
  expect(visibleRange(0, 180, 1000)).toEqual({ start: 0, end: 10 + OVERSCAN_ROWS })
  expect(visibleRange(1800, 180, 1000)).toEqual({
    start: 100 - OVERSCAN_ROWS,
    end: 110 + OVERSCAN_ROWS,
  })
  expect(visibleRange(0, 0, 3)).toEqual({ start: 0, end: 3 })
})

test('isNearBottom within one row of the end', () => {
  expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
  expect(isNearBottom({ scrollTop: 885, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
  expect(isNearBottom({ scrollTop: 880, scrollHeight: 1000, clientHeight: 100 })).toBe(false)
})
