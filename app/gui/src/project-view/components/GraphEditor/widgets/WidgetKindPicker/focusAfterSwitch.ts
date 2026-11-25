/**
 * @file Which chip button takes the focus after a kind is chosen from the list. The `Nothing ▼`
 * button and an icon button are different elements, and the chip itself may be a new instance (its
 * port is the new value's), so the button to focus may appear only once the edit has been applied.
 */
import type { UnionKind } from '$/providers/openedProjects/widgetRegistry/configuration'
import { nextTick } from 'vue'

/** How long a switch waits for its new button to appear. */
export const FOCUS_AFTER_SWITCH_MS = 1000

/** A chip: its node, its kinds, and the kind it shows. */
export interface ChipIdentity {
  node: unknown
  kinds: readonly UnionKind[]
  kind: UnionKind | undefined
}

/**
 * The switch waiting for its button. Kinds are compared by label, not as objects: an annotation's
 * union may arrive as a new object after the edit.
 */
let pending:
  { node: unknown; kinds: string; kind: string; timer: ReturnType<typeof setTimeout> } | undefined

const kindsKey = (kinds: readonly UnionKind[]) => kinds.map((kind) => kind.label).join('|')

function clearPending() {
  if (pending) clearTimeout(pending.timer)
  pending = undefined
}

/**
 * A kind was chosen in `chip` (whose `kind` is the new one): the chip's button that appears next
 * takes the focus, for {@link FOCUS_AFTER_SWITCH_MS}. When `button`, the one the choice was made
 * from, is still in the document after the edit, it was kept (both kinds have an icon) and has the
 * focus back already: nothing waits, so no other chip of the node can take the focus.
 */
export function focusAfterSwitch(chip: ChipIdentity, button: HTMLElement | null | undefined) {
  clearPending()
  if (chip.kind == null) return
  const armed = {
    node: chip.node,
    kinds: kindsKey(chip.kinds),
    kind: chip.kind.label,
    timer: setTimeout(clearPending, FOCUS_AFTER_SWITCH_MS),
  }
  pending = armed
  if (button != null)
    void nextTick(() => {
      if (pending === armed && button.isConnected) clearPending()
    })
}

/**
 * Whether the chip whose button just appeared is the one a switch is waiting for (same node, same
 * kinds, showing the chosen kind). If so, the wait ends, and the caller focuses its button.
 */
export function takesFocusAfterSwitch(chip: ChipIdentity): boolean {
  if (
    pending == null ||
    chip.kind == null ||
    pending.node !== chip.node ||
    pending.kinds !== kindsKey(chip.kinds) ||
    pending.kind !== chip.kind.label
  )
    return false
  clearPending()
  return true
}
