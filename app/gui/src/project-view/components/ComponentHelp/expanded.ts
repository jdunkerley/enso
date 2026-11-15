/** @file Whether the help panel's function node shows its arguments expanded, remembered across reloads. */
import { useLocalStorage } from '@vueuse/core'
import type { Ref } from 'vue'

/** Local storage key of the node's expanded state. */
export const HELP_ARGUMENTS_EXPANDED_STORAGE_KEY = 'enso-help-arguments-expanded'

/** Whether the node shows one row per argument (not pills), saved in local storage; collapsed by default. */
export function useHelpArgumentsExpanded(): Ref<boolean> {
  const expanded = useLocalStorage<boolean>(HELP_ARGUMENTS_EXPANDED_STORAGE_KEY, false)
  if (typeof expanded.value !== 'boolean') expanded.value = false
  return expanded
}
