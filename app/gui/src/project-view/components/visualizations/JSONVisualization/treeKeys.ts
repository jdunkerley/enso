/**
 * @file The tree's keyboard: which key does what on a focused row. Pure, so the unit tests drive it
 * directly; `JSONVisualization.vue` carries the result out (moving focus, opening a branch, ...).
 *
 * The keys are those of the ARIA tree pattern: Up and Down move through the visible rows, Right
 * opens a branch (and then steps into it), Left closes it (and then steps out to the branch). Enter
 * does what a double-click does; the context-menu key and Shift+F10 open the entry's menu.
 */
import { pathKey, type TreeRow } from './lazyTree'
import type { TreeKey } from './treeWire'

/** What a key asks for. `none` is a key the tree consumes without anything to do (an edge). */
export type TreeKeyAction =
  | { type: 'none' }
  | { type: 'focus'; row: TreeRow }
  | { type: 'toggle'; path: readonly TreeKey[] }
  | { type: 'activate'; row: TreeRow; all: boolean }
  | { type: 'more'; path: readonly TreeKey[] }
  | { type: 'retry'; path: readonly TreeKey[] }
  | { type: 'menu'; row: TreeRow }

/** The part of a `KeyboardEvent` the tree reads. */
export interface TreeKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Whether a row can hold the focus: an entry, or the "Show more" and "couldn't load" rows. */
export function isNavigable(row: TreeRow): boolean {
  return row.kind === 'entry' || row.kind === 'more' || row.kind === 'error'
}

/** The key of a row in the list (and in the DOM, as `data-row-key`). */
export function rowKey(row: TreeRow): string {
  return `${row.kind}:${pathKey(row.path)}`
}

/** The entry that holds `row`: the one at the branch the row is in, if it is not the root. */
function parentEntry(rows: readonly TreeRow[], row: TreeRow): TreeRow | undefined {
  const parentPath = row.kind === 'entry' ? row.path.slice(0, -1) : row.path
  if (parentPath.length === 0) return undefined
  const key = pathKey(parentPath)
  return rows.find((other) => other.kind === 'entry' && pathKey(other.path) === key)
}

/**
 * What `event` asks of the tree while `row` has the focus, or `undefined` for a key the tree leaves
 * to others (Tab, typing, and anything with Ctrl, Alt or Meta).
 */
export function treeKeyAction(
  rows: readonly TreeRow[],
  row: TreeRow,
  event: TreeKeyEvent,
): TreeKeyAction | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) return undefined
  const isMenuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
  if (event.shiftKey && !isMenuKey && event.key !== 'Enter') return undefined
  const index = rows.indexOf(row)
  const neighbour = (step: 1 | -1): TreeRow | undefined => {
    for (let i = index + step; i >= 0 && i < rows.length; i += step) {
      const candidate = rows[i]
      if (candidate != null && isNavigable(candidate)) return candidate
    }
    return undefined
  }
  const focus = (target: TreeRow | undefined): TreeKeyAction =>
    target != null ? { type: 'focus', row: target } : { type: 'none' }
  const isBranch = row.kind === 'entry' && row.entry.kind !== 'leaf'
  switch (event.key) {
    case 'ArrowDown':
      return focus(neighbour(1))
    case 'ArrowUp':
      return focus(neighbour(-1))
    case 'ArrowRight': {
      if (row.kind !== 'entry' || !isBranch) return { type: 'none' }
      if (!row.expanded) return { type: 'toggle', path: row.path }
      const next = neighbour(1)
      return focus(next != null && next.depth > row.depth ? next : undefined)
    }
    case 'ArrowLeft': {
      if (row.kind === 'entry' && isBranch && row.expanded)
        return { type: 'toggle', path: row.path }
      return focus(parentEntry(rows, row))
    }
    case 'Enter':
      if (row.kind === 'entry') return { type: 'activate', row, all: event.shiftKey }
      if (row.kind === 'more') return { type: 'more', path: row.path }
      if (row.kind === 'error') return { type: 'retry', path: row.path }
      return { type: 'none' }
    case 'ContextMenu':
    case 'F10':
      if (!isMenuKey) return undefined
      return row.kind === 'entry' ? { type: 'menu', row } : { type: 'none' }
    default:
      return undefined
  }
}
