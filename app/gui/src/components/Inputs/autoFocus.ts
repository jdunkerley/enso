/**
 * @file Focus an input when it mounts. Focus is moved after a short delay, so that a dialog's own
 * focus handling settles first; a pointer press elsewhere before then cancels it, and so does
 * another text field taking the focus meanwhile: the user (or a test) is typing there, and the
 * keystrokes must not move.
 */
import { useEventListener } from '@vueuse/core'
import { onMounted, onScopeDispose, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

const FOCUS_DELAY = 100

/** Input types that take no typing: focusing one is not typing there. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/**
 * Whether the focus is in a text field other than `element`. A page whose inputs mount late (a
 * route loaded on demand) can otherwise move the focus away from a field the user has already
 * started typing in, within the delay.
 */
function isTypingElsewhere(element: HTMLElement | null | undefined) {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === element || element?.contains(active)) {
    return false
  }
  if (active instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(active.type)
  return active instanceof HTMLTextAreaElement || active.isContentEditable
}

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
      if (isTypingElsewhere(element.value)) return
      element.value?.focus()
      onFocused?.()
    }, FOCUS_DELAY)
  })
  useEventListener(document, 'pointerdown', (event) => {
    if (!(event.target instanceof Node) || !element.value?.contains(event.target)) cancel()
  })
  onScopeDispose(cancel)
}
