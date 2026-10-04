/**
 * @file Whether the user's last interaction was the keyboard: react-aria's "focus visible" modality,
 * tracked as `useFocusVisible` tracks it (a key press switches to the keyboard, a pointer press
 * away from it). `:focus-visible` cannot stand in for it: a text field matches it on every focus, and
 * jsdom does not support it.
 */
import { readonly, ref } from 'vue'

const keyboard = ref(false)
/** The last element that took focus, and whether the keyboard was the modality then. */
let lastFocus: { readonly target: EventTarget | null; readonly byKeyboard: boolean } | null = null
let listening = false

function listen() {
  if (listening || typeof document === 'undefined') return
  listening = true
  const toKeyboard = (event: KeyboardEvent) => {
    // Shortcuts with a modifier do not count, as in react-aria.
    if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboard.value = true
  }
  const toPointer = () => (keyboard.value = false)
  document.addEventListener('keydown', toKeyboard, { capture: true })
  document.addEventListener('pointerdown', toPointer, { capture: true })
  document.addEventListener('mousedown', toPointer, { capture: true })
  // `focus` does not bubble, but the capture phase reaches the document before the target.
  document.addEventListener(
    'focus',
    (event) => (lastFocus = { target: event.target, byKeyboard: keyboard.value }),
    { capture: true },
  )
}

// Listen from the start: the first focus change may come before anything asks.
listen()

/** Whether the last interaction was the keyboard. */
export function useKeyboardModality() {
  listen()
  return readonly(keyboard)
}

/**
 * Whether `element` has the focus, and got it from a pointer press or from code after one, rather
 * than from the keyboard.
 */
export function hasNonKeyboardFocus(element: Element) {
  return (
    document.activeElement === element && lastFocus?.target === element && !lastFocus.byKeyboard
  )
}
