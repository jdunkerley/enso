/**
 * @file Asking whether to copy assets that cannot be moved or restored where they were dropped,
 * through `CopyInsteadModal.vue` on the modal stack. Framework-free callers (moving assets between
 * categories) reach it here.
 */
import { getModalsStore, type Resolution } from '$/providers/modals'
import CopyInsteadModal from './CopyInsteadModal.vue'

/**
 * Ask whether to copy instead. Resolves `'confirm'` to copy, `'dismiss'` otherwise. It closes every
 * open modal first.
 */
export function askToCopyInstead(message: string, description: string): Promise<Resolution> {
  const modals = getModalsStore()
  modals.closeAll()
  return modals.ask(CopyInsteadModal, { message, description })
}
