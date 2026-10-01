import {
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { createModalsStore } from '$/providers/modals'
import { describe, expect, test, vi } from 'vitest'
import { h, nextTick, type SetupContext, type VNode } from 'vue'

usePrimitiveTestEnvironment()

/** A modal that closes itself when clicked. */
function Modal(props: { name: string }, { emit }: SetupContext<['close']>) {
  return h(
    'button',
    { 'data-testid': `modal-${props.name}`, onClick: () => emit('close') },
    props.name,
  )
}
Modal.props = ['name']
Modal.emits = ['close']

/** A modal that fails to render. */
function Broken(): VNode {
  throw new Error('Broken modal')
}

const rendered = () =>
  [...document.querySelectorAll('[data-testid^="modal-"]')].map((element) => element.textContent)

describe('modal stack', () => {
  test('renders the stack bottom to top, and a modal leaves it when it emits `close`', async () => {
    const store = createModalsStore()
    mountWithProviders(() => h(ModalHost, { store }))
    store.open(Modal, { name: 'first' })
    const second = store.open(Modal, { name: 'second' })
    store.open(Modal, { name: 'third' })
    await nextTick()
    expect(rendered()).toEqual(['first', 'second', 'third'])

    second.close()
    await nextTick()
    expect(rendered()).toEqual(['first', 'third'])

    document.querySelector<HTMLElement>('[data-testid="modal-third"]')!.click()
    await nextTick()
    expect(rendered()).toEqual(['first'])

    store.close()
    await nextTick()
    expect(rendered()).toEqual([])
  })

  test('`closeAll` empties the stack and says whether anything was open', async () => {
    const store = createModalsStore()
    mountWithProviders(() => h(ModalHost, { store }))
    expect(store.closeAll()).toBe(false)
    store.open(Modal, { name: 'a' })
    store.open(Modal, { name: 'b' })
    expect(store.closeAll()).toBe(true)
    await nextTick()
    expect(rendered()).toEqual([])
  })

  test('a failing modal shows an error, and does not take the others down', async () => {
    const store = createModalsStore()
    mountWithProviders(() => h(ModalHost, { store }))
    store.open(Modal, { name: 'fine' })
    store.open(Broken, {})
    await nextTick()
    expect(rendered()).toEqual(['fine'])
    // The error display is loaded on first use.
    await vi.waitFor(() => expect(document.body.textContent).toContain('Something went wrong'), {
      timeout: 10_000,
    })
  })
})
