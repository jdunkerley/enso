import { mount } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import TableHeader from '../TableHeader.vue'

function baseProps() {
  return {
    column: {
      getColId: () => 'a',
      getColDef: () => ({ mainMenuItems: ['autoSizeThis'] }),
    },
    api: { autoSizeColumns: vi.fn() },
    context: undefined,
    displayName: 'A',
    showColumnMenuAfterMouseClick: vi.fn(),
    columnParams: { type: 'rowIndexColumn' as const },
    onHeaderEditingStarted: vi.fn(),
    onHeaderEditingStopped: vi.fn(),
  }
}

test('opens GridPopupMenu with the column mainMenuItems on right-click when unlicensed', async () => {
  const props = baseProps()
  // `GridPopupMenu` is stubbed rather than deep-rendered: its real implementation teleports to
  // `#floatingLayer` and injects the ancestor-provided interaction handler
  // (`@/providers/interactionHandler`), which no ancestor here provides. Same approach as Task 2's
  // `AgGridTableView.contextMenu.test.ts` — the auto-stub still records the real props this test
  // asserts on, and `resolveGridMenuItems` runs unmocked.
  const wrapper = mount(TableHeader, {
    props,
    attachTo: document.body,
    global: { stubs: { GridPopupMenu: true } },
  })

  // `TableHeader.vue` binds `@click.right`, which the Vue compiler transforms into a listener on
  // the native `contextmenu` event guarded by `event.button !== 2` (see
  // `@vue/compiler-dom`'s `transformOn`). `MouseEventInit.button` defaults to 0, so the event must
  // set `button: 2` explicitly or the guard silently drops the event before the handler runs.
  await wrapper
    .find('.ag-cell-label-container')
    .trigger('contextmenu', { clientX: 5, clientY: 6, button: 2 })
  await wrapper.vm.$nextTick()

  expect(props.showColumnMenuAfterMouseClick).not.toHaveBeenCalled()
  const popup = wrapper.findComponent({ name: 'GridPopupMenu' })
  expect(popup.exists()).toBe(true)
  expect(popup.props('items')).toEqual([
    { type: 'item', name: 'Autosize This Column', action: expect.any(Function) },
  ])
  expect(popup.props('point')).toEqual({ x: 5, y: 6 })
})
