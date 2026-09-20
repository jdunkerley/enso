import { initializeActions } from '@/providers/action'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent, h, Suspense } from 'vue'
import AgGridTableView from '../../AgGridTableView.vue'

// Prevent the real AgGridVue from mounting a real grid — this test only exercises the Vue-level
// cellContextMenu handler wiring, not AG Grid's own DOM rendering (see the Foundation plan's
// AgGridVue.test.ts for why a real grid mount is out of scope for unit tests here).
vi.mock('../AgGridVue', () => ({
  AgGridVue: {
    name: 'StubAgGridVue',
    props: ['getContextMenuItems'],
    emits: ['cellContextMenu'],
    template: '<div />',
  },
}))

describe('AgGridTableView context menu fallback (no AG Grid Enterprise license configured)', () => {
  test('opens GridPopupMenu from a cellContextMenu event, using the column-level contextMenuItems when present', async () => {
    // `AgGridTableView.vue`'s `<script setup>` does a top-level `await import(...)` for
    // `AgGridVue`, making its own setup async. Vue requires an async-setup component to be nested
    // under a `<Suspense>` boundary or it never mounts at all (not just "delayed" — Vue Test
    // Utils' `wrapper.vm` stays an empty wrapper forever otherwise, since the component instance
    // is never attached). The brief's literal `mount(AgGridTableView, ...)` hits exactly that, so
    // this wraps it in a minimal `<Suspense>` host, matching how the app itself renders it (any
    // real usage site is already inside some ancestor `<Suspense>`/async boundary).
    const props = {
      rowData: [{ value: 1 }],
      columnDefs: [
        {
          field: 'value',
          colId: 'value',
          contextMenuItems: ['autoSizeThis'],
        },
      ],
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
    // `GridPopupMenu` is stubbed (rather than deep-rendered) because its real implementation
    // teleports to `#floatingLayer` and its descendants (`MenuButton`, `TooltipTrigger`, ...) need
    // several more ancestor-provided contexts (interaction handler, global event registry, tooltip
    // registry) that only `App.vue` sets up for real. None of that is what this test is about —
    // it only needs to confirm `AgGridTableView` mounts `GridPopupMenu` with the resolved items and
    // click point, which the stub still receives as props.
    const wrapper = mount(SuspenseHost, {
      attachTo: document.body,
      global: { stubs: { GridPopupMenu: true } },
    })
    await flushPromises()

    const stub = wrapper.findComponent({ name: 'StubAgGridVue' })
    const api = { autoSizeColumns: vi.fn() }
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
    await wrapper.vm.$nextTick()

    const popup = wrapper.findComponent({ name: 'GridPopupMenu' })
    expect(popup.exists()).toBe(true)
    expect(popup.props('items')).toEqual([
      { type: 'item', name: 'Autosize This Column', action: expect.any(Function) },
    ])
    expect(popup.props('point')).toEqual({ x: 10, y: 20 })
  })
})
