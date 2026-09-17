import { ref, type Ref } from 'vue'

/** A single grid cell, identified the same way AG Grid identifies cells in its own events. */
export interface CellCoord {
  rowIndex: number
  colId: string
}

interface Range {
  anchor: CellCoord
  focus: CellCoord
}

/**
 * Tracks one contiguous rectangular cell selection from Community-native inputs (mouse
 * down/drag, keyboard extension), replacing AG Grid Enterprise's `cellSelection` for the
 * unlicensed fallback. Deliberately supports only a single rectangle — multi-range (ctrl+click)
 * selection isn't used anywhere in this codebase today.
 */
export function useCommunityCellRange(displayedColumnIds: () => string[]) {
  const range: Ref<Range | undefined> = ref(undefined)

  function startAt(coord: CellCoord) {
    range.value = { anchor: coord, focus: coord }
  }

  function extendTo(coord: CellCoord) {
    if (range.value == null) return
    range.value = { anchor: range.value.anchor, focus: coord }
  }

  function clear() {
    range.value = undefined
  }

  function rectangle(): { rowIndices: number[]; colIds: string[] } | undefined {
    const current = range.value
    if (current == null) return undefined
    const columnIds = displayedColumnIds()
    const anchorColIndex = columnIds.indexOf(current.anchor.colId)
    const focusColIndex = columnIds.indexOf(current.focus.colId)
    if (anchorColIndex === -1 || focusColIndex === -1) return undefined

    const minRow = Math.min(current.anchor.rowIndex, current.focus.rowIndex)
    const maxRow = Math.max(current.anchor.rowIndex, current.focus.rowIndex)
    const minCol = Math.min(anchorColIndex, focusColIndex)
    const maxCol = Math.max(anchorColIndex, focusColIndex)

    const rowIndices = Array.from({ length: maxRow - minRow + 1 }, (_, i) => minRow + i)
    const colIds = columnIds.slice(minCol, maxCol + 1)
    return { rowIndices, colIds }
  }

  function isInRange(coord: CellCoord): boolean {
    const rect = rectangle()
    if (rect == null) return false
    return rect.rowIndices.includes(coord.rowIndex) && rect.colIds.includes(coord.colId)
  }

  return { range, startAt, extendTo, clear, isInRange, rectangle }
}
