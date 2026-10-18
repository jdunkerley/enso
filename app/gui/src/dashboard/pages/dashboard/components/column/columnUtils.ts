/** @file Types and constants related to `Column`s. */
import { isRecentCategory, type CategoryType } from '$/providers/category'
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

const COLUMN_CSS_CLASSES =
  'text-left bg-clip-padding last:border-r-0 last:rounded-r-full last:w-full'
const NORMAL_COLUMN_CSS_CLASSES = `px-cell-x py max-w-96 ${COLUMN_CSS_CLASSES}`

/** CSS classes for every column. */
export const COLUMN_CSS_CLASS: Readonly<Record<Column, string>> = {
  [Column.name]: `z-10 sticky left-1 bg-dashboard rounded-rows-skip-level min-w-80 max-w-80 h-full p-0 border-l-0 after:absolute after:right-0 after:top-0 after:bottom-0 after:border-r-[1.5px] after:border-primary/5 ${COLUMN_CSS_CLASSES}`,
  [Column.modified]: `min-w-drive-modified-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.createdAt]: `min-w-drive-created-at-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.labels]: `min-w-drive-labels-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.accessedByProjects]: `min-w-drive-accessed-by-projects-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.accessedData]: `min-w-drive-accessed-data-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.path]: `min-w-drive-path-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
  [Column.size]: `min-w-drive-size-column rounded-rows-have-level ${NORMAL_COLUMN_CSS_CLASSES}`,
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
