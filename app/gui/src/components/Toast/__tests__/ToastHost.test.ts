import { mountWithProviders } from '$/components/__tests__/mountWithProviders'
import ToastHost from '$/components/Toast/ToastHost.vue'
import { createToastsStore } from '$/providers/toasts'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    return window.setTimeout(() => callback(performance.now()), 0)
  })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const store = createToastsStore()
  const wrapper = mountWithProviders(() => h(ToastHost, { store }))
  const toastElements = () => [...document.querySelectorAll<HTMLElement>('[data-testid="toast"]')]
  const progressBar = (toast: HTMLElement) =>
    toast.querySelector<HTMLElement>('[role="progressbar"]')!
  const animationEnd = (element: HTMLElement) =>
    element.dispatchEvent(new Event('animationend', { bubbles: true }))
  return { store, wrapper, toastElements, progressBar, animationEnd }
}

describe('ToastHost', () => {
  test('renders a toast with its message as an alert, an icon and a close button', async () => {
    const { store, toastElements } = setup()
    store.show('Saved', { type: 'success' })
    await nextTick()
    const [toast] = toastElements()
    expect(toast).toBeDefined()
    expect(toast!.querySelector('[role="alert"]')?.textContent).toBe('Saved')
    expect(toast!.querySelector('svg.icon-success')).not.toBeNull()
    expect(toast!.querySelector('button[aria-label="close"]')).not.toBeNull()
    expect(toast!.classList).toContain('bg-selected-frame')
  })

  test('puts each position in its own container, which dialogs ignore clicks in', async () => {
    const { store } = setup()
    store.show('Top')
    store.show('Corner', { position: 'bottom-right' })
    await nextTick()
    const containers = [...document.querySelectorAll('[data-ignore-click-outside]')]
    expect(containers.map((container) => [container.className, container.textContent])).toEqual([
      [expect.stringContaining('top-center'), 'Top'],
      [expect.stringContaining('bottom-right'), 'Corner'],
    ])
  })

  test('the close button slides the toast out, collapses it, and removes it', async () => {
    const { store, toastElements, animationEnd } = setup()
    store.show('Bye')
    await nextTick()
    const [toast] = toastElements()
    toast!.querySelector('button')!.click()
    await nextTick()
    expect(toast!.querySelector('[role="alert"]')).toBeNull()
    expect(toast!.className).toContain('slideOut-top-center')
    animationEnd(toast!)
    await vi.runAllTimersAsync()
    expect(store.toasts.value).toEqual([])
    expect(toastElements()).toEqual([])
  })

  test('closes when the progress bar has run out, which starts once the toast is in', async () => {
    const { store, toastElements, progressBar, animationEnd } = setup()
    store.show('Timed', { autoClose: 1234 })
    await nextTick()
    const [toast] = toastElements()
    const bar = progressBar(toast!)
    expect(bar.style.animationDuration).toBe('1234ms')
    expect(bar.style.animationPlayState).toBe('paused')
    animationEnd(toast!)
    await nextTick()
    expect(bar.style.animationPlayState).toBe('running')
    animationEnd(bar)
    await nextTick()
    expect(store.isActive(store.toasts.value[0]!.id)).toBe(false)
  })

  test('pauses while hovered and while the window is unfocused', async () => {
    const { store, toastElements, progressBar, animationEnd } = setup()
    store.show('Hover me')
    await nextTick()
    const [toast] = toastElements()
    animationEnd(toast!)
    await nextTick()
    toast!.dispatchEvent(new MouseEvent('mouseenter'))
    await nextTick()
    expect(progressBar(toast!).style.animationPlayState).toBe('paused')
    toast!.dispatchEvent(new MouseEvent('mouseleave'))
    await nextTick()
    expect(progressBar(toast!).style.animationPlayState).toBe('running')
    window.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(progressBar(toast!).style.animationPlayState).toBe('paused')
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    expect(progressBar(toast!).style.animationPlayState).toBe('running')
  })

  test('a loading toast shows a spinner, no close button and no progress', async () => {
    const { store, toastElements, progressBar } = setup()
    store.show('Working', { isLoading: true, closeButton: false })
    await nextTick()
    const [toast] = toastElements()
    expect(toast!.querySelector('.spinner')).not.toBeNull()
    expect(toast!.querySelector('button')).toBeNull()
    expect(progressBar(toast!).getAttribute('aria-hidden')).toBe('true')
  })

  test('a click closes the toast only when asked to', async () => {
    const { store, toastElements } = setup()
    const sticky = store.show('Sticky')
    const clickable = store.show('Clickable', { closeOnClick: true })
    await nextTick()
    for (const toast of toastElements()) toast.click()
    await nextTick()
    expect(store.isActive(sticky)).toBe(true)
    expect(store.isActive(clickable)).toBe(false)
  })

  test('controlled progress shows the progress, and completing it closes the toast', async () => {
    const { store, toastElements, progressBar } = setup()
    const id = store.show('Uploading', { progress: 0.5 })
    await nextTick()
    const bar = progressBar(toastElements()[0]!)
    expect(bar.style.transform).toBe('scaleX(0.5)')
    store.update(id, { progress: 1 })
    await nextTick()
    bar.dispatchEvent(new Event('transitionend'))
    await nextTick()
    expect(store.isActive(id)).toBe(false)
  })

  test('renders component content', async () => {
    const { store, toastElements } = setup()
    const Content = defineComponent({
      props: { name: { type: String, required: true } },
      setup: (props) => () => h('b', `Hi ${props.name}`),
    })
    store.show({ component: Content, props: { name: 'Ann' } })
    await nextTick()
    expect(toastElements()[0]!.querySelector('b')?.textContent).toBe('Hi Ann')
  })
})
