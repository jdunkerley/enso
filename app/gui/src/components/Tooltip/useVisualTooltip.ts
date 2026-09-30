/**
 * @file The behaviour of a visual tooltip: shown while the pointer is over its target (or over the
 * tooltip itself), after a short delay, and only when its display rule allows it. The Vue
 * counterpart of the React `useVisualTooltip`.
 *
 * A visual tooltip is not an accessible description: it repeats what is already on screen (the
 * full text of a truncated label, the reason a disabled button is disabled), so it is
 * `aria-hidden` and never reacts to focus. Use `Tooltip.vue` for an accessible one.
 */
import { isOverflowing } from '$/utils/dom'
import { useEventListener } from '@vueuse/core'
import { onScopeDispose, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * When the tooltip may show: `always`, only when the target's content overflows it
 * (`whenOverflowing`, for truncated text), or by a custom rule.
 */
export type VisualTooltipDisplay = 'always' | 'whenOverflowing' | ((target: HTMLElement) => boolean)

/** Options for {@link useVisualTooltip}. */
export interface VisualTooltipOptions {
  readonly display?: MaybeRefOrGetter<VisualTooltipDisplay>
  readonly isDisabled?: MaybeRefOrGetter<boolean>
  /** Delay before showing, and before hiding, in milliseconds. */
  readonly delay?: number
}

const DEFAULT_DELAY = 250

const DISPLAY_STRATEGIES = {
  always: () => true,
  whenOverflowing: isOverflowing,
} satisfies Record<string, (target: HTMLElement) => boolean>

/** Track whether a visual tooltip for `target` should be open. */
export function useVisualTooltip(
  target: Ref<HTMLElement | undefined | null>,
  options: VisualTooltipOptions = {},
) {
  const { delay = DEFAULT_DELAY } = options
  const isOpen = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(open: boolean) {
    if (timer != null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      isOpen.value = open
    }, delay)
  }

  function shouldDisplay(element: HTMLElement) {
    if (toValue(options.isDisabled) === true) return false
    const display = toValue(options.display) ?? 'always'
    return typeof display === 'function' ? display(element) : DISPLAY_STRATEGIES[display](element)
  }

  useEventListener(target, 'pointerenter', () => {
    const element = target.value
    if (element != null && shouldDisplay(element)) schedule(true)
  })
  useEventListener(target, 'pointerleave', () => schedule(false))
  onScopeDispose(() => {
    if (timer != null) clearTimeout(timer)
  })

  return {
    isOpen,
    /** Keep the tooltip open while the pointer is over the tooltip itself. */
    onTooltipEnter() {
      if (timer != null) clearTimeout(timer)
      timer = undefined
    },
    onTooltipLeave() {
      schedule(false)
    },
  }
}
