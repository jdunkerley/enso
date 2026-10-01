/**
 * @file Focus an input when it mounts: the Vue counterpart of the React `useAutoFocus`. Focus is
 * moved after the same short delay as React's, so that a dialog's own focus handling settles
 * first; a pointer press elsewhere before then cancels it.
 */
import { useEventListener } from '@vueuse/core'
import { onMounted, onScopeDispose, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

const FOCUS_DELAY = 100

/** Focus `element` after mounting when `enabled` is set, then call `onFocused`. */
export function useAutoFocus(
  element: Readonly<Ref<HTMLElement | null | undefined>>,
  enabled: MaybeRefOrGetter<boolean>,
  onFocused?: () => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer != null) clearTimeout(timer)
    timer = undefined
  }
  onMounted(() => {
    if (!toValue(enabled)) return
    timer = setTimeout(() => {
      timer = undefined
      element.value?.focus()
      onFocused?.()
    }, FOCUS_DELAY)
  })
  useEventListener(document, 'pointerdown', (event) => {
    if (!(event.target instanceof Node) || !element.value?.contains(event.target)) cancel()
  })
  onScopeDispose(cancel)
}
