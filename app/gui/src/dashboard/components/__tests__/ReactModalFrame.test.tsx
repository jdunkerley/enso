/**
 * @file The React `ask` reaches its dialog through the Vue modal stack: the stack's `ask` passes
 * `onConfirm`/`onCancel` as Vue props, and they must arrive as React props through the
 * `reactComponent` bridge, which `ReactModalFrame` then hands to the dialog.
 */
import { reactComponent } from '@/util/react'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'

enableAutoUnmount(afterEach)

/** Stands in for `ReactModalFrame`: a React component that answers when its buttons are clicked. */
function Probe(props: { onConfirm?: () => void; onCancel?: () => void }) {
  return (
    <>
      <button data-testid="confirm" onClick={() => props.onConfirm?.()} />
      <button data-testid="cancel" onClick={() => props.onCancel?.()} />
    </>
  )
}

test('`onConfirm`/`onCancel` given as Vue props reach the React component', async () => {
  const VueProbe = reactComponent(Probe)
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  mount(defineComponent({ setup: () => () => h(VueProbe, { onConfirm, onCancel }) }), {
    attachTo: document.body,
  })
  const button = (id: string) =>
    vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      if (element == null) throw new Error(`No ${id} button yet`)
      return element
    })
  ;(await button('confirm')).click()
  ;(await button('cancel')).click()
  expect(onConfirm).toHaveBeenCalledOnce()
  expect(onCancel).toHaveBeenCalledOnce()
})
