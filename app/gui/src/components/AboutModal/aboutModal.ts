/**
 * @file Whether the "About Enso" dialog is open. It is global, as the dialog is reachable from
 * everywhere: the app menu (registered by `App.vue`), and the user and info menus (React).
 */
import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'

/** The About dialog's state; `App.vue` mounts the dialog bound to `isOpen`. */
export const useAboutModal = createGlobalState(() => ({ isOpen: ref(false) }))

/** Open the "About Enso" dialog. */
export function openAboutModal() {
  useAboutModal().isOpen.value = true
}
