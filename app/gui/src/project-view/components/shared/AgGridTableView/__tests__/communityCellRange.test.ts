import { describe, expect, test } from 'vitest'
import { cellCoordFromEvent, useCommunityCellRange } from '../communityCellRange'

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

describe('useCommunityCellRange change reporting', () => {
  // Callers repaint the grid only when these report `true`. `mouseover` fires continuously while
  // dragging within one cell, and repainting on every event re-rendered the whole grid many times
  // a second, leaving no cell stable between animation frames.
  test('extendTo reports no change when the focus cell is unchanged', () => {
    const { startAt, extendTo } = useCommunityCellRange(columnIds)
    startAt({ rowIndex: 0, colId: 'a' })
    expect(extendTo({ rowIndex: 2, colId: 'b' })).toBe(true)
    expect(extendTo({ rowIndex: 2, colId: 'b' })).toBe(false)
    expect(extendTo({ rowIndex: 2, colId: 'c' })).toBe(true)
  })

  test('extendTo reports no change when there is no range to extend', () => {
    const { extendTo } = useCommunityCellRange(columnIds)
    expect(extendTo({ rowIndex: 1, colId: 'a' })).toBe(false)
  })

  test('startAt reports no change when it would re-anchor on the same single cell', () => {
    const { startAt, extendTo } = useCommunityCellRange(columnIds)
    expect(startAt({ rowIndex: 1, colId: 'b' })).toBe(true)
    expect(startAt({ rowIndex: 1, colId: 'b' })).toBe(false)
    expect(startAt({ rowIndex: 1, colId: 'c' })).toBe(true)
    // Collapsing a multi-cell range back to its anchor *is* a change.
    extendTo({ rowIndex: 3, colId: 'd' })
    expect(startAt({ rowIndex: 1, colId: 'c' })).toBe(true)
  })
})

describe('cellCoordFromEvent', () => {
  function eventOn(html: string, selector: string): Event {
    const root = document.createElement('div')
    root.innerHTML = html
    const target = root.querySelector(selector)!
    const event = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }

  test('reads the row index and column id AG Grid renders on a body cell', () => {
    const html =
      '<div class="ag-row" row-index="3"><div class="ag-cell" col-id="Value"><span>x</span></div></div>'
    expect(cellCoordFromEvent(eventOn(html, 'span'))).toEqual({ rowIndex: 3, colId: 'Value' })
    expect(cellCoordFromEvent(eventOn(html, '.ag-cell'))).toEqual({ rowIndex: 3, colId: 'Value' })
  })

  test('ignores events outside a body cell', () => {
    expect(cellCoordFromEvent(eventOn('<div class="ag-row" row-index="1"></div>', '.ag-row'))).toBe(
      undefined,
    )
    const header = '<div class="ag-header-cell" col-id="Value"><span>Value</span></div>'
    expect(cellCoordFromEvent(eventOn(header, 'span'))).toBeUndefined()
  })

  test('ignores pinned rows, whose row-index is not a body row index', () => {
    const html = '<div class="ag-row" row-index="t-0"><div class="ag-cell" col-id="a"></div></div>'
    expect(cellCoordFromEvent(eventOn(html, '.ag-cell'))).toBeUndefined()
  })
})
