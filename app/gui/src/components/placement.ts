/**
 * @file Placement of an overlay relative to its trigger.
 *
 * The Vue primitives take a single `placement` (the `@floating-ui` spelling, as the project-view's
 * `TooltipTrigger` does), and translate it to Reka's separate `side` and `align`.
 */
import type { Placement } from '@floating-ui/vue'

export type { Placement } from '@floating-ui/vue'

/** Which side of the trigger an overlay goes on. */
export type Side = 'bottom' | 'left' | 'right' | 'top'
/** How an overlay aligns along that side. */
export type Align = 'center' | 'end' | 'start'

/** Split a {@link Placement} into Reka's `side` and `align`. */
export function placementToSideAlign(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split('-') as [Side, 'end' | 'start' | undefined]
  return { side, align: align ?? 'center' }
}
