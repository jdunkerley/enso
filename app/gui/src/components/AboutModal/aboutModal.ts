/**
 * @file Whether the "About Enso" dialog is open. It is global, as the dialog is reachable from
 * everywhere: the app menu (registered by `App.vue`), and the user and info menus (React).
 */
import { focusReturnTarget, type FocusReturnTarget } from '$/components/Dialog/focusReturn'
import { createGlobalState } from '@vueuse/core'
import { ref, shallowRef } from 'vue'

/**
 * The About dialog's state; `App.vue` mounts the dialog bound to `isOpen`. `opener` is where focus
 * returns when it closes, noted as it opens: the dialog is loaded on demand, so the first time it
 * mounts only after the menu item that opened it has gone.
 */
export const useAboutModal = createGlobalState(() => ({
  isOpen: ref(false),
  opener: shallowRef<FocusReturnTarget>(),
}))

/** Open the "About Enso" dialog. */
export function openAboutModal() {
  const about = useAboutModal()
  about.opener.value = focusReturnTarget()
  about.isOpen.value = true
}
