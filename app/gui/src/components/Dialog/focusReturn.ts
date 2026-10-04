/**
 * @file Where focus goes when a dialog without a trigger opens and closes, as react-aria decides
 * for the React dialogs.
 *
 * - **On open,** the dialog itself takes focus (it has `tabindex="-1"`), not its first button: the
 *   first Tab then reaches the first control. An input with `autoFocus` still takes focus, after
 *   its short delay.
 * - **On close,** focus returns to the element that opened the dialog. When that element has gone,
 *   because it was an item in a menu that closed as the dialog opened (the user menu's "About
 *   Enso"), focus returns to the trigger of that menu instead (see {@link popupTrigger}).
 *   This is the step react-aria's chain of focus scopes takes; Reka, without it, leaves focus on
 *   the page's body.
 *
 * A dialog with a trigger keeps Reka's own behaviour, which returns focus to the trigger.
 */
import { toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * The trigger of the popup that contains `element`, if any: the element whose `aria-controls` names
 * the popup or one of its ancestors; failing that, for an element in a portalled popup, the one
 * open popup trigger (`aria-expanded="true"` with `aria-controls`) outside the portal root.
 * (react-aria's `DialogTrigger` names an id in `aria-controls` that the popover does not render.)
 */
function popupTrigger(element: Element | null): HTMLElement | null {
  for (let node = element; node != null; node = node.parentElement) {
    if (node.id === '') continue
    const trigger = document.querySelector(`[aria-controls~="${CSS.escape(node.id)}"]`)
    if (trigger instanceof HTMLElement) return trigger
  }
  const portalRoot = element?.closest('#enso-portal-root')
  if (portalRoot == null) return null
  const openTriggers = [
    ...document.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]'),
  ].filter((trigger) => !portalRoot.contains(trigger))
  return openTriggers.length === 1 ? openTriggers[0]! : null
}

/**
 * Where focus should return to once a dialog that `opener` opened closes: `opener`, or the trigger
 * of the popup it is in. Call it while `opener` is still in the page.
 */
export function focusReturnTarget(opener: Element | null = document.activeElement) {
  return { opener, trigger: popupTrigger(opener) }
}

/** The return target computed by {@link focusReturnTarget}. */
export type FocusReturnTarget = ReturnType<typeof focusReturnTarget>

/**
 * Handlers for a Reka dialog content's `openAutoFocus` and `closeAutoFocus` events.
 * @param open - The dialog's open state; the opener is the element focused as it becomes `true`.
 * @param hasTrigger - Whether the dialog has its own trigger, in which case Reka's behaviour stays.
 * @param opener - Where to return to, when the caller knew it before the dialog mounted (a dialog
 * loaded on demand mounts after the menu that opened it has gone).
 */
export function useDialogFocus(
  open: Readonly<Ref<boolean>>,
  hasTrigger: () => boolean,
  opener?: MaybeRefOrGetter<FocusReturnTarget | undefined>,
) {
  let target: FocusReturnTarget | undefined
  watch(
    open,
    (isOpen) => {
      if (isOpen) target = toValue(opener) ?? focusReturnTarget()
    },
    { flush: 'sync', immediate: true },
  )

  /** Focus the dialog itself, as react-aria's `useDialog` does. */
  function onOpenAutoFocus(event: Event) {
    if (hasTrigger()) return
    if (event.target instanceof HTMLElement) {
      event.preventDefault()
      event.target.focus({ preventScroll: true })
    }
  }

  /** Return focus to the opener, or to the trigger of the popup it was in. */
  function onCloseAutoFocus(event: Event) {
    if (hasTrigger() || target == null) return
    returnFocus(event, target)
  }

  return { onOpenAutoFocus, onCloseAutoFocus }
}

/**
 * On a Reka overlay's `closeAutoFocus`: return focus to `target`'s opener, or to the trigger of the
 * popup it was in, instead of Reka's own target.
 */
export function returnFocus(event: Event, target: FocusReturnTarget) {
  const element =
    target.opener instanceof HTMLElement && target.opener.isConnected ? target.opener
    : target.trigger?.isConnected ? target.trigger
    : null
  if (element != null) {
    event.preventDefault()
    // After Reka's own clean-up, which runs in a timeout of its own: until then the dialog's focus
    // trap is still active, and would take the focus back.
    setTimeout(() => setTimeout(() => element.focus({ preventScroll: true })))
  }
}
