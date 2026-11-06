/** @file The widths of the drive table's columns, as the user resized them. */
import {
  COLUMN_WIDTH_LIMITS,
  columnWidthsSchema,
  type Column,
  type SavedColumnWidths,
} from '#/pages/dashboard/components/column/columnUtils'
import { clampWidth } from '$/utils/columnResize'
import LocalStorage from '$/utils/LocalStorage'
import { omit } from 'enso-common/src/utilities/data/object'
import { shallowRef } from 'vue'

declare module '$/utils/LocalStorage' {
  /** The drive's column widths, as `useColumnWidths` saves them. */
  interface LocalStorageData {
    readonly driveColumnWidths: SavedColumnWidths
  }
}

LocalStorage.registerKey('driveColumnWidths', { schema: columnWidthsSchema })

/**
 * The drive table's column widths: each column's saved width, or its default. They are saved in
 * `localStorage` (`driveColumnWidths`) as they change, and shared by every category. The name column
 * has no default width: it fills the space the other columns leave (never less than its minimum),
 * until the user gives it a width of its own.
 */
export function useColumnWidths() {
  const localStorage = LocalStorage.getInstance()
  const saved = shallowRef<SavedColumnWidths>(localStorage.get('driveColumnWidths') ?? {})

  const save = (widths: SavedColumnWidths) => {
    saved.value = widths
    if (Object.keys(widths).length === 0) localStorage.delete('driveColumnWidths')
    else localStorage.set('driveColumnWidths', widths)
  }

  /** The column's width in pixels, or `null` while the name column fills the remaining space. */
  const widthOf = (column: Column): number | null =>
    saved.value[column] ?? COLUMN_WIDTH_LIMITS[column].defaultWidth

  /** Give the column a width, brought inside its limits. */
  const setWidth = (column: Column, width: number) => {
    save({ ...saved.value, [column]: clampWidth(width, COLUMN_WIDTH_LIMITS[column]) })
  }

  /** Return the column to its default width. */
  const resetWidth = (column: Column) => {
    save(omit(saved.value, column))
  }

  /**
   * The CSS width of a table of these columns: the sum of their widths, or, while a column fills
   * the remaining space, the whole panel, but no less than the columns need.
   */
  const tableWidth = (columns: readonly Column[]): string => {
    let sum = 0
    let fills = false
    for (const column of columns) {
      const width = widthOf(column)
      if (width == null) fills = true
      sum += width ?? COLUMN_WIDTH_LIMITS[column].min
    }
    return fills ? `max(100%, ${sum}px)` : `${sum}px`
  }

  return { widthOf, setWidth, resetWidth, tableWidth }
}
