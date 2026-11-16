import { initializeActions } from '@/providers/action'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent, h, Suspense } from 'vue'
import AgGridTableView from '../../AgGridTableView.vue'

// Prevent the real AgGridVue from mounting a real grid — this test only exercises the Vue-level
// cellContextMenu handler wiring, not AG Grid's own DOM rendering.
vi.mock('ag-grid-vue3', () => ({
  AgGridVue: {
    name: 'StubAgGridVue',
    props: ['getContextMenuItems'],
    emits: ['cellContextMenu', 'bodyScroll'],
    template: '<div />',
  },
}))
// The stub never reads `modules`, but the real module loader would still run and import AG Grid
// for no reason.
vi.mock('../agGridModules', () => ({ agGridModules: [] }))

/**
 * Mounts the grid with a stubbed `AgGridVue` and `GridPopupMenu`.
 *
 * `AgGridTableView.vue`'s `<script setup>` does a top-level `await import(...)` for `AgGridVue`,
 * making its own setup async. Vue requires an async-setup component to be nested under a
 * `<Suspense>` boundary or it never mounts at all (not just "delayed" — Vue Test Utils'
 * `wrapper.vm` stays an empty wrapper forever otherwise, since the component instance is never
 * attached). So this wraps it in a minimal `<Suspense>` host, matching how the app itself renders
 * it (any real usage site is already inside some ancestor `<Suspense>`/async boundary).
 *
 * `GridPopupMenu` is stubbed (rather than deep-rendered) because its real implementation teleports
 * to `#floatingLayer` and its descendants (`MenuButton`, `TooltipTrigger`, ...) need several more
 * ancestor-provided contexts (interaction handler, global event registry, tooltip registry) that
 * only `App.vue` sets up for real. These tests only need to confirm `AgGridTableView` mounts
 * `GridPopupMenu` with the resolved items and click point (which the stub still receives as
 * props), and when it unmounts it.
 */
async function mountGrid() {
  const props = {
    rowData: [{ value: 1 }],
    columnDefs: [{ field: 'value', colId: 'value', contextMenuItems: ['autoSizeThis'] }],
    defaultColDef: {},
  }
  const SuspenseHost = defineComponent({
    setup() {
      // `AgGridTableView.vue` calls `registerHandlers`, which injects the `Actions` context —
      // normally provided by an ancestor (`App.vue`/`VisualizationHost.vue`) that this isolated
      // mount doesn't have.
      initializeActions()
      return () => h(Suspense, () => h(AgGridTableView, props))
    },
  })
  const wrapper = mount(SuspenseHost, {
    attachTo: document.body,
    global: { stubs: { GridPopupMenu: true } },
  })
  await flushPromises()
  const stub = wrapper.findComponent({ name: 'StubAgGridVue' })
  // AG Grid 36 scrolls both axes in one element, `.ag-grid-viewport`, which the stub lacks.
  const viewport = document.createElement('div')
  viewport.className = 'ag-grid-viewport'
  stub.element.appendChild(viewport)
  return { wrapper, stub, viewport }
}

/**
 * A stand-in for the grid API. Its scroll position is what AG Grid *reports*, which lags behind the
 * viewport element's real one (`getVScrollPosition` returns a cached `lastScrollTop` until the
 * viewport's own `scroll` event invalidates it), so the tests move it separately.
 */
function fakeScrollingApi() {
  const position = { left: 0, top: 0 }
  return {
    position,
    autoSizeColumns: vi.fn(),
    getHorizontalPixelRange: () => ({ left: position.left, right: position.left + 100 }),
    getVerticalPixelRange: () => ({ top: position.top, bottom: position.top + 100 }),
  }
}

/** Emits the `cellContextMenu` AG Grid raises for a right-click on the only cell. */
async function rightClickCell(
  stub: Awaited<ReturnType<typeof mountGrid>>['stub'],
  api: ReturnType<typeof fakeScrollingApi> = fakeScrollingApi(),
) {
  stub.vm.$emit('cellContextMenu', {
    event: new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
    column: {
      getColId: () => 'value',
      getColDef: () => ({ contextMenuItems: ['autoSizeThis'] }),
    },
    node: { data: { value: 1 } },
    value: 1,
    api,
    context: undefined,
  })
  await stub.vm.$nextTick()
}

describe('AgGridTableView context menu', () => {
  test('opens GridPopupMenu from a cellContextMenu event, using the column-level contextMenuItems when present', async () => {
    const { wrapper, stub } = await mountGrid()
    await rightClickCell(stub)

    const popup = wrapper.findComponent({ name: 'GridPopupMenu' })
    expect(popup.exists()).toBe(true)
    expect(popup.props('items')).toEqual([
      { type: 'item', name: 'Autosize This Column', action: expect.any(Function) },
    ])
    expect(popup.props('point')).toEqual({ x: 10, y: 20 })
  })

  // The grid scrolls inside its own shadow root, where a `scroll` event never reaches `window`, so
  // the popup cannot see it: the grid has to close the menu on AG Grid's own `bodyScroll` event.
  test('scrolling the grid body closes the menu', async () => {
    const { wrapper, stub, viewport } = await mountGrid()
    const api = fakeScrollingApi()
    await rightClickCell(stub, api)
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)

    viewport.scrollTop = 40
    api.position.top = 40
    stub.vm.$emit('bodyScroll', { direction: 'vertical', api })
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)
  })

  test('scrolling the grid body sideways closes the menu', async () => {
    const { wrapper, stub, viewport } = await mountGrid()
    await rightClickCell(stub)

    viewport.scrollLeft = 40
    stub.vm.$emit('bodyScroll', { direction: 'horizontal', api: fakeScrollingApi() })
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)
  })

  // AG Grid raises `bodyScroll` asynchronously (behind a `setTimeout`), like `cellContextMenu`: the
  // scroll that the right-click itself causes (AG Grid brings the focused cell into view) is
  // reported after the menu has opened, and must not close it (#814, found on Linux CI).
  test('a scroll that was already made when the menu opened leaves it open', async () => {
    const { wrapper, stub, viewport } = await mountGrid()
    const api = fakeScrollingApi()
    viewport.scrollLeft = 8
    api.position.left = 8
    await rightClickCell(stub, api)

    stub.vm.$emit('bodyScroll', { direction: 'horizontal', left: 8, top: -1, api })
    stub.vm.$emit('bodyScroll', { direction: 'vertical', left: 8, top: 0, api })
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)
  })

  // The position AG Grid reports is cached: on Linux and macOS the `cellContextMenu` handler can run
  // before the frame that delivers the focus-scroll's `scroll` event, so what it reports is stale
  // while the viewport element has moved already. The menu must compare the element's real position.
  test('a stale position reported by the grid API does not close the menu', async () => {
    const { wrapper, stub, viewport } = await mountGrid()
    const api = fakeScrollingApi()
    viewport.scrollTop = 30 // the focus-scroll has happened ...
    api.position.top = 0 // ... but the API still reports the cached position.
    await rightClickCell(stub, api)

    api.position.top = 30 // The `scroll` event arrives, and the cache catches up.
    stub.vm.$emit('bodyScroll', { direction: 'vertical', left: 0, top: 30, api })
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)
  })

  test('a menu opened again is compared with the position it was opened at', async () => {
    const { wrapper, stub, viewport } = await mountGrid()
    const api = fakeScrollingApi()
    await rightClickCell(stub, api)
    wrapper.findComponent({ name: 'GridPopupMenu' }).vm.$emit('close')
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(false)

    viewport.scrollTop = 25
    await rightClickCell(stub, api)
    stub.vm.$emit('bodyScroll', { direction: 'vertical', api })
    await stub.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'GridPopupMenu' }).exists()).toBe(true)
  })
})
