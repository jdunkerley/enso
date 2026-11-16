/**
 * @file The table's right-click menu: the entries the value's actions make for the clicked cell.
 * Snapshotted, through `menuNode`, by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import type { Pattern } from '@/util/ast/match'
import { actionPattern, findAction, type VizAction } from '../vizActions'
import { INDEX_FIELD_NAME, linkPattern } from './tableView'

/** One item of the menu: what it shows, and the node it creates. */
export interface TableMenuEntry {
  name: string
  icon: string
  pattern: Pattern
}

const MENU_ACTIONS = ['open_column', 'open_row', 'open_cell'] as const

/**
 * The menu of the cell at `column` in `row`: the value's `open_column`, `open_row` and
 * `open_cell` actions, filled from the cell. The row is identified by its `#` number, which
 * survives sorting, not by its place on screen. The row-number column is not a column of the
 * value, so it offers only the row. An entry whose action the value lacks, or whose values the
 * click does not give, is left out. When the value offers no row action, the view's `link`
 * stands in for it.
 */
export function tableMenuEntries(
  actions: readonly VizAction[],
  link: { action: string; label?: string | undefined } | undefined,
  column: string | null,
  row: Record<string, unknown> | null,
): TableMenuEntry[] {
  const rowNumber = row?.[INDEX_FIELD_NAME]
  const index = typeof rowNumber === 'number' || typeof rowNumber === 'string' ? rowNumber : null
  const values = { column: column === INDEX_FIELD_NAME ? null : column, index }
  const entries = MENU_ACTIONS.flatMap((id) => {
    const action = findAction(actions, id)
    const pattern = action && actionPattern(action, values)
    return action && pattern ? [{ name: action.label, icon: action.icon, pattern }] : []
  })
  if (findAction(actions, 'open_row') == null && link != null && row != null) {
    const pattern = linkPattern(row, link.action)
    const label = link.label ?? 'value'
    if (pattern) {
      entries.push({
        name: `Open This ${label.charAt(0).toUpperCase()}${label.slice(1)}`,
        icon: 'select_row',
        pattern,
      })
    }
  }
  return entries
}
