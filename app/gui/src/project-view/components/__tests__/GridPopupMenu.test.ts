import { InteractionHandler, provideInteractionHandler } from '@/providers/interactionHandler'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import GridPopupMenu from '../GridPopupMenu.vue'
import type { GridMenuItem } from '../shared/AgGridTableView/gridPopupMenuItems'

// `GridPopupMenu` always `<Teleport>`s to `#floatingLayer`, which `App.vue` normally renders.
// None of these tests mount `App.vue`, so provide the same target by hand.
function ensureFloatingLayer(): HTMLElement {
  const existing = document.getElementById('floatingLayer')
  if (existing) return existing
  const layer = document.createElement('div')
  layer.id = 'floatingLayer'
  document.body.appendChild(layer)
  return layer
}

const point = { x: 0, y: 0 }
/** The injection key `createContextStore('Interaction handler', …)` uses. */
const HANDLER_KEY = Symbol.for('contextStore-Interaction handler')

describe('GridPopupMenu', () => {
  afterEach(() => {
    document.getElementById('floatingLayer')?.remove()
  })

  // Regression coverage for both existing consumers stubbing `GridPopupMenu` in their own tests
  // (`AgGridTableView.contextMenu.test.ts`, `TableHeader.test.ts`) — meaning the real component was
  // never actually mounted anywhere in the suite, which is exactly why the bug below went
  // unnoticed.
  test('renders with a provided interaction handler (the WidgetTableEditor column-menu case)', async () => {
    ensureFloatingLayer()
    const action = vi.fn()
    const items: GridMenuItem[] = [{ type: 'item', name: 'Autosize This Column', action }]
    const Host = defineComponent({
      setup() {
        provideInteractionHandler()
        return () => h(GridPopupMenu, { items, point })
      },
    })
    const wrapper = mount(Host, { attachTo: document.body })
    await flushPromises()

    expect(document.querySelector('[data-testid="gridPopupMenu"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Autosize This Column')
    wrapper.unmount()
  })

  // The C1 regression guard: `GridPopupMenu` is also mounted from `TableVisualization`, which
  // lives inside an `enso-visualization-host-N` custom element whose ancestors never provide the
  // interaction handler (Vue's provide/inject doesn't cross that custom-element boundary). Mounting
  // with no ancestor providing anything at all — matching that real-world case exactly — must not
  // throw during setup, or the cell context menu's primary consumer shows no menu at all.
  test('does NOT throw when no interaction handler (or any other ancestor provider) is available', async () => {
    ensureFloatingLayer()
    const items: GridMenuItem[] = [
      { type: 'item', name: 'Cut', action: vi.fn() },
      { type: 'separator' },
      { type: 'item', name: 'Copy', action: vi.fn() },
    ]

    let wrapper: ReturnType<typeof mount> | undefined
    expect(() => {
      wrapper = mount(GridPopupMenu, { props: { items, point }, attachTo: document.body })
    }).not.toThrow()
    await flushPromises()

    expect(document.querySelector('[data-testid="gridPopupMenu"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Cut')
    expect(document.body.textContent).toContain('Copy')
    wrapper?.unmount()
  })

  // The tree visualization's menu closes on Escape and on scroll; the table's must too, and it is
  // this shared popup (not each caller) that makes that so.
  describe.each([
    ['without an interaction handler (table visualization)', false],
    ['with an interaction handler (table editor header)', true],
  ])('dismissal %s', (_name, withHandler) => {
    /** `settled`: wait for the frame after which the popup treats a scroll as the user's. */
    async function mountPopup({ settled = true } = {}) {
      ensureFloatingLayer()
      const onClose = vi.fn()
      const items: GridMenuItem[] = [{ type: 'item', name: 'Cut', action: vi.fn() }]
      const wrapper = mount(GridPopupMenu, {
        props: { items, point, onClose },
        attachTo: document.body,
        // What `provideInteractionHandler()` provides, without a host component to call it.
        global: withHandler ? { provide: { [HANDLER_KEY]: new InteractionHandler() } } : {},
      })
      await flushPromises()
      if (settled) await new Promise((resolve) => requestAnimationFrame(resolve))
      return { wrapper, onClose }
    }

    test('Escape closes the popup, any other key does not', async () => {
      const { wrapper, onClose } = await mountPopup()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      expect(onClose).not.toHaveBeenCalled()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(onClose).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    test('Escape closes the popup although a handler below stops it bubbling', async () => {
      // The grid does exactly this to the key events AG Grid prevents (`stopIfPrevented`).
      const { wrapper, onClose } = await mountPopup()
      const cell = document.createElement('div')
      cell.addEventListener('keydown', (event) => event.stopPropagation())
      document.body.appendChild(cell)
      cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(onClose).toHaveBeenCalledTimes(1)
      cell.remove()
      wrapper.unmount()
    })

    test('scrolling anything outside the popup closes it', async () => {
      const { wrapper, onClose } = await mountPopup()
      const scroller = document.createElement('div')
      document.body.appendChild(scroller)
      // `scroll` does not bubble, so only a capturing listener sees it.
      scroller.dispatchEvent(new Event('scroll'))
      expect(onClose).toHaveBeenCalledTimes(1)
      scroller.remove()
      wrapper.unmount()
    })

    // A scroll event is delivered at the next frame, so the scroll that the right-click that opened
    // the popup caused (the browser scrolls a focused element into view) arrives after the popup
    // has mounted. It is not the user scrolling away from the popup (#814, found on Linux CI).
    test('a scroll delivered before the first frame leaves the popup open', async () => {
      const { wrapper, onClose } = await mountPopup({ settled: false })
      const scroller = document.createElement('div')
      document.body.appendChild(scroller)
      scroller.dispatchEvent(new Event('scroll'))
      expect(onClose).not.toHaveBeenCalled()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      scroller.dispatchEvent(new Event('scroll'))
      expect(onClose).toHaveBeenCalledTimes(1)
      scroller.remove()
      wrapper.unmount()
    })

    test('scrolling inside the popup leaves it open', async () => {
      const { wrapper, onClose } = await mountPopup()
      document.querySelector('[data-testid="gridPopupMenu"]')?.dispatchEvent(new Event('scroll'))
      expect(onClose).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    test('stops listening once unmounted', async () => {
      const { wrapper, onClose } = await mountPopup()
      wrapper.unmount()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      document.body.dispatchEvent(new Event('scroll'))
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  test("a 'separator' item renders a visible (non-zero-height) separator element", async () => {
    ensureFloatingLayer()
    const items: GridMenuItem[] = [
      { type: 'item', name: 'Cut', action: vi.fn() },
      { type: 'separator' },
    ]
    const wrapper = mount(GridPopupMenu, { props: { items, point }, attachTo: document.body })
    await flushPromises()

    const separator = document.querySelector('.separator')
    expect(separator).not.toBeNull()
    // This is the regression the shared/`customElement`-mode bug produced: with `GridPopupMenu`'s
    // styles never applied, `.separator` rendered as an invisible zero-height div. Now that the
    // component lives outside `components/shared/` its scoped styles are injected globally, so the
    // rule setting `height: 1px` actually applies.
    expect(getComputedStyle(separator as Element).height).toBe('1px')
    wrapper.unmount()
  })
})
