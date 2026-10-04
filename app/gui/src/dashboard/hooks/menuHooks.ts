/**
 * @file Binding the dashboard's global actions from React (`Dashboard.tsx`). The menus' own hooks
 * (`useMenuEntries`, `defineMenuEntry`) went with the React drive (#91); the Vue one is
 * `$/composables/menuEntries`.
 */
import { useInputBindings } from '#/providers/InputBindingsProvider'
import { actionToTextId, type DashboardBindingKey } from '$/configurations/inputBindings'
import type { Action } from '$/providers/actions'
import { useActionsStore, useText } from '$/providers/react'
import { unsafeEntries } from 'enso-common/src/utilities/data/object'
import { useEffect } from 'react'
import { ref } from 'vue'

/** Bind global actions given a list of handlers. */
export function useBindGlobalActions(actions: Partial<Record<DashboardBindingKey, () => void>>) {
  const inputBindings = useInputBindings()
  const { bindGlobalActions } = useActionsStore()
  const { getText } = useText()
  const actionsRef = ref<Action[]>([])

  useEffect(() => {
    actionsRef.value = unsafeEntries(actions).flatMap(([action, doAction]) => {
      if (!doAction) return []
      const metadata = inputBindings.metadata[action]
      return [
        {
          name: getText(actionToTextId(action)),
          category: getText(`${metadata.category}BindingCategory`),
          doAction,
          shortcuts: metadata.bindings,
          icon: metadata.icon,
        },
      ]
    })
  }, [actions, actionsRef, bindGlobalActions, getText, inputBindings.metadata])

  useEffect(() => bindGlobalActions(actionsRef), [actionsRef, bindGlobalActions])
}
