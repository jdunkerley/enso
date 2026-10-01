import { setModal, unsetModal, useModalRef } from '#/providers/ModalProvider'
import { getModalsStore } from '$/providers/modals'
import { afterEach, describe, expect, test } from 'vitest'

afterEach(() => {
  getModalsStore().closeAll()
})

const openModals = () => getModalsStore().stack.value.map((entry) => entry.props.modal)

describe('the React `setModal` shim', () => {
  test('replaces every open modal with the new one, on the Vue stack', () => {
    const first = <div>First</div>
    const second = <div>Second</div>
    setModal(first)
    expect(openModals()).toEqual([first])
    setModal(second)
    expect(openModals()).toEqual([second])
  })

  test('passes the current modal to a callback', () => {
    const first = <div>First</div>
    setModal(first)
    let previous: unknown = undefined
    setModal((prev) => {
      previous = prev
      return <div>Second</div>
    })
    expect(previous).toBe(first)
  })

  test('`unsetModal` closes the modals, and returns `false` when there were none', () => {
    expect(unsetModal()).toBe(false)
    setModal(<div>Modal</div>)
    expect(unsetModal()).toBeUndefined()
    expect(openModals()).toEqual([])
  })

  test('`useModalRef` reports whether any modal, React or Vue, is open', () => {
    const { modalRef } = useModalRef()
    expect(modalRef.current).toBeNull()
    getModalsStore().open({ render: () => null }, {})
    expect(modalRef.current).not.toBeNull()
  })
})
