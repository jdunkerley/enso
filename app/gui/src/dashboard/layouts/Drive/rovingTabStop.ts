/**
 * @file The drive table's single tab stop: which row is in the Tab sequence (`tabindex="0"`), and
 * keeping the controls inside every other row out of it.
 */
import { useMutationObserver } from '@vueuse/core'
import { computed, shallowRef, toValue, watch, type MaybeRefOrGetter, type ShallowRef } from 'vue'

/**
 * The index of the row that holds the tab stop: the row focused last, while it is listed; else the
 * first selected row; else the first row. `-1` when there are no rows.
 */
export function rovingTabStopIndex<Key>(
  keys: readonly Key[],
  lastFocusedKey: Key | null,
  isSelected: (key: Key) => boolean,
) {
  if (keys.length === 0) return -1
  if (lastFocusedKey != null) {
    const focusedIndex = keys.indexOf(lastFocusedKey)
    if (focusedIndex !== -1) return focusedIndex
  }
  const selectedIndex = keys.findIndex(isSelected)
  return selectedIndex !== -1 ? selectedIndex : 0
}

/**
 * The roving tab stop of a list of rows (the ARIA grid pattern): exactly one row is tabbable, and
 * it follows the focus, so that Tab leaves the grid and Shift+Tab comes back to the row last used.
 */
export function useRovingTabStop<Key>(
  keys: MaybeRefOrGetter<readonly Key[]>,
  isSelected: (key: Key) => boolean,
) {
  const lastFocusedKey: ShallowRef<Key | null> = shallowRef(null)
  const index = computed(() => rovingTabStopIndex(toValue(keys), lastFocusedKey.value, isSelected))
  return {
    /** The index of the tabbable row; `-1` when there are none. */
    index,
    /** Make the row with this key the tab stop: call it whenever focus enters a row. */
    setTabStop(key: Key) {
      lastFocusedKey.value = key
    },
  }
}

/** Elements that are in the Tab sequence by default. Text fields are left alone: see below. */
const TABBABLE_SELECTOR = 'a[href], button, select, [tabindex]:not([tabindex="-1"])'
/** Marks an element whose `tabindex` this module set, so that it can be restored. */
const DEMOTED_ATTRIBUTE = 'data-roving-demoted'

/**
 * While `isTabStop` is false, take the tabbable controls inside `element` (but not the element
 * itself) out of the Tab sequence; put them back when it becomes true. Controls added later (a
 * spinner turning back into a button) are caught by a mutation observer.
 *
 * Text fields (the rename field) are never demoted: one only appears in a row being edited, which
 * takes the focus, and so becomes the tab stop anyway.
 */
export function useTabStopContents(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
  isTabStop: MaybeRefOrGetter<boolean>,
) {
  /** Bring the controls' `tabindex` in line with `isTabStop`. */
  const sync = () => {
    const root = toValue(element)
    if (root == null) return
    if (toValue(isTabStop)) {
      for (const demoted of root.querySelectorAll(`[${DEMOTED_ATTRIBUTE}]`)) {
        const original = demoted.getAttribute(DEMOTED_ATTRIBUTE)
        if (original === '') demoted.removeAttribute('tabindex')
        else if (original != null) demoted.setAttribute('tabindex', original)
        demoted.removeAttribute(DEMOTED_ATTRIBUTE)
      }
    } else {
      for (const tabbable of root.querySelectorAll(TABBABLE_SELECTOR)) {
        if (tabbable === root || tabbable.hasAttribute(DEMOTED_ATTRIBUTE)) continue
        tabbable.setAttribute(DEMOTED_ATTRIBUTE, tabbable.getAttribute('tabindex') ?? '')
        tabbable.setAttribute('tabindex', '-1')
      }
    }
  }
  watch([() => toValue(element), () => toValue(isTabStop)], sync, {
    immediate: true,
    flush: 'post',
  })
  useMutationObserver(element, sync, { childList: true, subtree: true })
}
