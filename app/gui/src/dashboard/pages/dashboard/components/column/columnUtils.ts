/** @file Types and constants related to `Column`s. */
import { isRecentCategory, type CategoryType } from '$/providers/category'
import { clampWidth, type WidthLimits } from '$/utils/columnResize'
import type { Icon } from '@/util/iconMetadata/iconName'
import * as z from 'zod'

/** Column type. */
export enum Column {
  name = 'name',
  modified = 'modified',
  createdAt = 'createdAt',
  labels = 'labels',
  path = 'path',
  accessedByProjects = 'accessedByProjects',
  accessedData = 'accessedData',
  size = 'size',
}

export const DEFAULT_ENABLED_COLUMNS: ReadonlySet<Column> = new Set([
  Column.name,
  Column.modified,
  Column.createdAt,
  Column.labels,
  Column.path,
  Column.size,
])

export const COLUMN_ICONS: Readonly<Record<Column, Icon>> = {
  /* The file column does not have an icon, however this does not matter as it is not
   * collapsible. */
  [Column.name]: 'ghost',
  [Column.modified]: 'time',
  [Column.createdAt]: 'time',
  [Column.labels]: 'tag',
  [Column.accessedByProjects]: 'accessed_by_projects',
  [Column.accessedData]: 'accessed_data',
  [Column.path]: 'folder',
  [Column.size]: 'metadata',
}

const COLUMN_CSS_CLASSES = 'text-left bg-clip-padding last:border-r-0 last:rounded-r-full'
const NORMAL_COLUMN_CSS_CLASSES = `px-cell-x py rounded-rows-have-level ${COLUMN_CSS_CLASSES}`

/**
 * CSS classes for every column. The widths are not here: they are the table's `<col>`s, set from
 * {@link COLUMN_WIDTH_LIMITS} and the user's resizing.
 */
export const COLUMN_CSS_CLASS: Readonly<Record<Column, string>> = {
  [Column.name]: `z-10 sticky left-1 bg-dashboard rounded-rows-skip-level h-full p-0 border-l-0 after:absolute after:right-0 after:top-0 after:bottom-0 after:border-r-[1.5px] after:border-primary/5 ${COLUMN_CSS_CLASSES}`,
  [Column.modified]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.createdAt]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.labels]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.accessedByProjects]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.accessedData]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.path]: NORMAL_COLUMN_CSS_CLASSES,
  [Column.size]: NORMAL_COLUMN_CSS_CLASSES,
}

/**
 * Return the full list of columns given the relevant current state. `supportsLabels` is whether the
 * backend can label assets of any type (`supportsAnyLabels`).
 */
export function getColumnList(
  category: CategoryType,
  isSearching: boolean,
  supportsLabels: boolean,
): readonly Column[] {
  const isRecent = isRecentCategory(category)

  const columns = [
    Column.name,
    Column.modified,
    Column.createdAt,
    (isRecent || isSearching) && Column.path,
    supportsLabels && Column.labels,
  ] as const

  return columns.flatMap((column) => (column !== false ? [column] : []))
}

const COLUMN_NAMES: readonly string[] = Object.values(Column)

/**
 * The schema of the saved list of enabled columns. A column that no longer exists (such as "Shared
 * with") is dropped, not a reason to forget the user's other choices; and a list of only such
 * columns, which would leave nothing to show, is replaced by the defaults. The schema reads any
 * strings, which the column type cannot express.
 */
const readEnabledColumns = z
  .string()
  .array()
  .transform((columns) => {
    const known = columns.filter((column): column is Column => COLUMN_NAMES.includes(column))
    return columns.length > 0 && known.length === 0 ? [...DEFAULT_ENABLED_COLUMNS] : known
  })
  .readonly()

// `LocalStorage` wants a schema whose input is its output.
// eslint-disable-next-line no-restricted-syntax
export const enabledColumnsSchema = readEnabledColumns as z.ZodType<readonly Column[]>

/** The limits of a column's width, and its width until the user resizes it. */
export interface ColumnWidthLimits extends WidthLimits {
  /** The default width in pixels, or `null` for the column that fills the remaining space. */
  readonly defaultWidth: number | null
}

/**
 * The name column's minimum: wider than its cells' own minimum (`min-w-48`), so that a badge after
 * the name still leaves some of the name.
 */
const NAME_MIN_WIDTH_PX = 240
const NAME_MAX_WIDTH_PX = 1200
/** The minimum of the date columns, which fits their headings' hide and sort icons. */
const DATE_MIN_WIDTH_PX = 128
const DATE_DEFAULT_WIDTH_PX = 133
const TEXT_MIN_WIDTH_PX = 96
const TEXT_DEFAULT_WIDTH_PX = 240
/** Room for several labels before they are cut off. */
const LABELS_DEFAULT_WIDTH_PX = 300
const SIZE_MIN_WIDTH_PX = 80
const SIZE_DEFAULT_WIDTH_PX = 96
const MAX_WIDTH_PX = 800

/**
 * The widths of the columns, in pixels. The name column fills what the others leave; every other
 * minimum fits the column's heading.
 */
export const COLUMN_WIDTH_LIMITS: Readonly<Record<Column, ColumnWidthLimits>> = {
  [Column.name]: { min: NAME_MIN_WIDTH_PX, max: NAME_MAX_WIDTH_PX, defaultWidth: null },
  [Column.modified]: {
    min: DATE_MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    defaultWidth: DATE_DEFAULT_WIDTH_PX,
  },
  [Column.createdAt]: {
    min: DATE_MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    defaultWidth: DATE_DEFAULT_WIDTH_PX,
  },
  [Column.labels]: {
    min: TEXT_MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    defaultWidth: LABELS_DEFAULT_WIDTH_PX,
  },
  [Column.path]: { min: TEXT_MIN_WIDTH_PX, max: MAX_WIDTH_PX, defaultWidth: TEXT_DEFAULT_WIDTH_PX },
  [Column.accessedByProjects]: {
    min: TEXT_MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    defaultWidth: TEXT_DEFAULT_WIDTH_PX,
  },
  [Column.accessedData]: {
    min: TEXT_MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    defaultWidth: TEXT_DEFAULT_WIDTH_PX,
  },
  [Column.size]: { min: SIZE_MIN_WIDTH_PX, max: MAX_WIDTH_PX, defaultWidth: SIZE_DEFAULT_WIDTH_PX },
}

/** The widths the user has given columns, in pixels; a column not listed has its default width. */
export type SavedColumnWidths = Readonly<Partial<Record<Column, number>>>

/**
 * The schema of the saved column widths. A column that no longer exists, or a value that is not a
 * width, is dropped; a width outside its column's limits is brought inside them.
 */
const readColumnWidths = z.record(z.string(), z.unknown()).transform((saved) => {
  const widths: Partial<Record<Column, number>> = {}
  for (const column of Object.values(Column)) {
    const width = saved[column]
    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[column] = clampWidth(width, COLUMN_WIDTH_LIMITS[column])
    }
  }
  return widths
})

// `LocalStorage` wants a schema whose input is its output.
// eslint-disable-next-line no-restricted-syntax
export const columnWidthsSchema = readColumnWidths as z.ZodType<SavedColumnWidths>
