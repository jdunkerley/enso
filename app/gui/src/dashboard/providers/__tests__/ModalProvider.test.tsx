import { askModal, setModal, unsetModal, useModalRef } from '#/providers/ModalProvider'
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

describe('the React `ask`, forwarded to the Vue stack', () => {
  const topProps = () =>
    getModalsStore().stack.value.at(-1)?.props as {
      modal: unknown
      onConfirm: () => Promise<void>
      onCancel: () => Promise<void>
    }

  test('replaces every open modal, and resolves with the answer, closing every modal', async () => {
    setModal(<div>Below</div>)
    const question = <div>Sure?</div>
    const answer = askModal(question)
    expect(openModals()).toEqual([question])
    await topProps().onConfirm()
    await expect(answer).resolves.toBe('confirm')
    expect(openModals()).toEqual([])
  })

  test("a cancel resolves `'dismiss'`, and so does a modal replaced unanswered", async () => {
    const cancelled = askModal(<div>Sure?</div>)
    await topProps().onCancel()
    await expect(cancelled).resolves.toBe('dismiss')

    const replaced = askModal(<div>Sure?</div>)
    setModal(<div>Other</div>)
    await expect(replaced).resolves.toBe('dismiss')
  })
})
