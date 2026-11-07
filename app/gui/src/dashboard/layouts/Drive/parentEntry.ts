/**
 * @file The drive table's parent-folder entry (#640): the `..` row at the top of the listing of a
 * folder below its category's root, which opens the folder above and takes drops to move assets
 * there. It is not an asset: it is never selected, sorted, renamed, dragged, deleted or labelled.
 *
 * In the table's keyboard model it is the row at index {@link PARENT_ENTRY_INDEX}, before the
 * first asset (index 0), and in the roving tab stop's keys it is {@link PARENT_ENTRY_KEY}.
 */
import type { DirectoryId } from 'enso-common/src/services/Backend'

/** The keyboard index of the parent-folder entry: just before the first asset. */
export const PARENT_ENTRY_INDEX = -1

/** The parent-folder entry's key among the roving tab stop's row keys. */
export const PARENT_ENTRY_KEY = 'parent-directory-entry'

/** What opening the parent folder from the entry is, for the drive to show the entry's spinner. */
export const PARENT_ENTRY_NAVIGATION_SOURCE = Symbol('parent-directory-entry')

/** What decides whether the entry is shown. */
export interface ParentEntryState {
  /** Whether the category is a Recent list, which has no folders to go up through. */
  readonly isRecent: boolean
  /** Whether the listing is of search results rather than of the folder. */
  readonly isSearching: boolean
  /** The folder shown. */
  readonly currentDirectoryId: DirectoryId
  /** The category's root folder. */
  readonly categoryRootId: DirectoryId
  /** The parent of the folder shown, once its details have loaded. */
  readonly parentId: DirectoryId | null | undefined
}

/**
 * The folder the entry opens, or `null` when there is no entry: at a category's root, in a Recent
 * list, in search results, and until the shown folder's parent is known.
 */
export function parentEntryDirectoryId(state: ParentEntryState): DirectoryId | null {
  if (state.isRecent || state.isSearching) return null
  if (state.currentDirectoryId === state.categoryRootId) return null
  if (state.parentId == null || state.parentId === state.currentDirectoryId) return null
  return state.parentId
}

/**
 * The keyboard index an arrow key moves to from `oldIndex`, among `count` assets. With the entry
 * shown, ArrowUp from the first asset reaches it ({@link PARENT_ENTRY_INDEX}), except while
 * extending the selection with Shift: the entry cannot be selected.
 */
export function arrowKeyIndex(
  oldIndex: number,
  direction: 'down' | 'up',
  count: number,
  hasParentEntry: boolean,
  isExtendingSelection: boolean,
) {
  const minIndex = hasParentEntry && !isExtendingSelection ? PARENT_ENTRY_INDEX : 0
  return direction === 'up' ?
      Math.max(minIndex, oldIndex - 1)
    : Math.max(minIndex, Math.min(count - 1, oldIndex + 1))
}
