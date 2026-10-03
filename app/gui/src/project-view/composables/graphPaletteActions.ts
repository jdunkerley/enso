/**
 * @file The graph editor's rebindable actions in the command palette (#170): while the graph editor
 * is the current tab, each enabled action is in the palette, named and grouped as in the Keyboard
 * shortcuts settings tab, with its current shortcuts (the user's, when changed).
 */
import { categoryToTextId } from '$/configurations/keyboardShortcuts'
import { useActionsStore, type Action as PaletteAction } from '$/providers/actions'
import { getInputBindingsStore } from '$/providers/inputBindings'
import { useText } from '$/providers/text'
import type { Action } from '@/providers/action'
import { onScopeDispose, toRef, toValue, watch, type WatchSource } from 'vue'

/**
 * Put the graph editor's rebindable actions in the command palette while `active` is true.
 * @param handlers - the graph editor's actions (`registerHandlers`' result), by name.
 */
export function useGraphPaletteActions(
  handlers: Readonly<Partial<Record<string, Action>>>,
  active: WatchSource<boolean>,
) {
  const { bindGlobalActions } = useActionsStore()
  const { getText } = useText()
  const inputBindings = getInputBindingsStore()

  // A getter: the palette reads it when it searches, so it sees the current state and shortcuts.
  const actions = toRef((): PaletteAction[] =>
    inputBindings.shortcuts.flatMap((shortcut) => {
      if (shortcut.owner !== 'graph' || !shortcut.rebindable || shortcut.category == null) return []
      const handler = handlers[shortcut.id]
      if (handler?.action == null) return []
      if (toValue(handler.available) === false || toValue(handler.enabled) === false) return []
      return [
        {
          name: getText(shortcut.nameTextId),
          category: getText(categoryToTextId(shortcut.category)),
          doAction: () => handler.action?.(undefined),
          shortcuts: shortcut.bindings,
          icon: shortcut.icon,
        },
      ]
    }),
  )

  let unbind: (() => void) | undefined
  watch(
    active,
    (isActive) => {
      unbind?.()
      unbind = isActive ? bindGlobalActions(actions) : undefined
    },
    { immediate: true },
  )
  onScopeDispose(() => unbind?.())
}
