<script setup lang="ts">
/**
 * @file The dashboard route: the app container, with the dashboard's global shortcuts (Electron's
 * back and forward, and going to each settings tab).
 *
 * The shortcuts are attached to `document.body` once the container has mounted, so that the
 * container's own shortcuts on the body see a key first, and are in the command palette.
 */
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import AppContainer from '$/components/AppContainer'
import { actionToTextId, type DashboardBindingKey } from '$/configurations/inputBindings'
import SettingsTabType from '$/configurations/settingsTabs'
import { useActionsStore, type Action } from '$/providers/actions'
import { useBackends } from '$/providers/backends'
import { useDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { unsafeEntries } from 'enso-common/src/utilities/data/object'
import { isOnElectron } from 'enso-common/src/utilities/detect'
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'

/** A dashboard shortcut's handler: returning `false` leaves the event unhandled. */
type Handler = () => boolean | void

const router = useRouter()
const backends = useBackends()
const modals = useModals()
const inputBindings = useDashboardInputBindings()
const { bindGlobalActions } = useActionsStore()
const { getText } = useText()

/** Navigate to a specific settings tab. */
function goToSettingsTab(tab: SettingsTabType) {
  void router.push({
    path: '/settings',
    query: { [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(tab) },
  })
}

/** Close every modal; the Escape key is left unhandled when there is none. */
function closeModal() {
  if (!modals.closeAll()) return false
}

const handlers = computed((): Partial<Record<DashboardBindingKey, Handler>> => ({
  // We want to handle the back and forward buttons in electron the same way as in the browser.
  ...(isOnElectron() && {
    goBack: () => {
      window.api?.navigation.goBack()
    },
    goForward: () => {
      window.api?.navigation.goForward()
    },
    goToAccountSettings: () => goToSettingsTab(SettingsTabType.account),
    ...(backends.localBackend != null && {
      goToLocalSettings: () => goToSettingsTab(SettingsTabType.local),
    }),
    goToKeyboardShortcutsSettings: () => goToSettingsTab(SettingsTabType.keyboardShortcuts),
  }),
  closeModal,
}))

// The shortcuts, in the command palette under their names from the keyboard shortcuts settings.
const actions = computed((): Action[] =>
  unsafeEntries(handlers.value).flatMap(([action, doAction]) => {
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
  }),
)

let detach: (() => void) | undefined
let unbind: (() => void) | undefined
onMounted(() => {
  unbind = bindGlobalActions(actions)
  watch(
    handlers,
    (current) => {
      detach?.()
      detach = inputBindings.attach(document.body, 'keydown', current)
    },
    { immediate: true },
  )
})
onUnmounted(() => {
  unbind?.()
  detach?.()
})

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  modals.closeAll()
}
</script>

<template>
  <div class="flex h-full flex-col text-xs text-primary" @contextmenu="onContextMenu">
    <AppContainer />
  </div>
</template>
