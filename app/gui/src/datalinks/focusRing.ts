/**
 * @file A focus ring for the datalink editor's inputs: the `focus-ring` class while the element
 * (or, for a container, something inside it) has focus that the keyboard put there. A text input
 * matches `:focus-visible` on every focus, so the input modality is tracked separately
 * (`$/utils/inputModality`).
 */
import { useKeyboardModality } from '$/utils/inputModality'
import { computed, ref } from 'vue'

/** The focus state of one element; bind `onFocus` and `onBlur` (`focusin`/`focusout` for a container). */
export function useFocusRing() {
  const isKeyboardModality = useKeyboardModality()
  const isFocused = ref(false)
  const isFocusVisible = computed(() => isFocused.value && isKeyboardModality.value)
  return {
    isFocusVisible,
    onFocus: () => (isFocused.value = true),
    onBlur: (event: FocusEvent) => {
      const current = event.currentTarget
      const next = event.relatedTarget
      // For `focusout` on a container: still focused while the focus stays inside it.
      if (current instanceof Node && next instanceof Node && current.contains(next)) return
      isFocused.value = false
    },
  }
}
