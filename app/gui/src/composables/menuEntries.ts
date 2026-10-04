/**
 * @file The Vue counterpart of the React `useMenuEntries` (`#/hooks/menuHooks`): a menu's entries
 * are also global actions. While the component that declares them is mounted:
 *
 * - each enabled entry is in the command palette (`$/providers/actions`), named and grouped as
 *   in the keyboard-shortcuts settings, with its current shortcuts;
 * - each entry's shortcut runs it, from anywhere in the document (as React's, which attach to
 *   `document.body` outside a binding focus scope).
 *
 * The shortcuts are the user's (`$/providers/dashboardInputBindings`), read when an event arrives, so a
 * rebinding applies at once, as in React.
 *
 * A `target` scopes the shortcuts to an element and its descendants, as React's binding focus scope
 * (`BindingFocusScopeContext`) did for the drive's context menus: their shortcuts act only on a key
 * pressed inside the assets table.
 */
import { actionToTextId, type DashboardBindingKey } from '$/configurations/inputBindings'
import { useActionsStore, type Action } from '$/providers/actions'
import { useDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useText } from '$/providers/text'
import { DEFAULT_HANDLER } from '$/utils/inputBindings'
import type { Icon } from '@/util/iconMetadata/iconName'
import { computed, onMounted, onUnmounted, toRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** What {@link useMenuEntries} needs of an entry: its action, and how to run it. */
export interface MenuEntryAction {
  readonly action: DashboardBindingKey
  readonly doAction: () => void
  readonly isDisabled?: boolean | undefined
  readonly icon?: Icon | undefined
}

/**
 * Make a menu's entries global actions, as React's `useMenuEntries` does (see the file comment).
 * `entries` may leave an entry out with `false`, `null` or `undefined`.
 * @returns the entries, without the left-out ones.
 */
export function useMenuEntries<Entry extends MenuEntryAction>(
  entries: MaybeRefOrGetter<readonly (Entry | false | null | undefined)[]>,
  target?: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
  const inputBindings = useDashboardInputBindings()
  const { getText } = useText()
  const { bindGlobalActions } = useActionsStore()

  const present = computed(() =>
    toValue(entries).filter((entry): entry is Entry => entry != null && entry !== false),
  )

  // A getter, not a `computed`: the bindings are not reactive, and the palette reads this when it
  // searches, so it always sees the current ones.
  const actions = toRef((): Action[] =>
    present.value.flatMap((entry) => {
      if (entry.isDisabled === true) return []
      const metadata = inputBindings.metadata[entry.action]
      return [
        {
          name: getText(actionToTextId(entry.action)),
          category: getText(`${metadata.category}BindingCategory`),
          doAction: entry.doAction,
          shortcuts: metadata.bindings,
          icon: entry.icon ?? metadata.icon,
        },
      ]
    }),
  )

  let unbind: (() => void) | undefined
  let detach: (() => void) | undefined
  function attachTo(element: HTMLElement) {
    detach?.()
    detach = inputBindings.attach(element, 'keydown', {
      [DEFAULT_HANDLER]: (_event, matchingBindings) => {
        for (const binding of matchingBindings) {
          // The last entry for an action wins, as in React's map of entries by action.
          const entry = present.value.filter((candidate) => candidate.action === binding).at(-1)
          if (!entry || entry.isDisabled === true) continue
          entry.doAction()
          return
        }
        // If no entry matched this binding, do not consider it as handled.
        return false
      },
    })
  }
  onMounted(() => {
    unbind = bindGlobalActions(actions)
    if (target == null) {
      attachTo(document.body)
    } else {
      watch(
        () => toValue(target),
        (element) => {
          detach?.()
          detach = undefined
          if (element != null) attachTo(element)
        },
        { immediate: true },
      )
    }
  })
  onUnmounted(() => {
    unbind?.()
    detach?.()
  })

  return present
}
