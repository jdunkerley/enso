import { createToastsStore, DEFAULT_AUTO_CLOSE_MS, TOAST_LIMIT } from '$/providers/toasts'
import { describe, expect, test, vi } from 'vitest'

const ids = (store: ReturnType<typeof createToastsStore>) =>
  store.toasts.value.map((toast) => toast.id)

describe('toast store', () => {
  test('shows toasts with the defaults', () => {
    const store = createToastsStore()
    const id = store.show('Hello')
    expect(store.toasts.value).toEqual([
      expect.objectContaining({
        id,
        content: 'Hello',
        type: 'default',
        autoClose: DEFAULT_AUTO_CLOSE_MS,
        isLoading: false,
        closeButton: true,
        closeOnClick: false,
        hideProgressBar: false,
        progress: null,
        position: 'top-center',
        isIn: true,
      }),
    ])
    expect(store.isActive(id)).toBe(true)
  })

  test('ignores a second toast with a displayed id', () => {
    const store = createToastsStore()
    store.show('First', { toastId: 'a' })
    store.show('Second', { toastId: 'a' })
    expect(store.toasts.value.map((toast) => toast.content)).toEqual(['First'])
  })

  test(`queues toasts beyond ${TOAST_LIMIT}, and shows them as others are removed`, () => {
    const store = createToastsStore()
    for (const id of [1, 2, 3, 4, 5]) store.show(`Toast ${id}`, { toastId: id })
    expect(ids(store)).toEqual([1, 2, 3])
    // A dismissed toast still counts until its exit animation is over.
    store.dismiss(1)
    expect(ids(store)).toEqual([1, 2, 3])
    store.remove(1)
    expect(ids(store)).toEqual([2, 3, 4])
  })

  test('dismissing a queued toast drops it', () => {
    const store = createToastsStore()
    for (const id of [1, 2, 3, 4]) store.show(`Toast ${id}`, { toastId: id })
    store.dismiss(4)
    store.remove(1)
    expect(ids(store)).toEqual([2, 3])
  })

  test('dismissing marks toasts as leaving; removing drops them', () => {
    const store = createToastsStore()
    store.show('A', { toastId: 'a' })
    store.show('B', { toastId: 'b' })
    store.dismiss('a')
    expect(store.isActive('a')).toBe(false)
    expect(store.isActive('b')).toBe(true)
    store.dismiss()
    expect(store.toasts.value.every((toast) => !toast.isIn)).toBe(true)
    store.remove('a')
    store.remove('b')
    expect(store.toasts.value).toEqual([])
  })

  test('updates keep unset options, reset `null` ones, and restart the timer', () => {
    const store = createToastsStore()
    const id = store.show('Loading', {
      isLoading: true,
      closeButton: false,
      position: 'bottom-right',
    })
    const [loading] = store.toasts.value
    expect(loading).toMatchObject({ autoClose: false, isLoading: true, closeButton: false })
    store.update(id, { render: 'Done', type: 'success', isLoading: null, closeButton: null })
    const [done] = store.toasts.value
    expect(done).toMatchObject({
      content: 'Done',
      type: 'success',
      isLoading: false,
      closeButton: true,
      position: 'bottom-right',
      // A loading toast never closes by itself, and the update did not ask for that to change.
      autoClose: false,
    })
    expect(done!.revision).toBeGreaterThan(loading!.revision)
    store.update(id, { autoClose: null })
    expect(store.toasts.value[0]!.autoClose).toBe(DEFAULT_AUTO_CLOSE_MS)
  })

  test('reports changes', () => {
    const store = createToastsStore()
    const listener = vi.fn()
    const unsubscribe = store.onChange(listener)
    store.show('A', { toastId: 'a' })
    store.update('a', { render: 'B' })
    store.dismiss('a')
    store.remove('a')
    unsubscribe()
    store.show('C')
    expect(listener.mock.calls).toEqual([
      [{ id: 'a', status: 'added' }],
      [{ id: 'a', status: 'updated' }],
      [{ id: 'a', status: 'removed' }],
    ])
  })

  test('promise: a loading toast while pending, which turns into the outcome', async () => {
    const store = createToastsStore()
    let resolve!: (value: string) => void
    const running = new Promise<string>((done) => (resolve = done))
    const returned = store.promise(running, {
      pending: 'Working…',
      success: (data) => `Done: ${String(data)}`,
      error: 'Failed',
    })
    expect(returned).toBe(running)
    expect(store.toasts.value).toEqual([
      expect.objectContaining({
        content: 'Working…',
        isLoading: true,
        autoClose: false,
        closeButton: false,
      }),
    ])
    resolve('report.csv')
    await running
    await Promise.resolve()
    expect(store.toasts.value).toEqual([
      expect.objectContaining({
        content: 'Done: report.csv',
        type: 'success',
        isLoading: false,
        autoClose: DEFAULT_AUTO_CLOSE_MS,
        closeButton: true,
      }),
    ])
  })

  test('promise: an error toast on failure; no content only dismisses the loading toast', async () => {
    const store = createToastsStore()
    const failing = Promise.reject(new Error('nope'))
    store.promise(failing, { pending: 'Working…', error: 'Failed' }).catch(() => {})
    await failing.catch(() => {})
    await Promise.resolve()
    expect(store.toasts.value).toEqual([
      expect.objectContaining({ content: 'Failed', type: 'error' }),
    ])

    const quiet = createToastsStore()
    const succeeding = Promise.resolve()
    await quiet.promise(succeeding, { pending: 'Working…', error: 'Failed' })
    await Promise.resolve()
    expect(quiet.toasts.value).toEqual([expect.objectContaining({ isIn: false })])
  })
})
