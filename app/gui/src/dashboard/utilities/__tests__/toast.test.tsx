import { toast } from '#/utilities/toast'
import { getToastsStore } from '$/providers/toasts'
import { afterEach, describe, expect, test } from 'vitest'

afterEach(() => {
  const store = getToastsStore()
  for (const { id } of store.toasts.value) store.remove(id)
})

const current = () => getToastsStore().toasts.value

describe('the React `toast` shim', () => {
  test('shows text toasts of each kind on the Vue store', () => {
    toast('Plain')
    toast.success('Yes')
    toast.error('No')
    expect(current().map(({ content, type }) => [content, type])).toEqual([
      ['Plain', 'default'],
      ['Yes', 'success'],
      ['No', 'error'],
    ])
  })

  test('wraps React content in a component', () => {
    const node = <b>Bold</b>
    toast.info(node)
    const content = current()[0]?.content
    expect(typeof content === 'object' ? content.props : undefined).toEqual({ node })
  })

  test('a loading toast stays, with no close button', () => {
    toast.loading('Working')
    expect(current()[0]).toMatchObject({
      isLoading: true,
      autoClose: false,
      closeButton: false,
      closeOnClick: false,
    })
  })

  test('`promise` turns the loading toast into a success toast', async () => {
    let finish!: (value: number) => void
    const promise = toast.promise(new Promise<number>((resolve) => (finish = resolve)), {
      pending: 'Saving',
      success: { render: ({ data }) => `Saved ${String(data)}` },
      error: 'Failed',
    })
    expect(current()[0]).toMatchObject({ content: 'Saving', isLoading: true })
    finish(42)
    await promise
    await Promise.resolve()
    expect(current()[0]).toMatchObject({
      content: 'Saved 42',
      type: 'success',
      isLoading: false,
      closeButton: true,
      autoClose: 5000,
    })
  })

  test('`promise` turns the loading toast into an error toast', async () => {
    const promise = toast.promise(Promise.reject(new Error('boom')), {
      pending: 'Saving',
      error: 'Failed',
    })
    await expect(promise).rejects.toThrow('boom')
    await Promise.resolve()
    expect(current()[0]).toMatchObject({ content: 'Failed', type: 'error', isLoading: false })
  })

  test('`dismiss` and `onChange`', () => {
    const changes: unknown[] = []
    const unsubscribe = toast.onChange((change) => changes.push(change))
    const id = toast('Bye')
    toast.dismiss(id)
    expect(getToastsStore().isActive(id)).toBe(false)
    unsubscribe()
    expect(changes).toEqual([{ id, status: 'added' }])
  })
})
