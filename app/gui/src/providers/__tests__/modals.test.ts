import { createModalsStore } from '$/providers/modals'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'

/** A stand-in modal: the store never renders it. */
const Question = defineComponent({
  props: { text: String, onConfirm: Function, onCancel: Function },
  emits: ['close'],
  render: () => null,
})

/** The props the store gave the topmost modal. */
const topProps = (store: ReturnType<typeof createModalsStore>) =>
  store.stack.value.at(-1)!.props as {
    text: string
    onConfirm: () => Promise<void>
    onCancel: () => Promise<void>
  }

describe('`ask`', () => {
  test("pushes the modal with its props, and resolves `'confirm'` when it confirms", async () => {
    const store = createModalsStore()
    store.open(Question, { text: 'below' })
    const answer = store.ask(Question, { text: 'Sure?' })
    expect(store.stack.value).toHaveLength(2)
    expect(topProps(store).text).toBe('Sure?')
    await topProps(store).onConfirm()
    await expect(answer).resolves.toBe('confirm')
  })

  test("resolves `'dismiss'` when it cancels", async () => {
    const store = createModalsStore()
    const answer = store.ask(Question, { text: 'Sure?' })
    await topProps(store).onCancel()
    await expect(answer).resolves.toBe('dismiss')
  })

  test('awaits the caller’s own `onConfirm` before resolving, so the modal can show it pending', async () => {
    const store = createModalsStore()
    let finish!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const answered = vi.fn()
    void store.ask(Question, { text: 'Delete?', onConfirm }).then(answered)
    const confirming = topProps(store).onConfirm()
    await Promise.resolve()
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(answered).not.toHaveBeenCalled()
    finish()
    await confirming
    await Promise.resolve()
    expect(answered).toHaveBeenCalledWith('confirm')
  })

  test('a caller’s `onConfirm` that throws leaves the question open, to be answered again', async () => {
    const store = createModalsStore()
    let fail = true
    const answer = store.ask(Question, {
      text: 'Delete?',
      onConfirm: () => {
        if (fail) throw new Error('Offline')
      },
    })
    await expect(topProps(store).onConfirm()).rejects.toThrow('Offline')
    fail = false
    await topProps(store).onConfirm()
    await expect(answer).resolves.toBe('confirm')
  })

  test('the modal stays on the stack once answered, until it emits `close`', async () => {
    const store = createModalsStore()
    const answer = store.ask(Question, { text: 'Sure?' })
    await topProps(store).onConfirm()
    await answer
    expect(store.stack.value).toHaveLength(1)
    store.close(store.stack.value[0]!.key)
    expect(store.stack.value).toHaveLength(0)
  })

  test("resolves `'dismiss'` when the modal leaves the stack unanswered", async () => {
    const store = createModalsStore()
    const closed = store.ask(Question, { text: 'Sure?' })
    store.close()
    await expect(closed).resolves.toBe('dismiss')

    const replaced = store.ask(Question, { text: 'Sure?' })
    store.closeAll()
    await expect(replaced).resolves.toBe('dismiss')
  })

  test('an answer after the modal has left changes nothing', async () => {
    const store = createModalsStore()
    const answer = store.ask(Question, { text: 'Sure?' })
    const { onConfirm } = topProps(store)
    store.closeAll()
    await onConfirm()
    await expect(answer).resolves.toBe('dismiss')
  })
})
