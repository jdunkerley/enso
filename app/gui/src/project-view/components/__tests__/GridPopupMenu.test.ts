import { provideInteractionHandler } from '@/providers/interactionHandler'
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

  describe('from the keyboard', () => {
    const items: GridMenuItem[] = [
      { type: 'item', name: 'First', action: vi.fn() },
      { type: 'item', name: 'Off', action: vi.fn(), disabled: true },
      { type: 'item', name: 'Last', action: vi.fn() },
    ]

    async function mountMenu(focusFirst: boolean | undefined) {
      ensureFloatingLayer()
      const wrapper = mount(GridPopupMenu, {
        props: { items, point, ...(focusFirst != null ? { focusFirst } : {}) },
        attachTo: document.body,
      })
      await flushPromises()
      return wrapper
    }
    const panel = () => document.querySelector('[data-testid="gridPopupMenu"]')!
    const active = () => document.activeElement?.textContent?.trim()
    async function press(key: string) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(event)
      await flushPromises()
      return event
    }

    test('focusFirst puts the focus on the first item', async () => {
      const wrapper = await mountMenu(true)
      expect(active()).toBe('First')
      wrapper.unmount()
    })

    test('without focusFirst the focus is not taken', async () => {
      const wrapper = await mountMenu(undefined)
      expect(panel().contains(document.activeElement)).toBe(false)
      wrapper.unmount()
    })

    test('ArrowDown and ArrowUp move between the enabled items and wrap', async () => {
      const wrapper = await mountMenu(true)
      await press('ArrowDown')
      expect(active()).toBe('Last')
      await press('ArrowDown')
      expect(active()).toBe('First')
      await press('ArrowUp')
      expect(active()).toBe('Last')
      wrapper.unmount()
    })

    test('Home and End go to the first and the last item', async () => {
      const wrapper = await mountMenu(true)
      await press('End')
      expect(active()).toBe('Last')
      await press('Home')
      expect(active()).toBe('First')
      wrapper.unmount()
    })

    test('Escape asks to close, and neither it nor the arrows reach the window', async () => {
      const wrapper = await mountMenu(true)
      const reached = vi.fn()
      window.addEventListener('keydown', reached)
      expect((await press('ArrowDown')).defaultPrevented).toBe(true)
      expect((await press('Escape')).defaultPrevented).toBe(true)
      window.removeEventListener('keydown', reached)
      expect(reached).not.toHaveBeenCalled()
      expect(wrapper.emitted('close')).toHaveLength(1)
      wrapper.unmount()
    })

    test('Enter runs the focused item and closes the menu', async () => {
      const wrapper = await mountMenu(true)
      await press('ArrowDown')
      document.activeElement?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(items[2]?.type === 'item' && vi.mocked(items[2].action)).toHaveBeenCalledOnce()
      expect(wrapper.emitted('close')).toHaveLength(1)
      wrapper.unmount()
    })
  })
})
