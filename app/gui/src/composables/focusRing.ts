/**
 * @file Whether an element (or, `within`, something inside it) has visible focus. Bind the
 * returned class on the element, so that the focus ring shows while it has (`focus-ring`, or on a
 * pseudo-element: `before:focus-ring`, `after:focus-ring`; `focus-ring-outset`).
 */
import { useEventListener } from '@vueuse/core'
import { computed, ref, type MaybeRefOrGetter } from 'vue'

/** Which pseudo-element to place the focus ring on (if any). */
export type FocusRingPlacement = 'after' | 'before' | 'outset'

/** Options of {@link useFocusRing}. */
export interface FocusRingOptions {
  /** Show the ring while something inside has visible focus, not only the element itself. */
  readonly within?: boolean
  readonly placement?: FocusRingPlacement
}

/** The focus-ring class for a placement. */
export function focusRingClass(placement?: FocusRingPlacement) {
  return (
    placement === 'outset' ? 'focus-ring-outset'
    : placement === 'before' ? 'before:focus-ring'
    : placement === 'after' ? 'after:focus-ring'
    : 'focus-ring'
  )
}

/** The focus-ring class to bind on `element`: present while it has visible focus. */
export function useFocusRing(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: FocusRingOptions = {},
) {
  const { within = false, placement } = options
  const isFocusVisible = ref(false)

  function update(event: FocusEvent) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (!within && target !== event.currentTarget) return
    isFocusVisible.value = target.matches(':focus-visible')
  }

  useEventListener(element, 'focusin', update)
  useEventListener(element, 'focusout', (event: FocusEvent) => {
    const next = event.relatedTarget
    const current = event.currentTarget
    if (within && current instanceof Element && next instanceof Node && current.contains(next)) {
      return
    }
    isFocusVisible.value = false
  })

  return computed(() => (isFocusVisible.value ? focusRingClass(placement) : undefined))
}
