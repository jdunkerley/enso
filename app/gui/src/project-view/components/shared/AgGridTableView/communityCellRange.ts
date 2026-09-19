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

  /**
   * `startAt` and `extendTo` report whether the range actually moved, so callers can skip
   * repainting when it did not. `mouseover` fires repeatedly while the pointer moves *within* one
   * cell, and repainting on each of those forced a full grid re-render many times per second —
   * enough that cell elements were never stable between animation frames.
   */
  function sameCoord(a: CellCoord | undefined, b: CellCoord | undefined): boolean {
    return a?.rowIndex === b?.rowIndex && a?.colId === b?.colId
  }

  function startAt(coord: CellCoord): boolean {
    const current = range.value
    if (current != null && sameCoord(current.anchor, coord) && sameCoord(current.focus, coord)) {
      return false
    }
    range.value = { anchor: coord, focus: coord }
    return true
  }

  function extendTo(coord: CellCoord): boolean {
    if (range.value == null) return false
    if (sameCoord(range.value.focus, coord)) return false
    range.value = { anchor: range.value.anchor, focus: coord }
    return true
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
