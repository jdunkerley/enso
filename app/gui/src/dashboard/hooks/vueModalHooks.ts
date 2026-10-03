/**
 * @file Opening a Vue modal from a React button that used to be a react-aria `Dialog.Trigger`.
 * The trigger keeps the attribute react-aria gave it, an `aria-expanded` that follows the modal,
 * so that it reads to assistive technology as before. (react-aria's `aria-haspopup` did not reach
 * the dashboard's `Button`, so there is none to keep.)
 */
import { getModalsStore } from '$/providers/modals'
import { useVueValue } from '$/providers/react/common'
import { useCallback, useState } from 'react'
import type { Component } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'

/**
 * A trigger for a Vue modal on the modal stack: `open` pushes it (as a `Dialog.Trigger` opened its
 * dialog, without closing other modals), and `triggerProps` go on the button that opens it.
 */
export function useVueModalTrigger() {
  const [key, setKey] = useState<number | null>(null)
  const isOpen = useVueValue(
    useCallback(
      () => key != null && getModalsStore().stack.value.some((entry) => entry.key === key),
      [key],
    ),
  )
  const open = useCallback(<C extends Component>(component: C, props: ComponentProps<C>) => {
    setKey(getModalsStore().open(component, props).key)
  }, [])
  return {
    open,
    isOpen,
    // The attribute name react-aria put on the trigger.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    triggerProps: { 'aria-expanded': isOpen },
  } as const
}
