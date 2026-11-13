import { initializeActions } from '@/providers/action'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ColDef } from 'ag-grid-community'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, Suspense } from 'vue'
import AgGridTableView from '../../AgGridTableView.vue'

// The real grid is replaced by a stub that only exposes the props and events this test drives.
vi.mock('ag-grid-vue3', () => ({
  AgGridVue: {
    name: 'StubAgGridVue',
    props: ['defaultColDef'],
    emits: ['gridReady', 'gridPreDestroyed'],
    template: '<div />',
  },
}))
vi.mock('../agGridModules', () => ({ agGridModules: [] }))

/** The part of AG Grid's cell class parameters that the highlight rule reads. */
type RangeRule = (params: {
  node: { rowIndex: number | null }
  column?: { getColId: () => string } | null
  colDef: { colId?: string }
}) => boolean

/** A stand-in for `GridApi` that, once destroyed, behaves like AG Grid's: it warns and answers `undefined`. */
function fakeApi() {
  let destroyed = false
  return {
    destroy: () => {
      destroyed = true
    },
    isDestroyed: () => destroyed,
    getAllDisplayedColumns: () => (destroyed ? undefined : [{ getColId: () => 'value' }]),
    refreshCells: vi.fn(),
    // Called by `installCommunityClipboardPatch`; irrelevant here.
    copyToClipboard: vi.fn(),
    cutToClipboard: vi.fn(),
    pasteFromClipboard: vi.fn(),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AgGridTableView range highlight after the grid is destroyed (#635)', () => {
  async function mountGrid() {
    const SuspenseHost = defineComponent({
      setup() {
        initializeActions()
        return () =>
          h(Suspense, () =>
            h(AgGridTableView, {
              rowData: [{ value: 1 }],
              columnDefs: [{ field: 'value', colId: 'value' }],
              defaultColDef: {},
            }),
          )
      },
    })
    const wrapper = mount(SuspenseHost, {
      attachTo: document.body,
      global: { stubs: { GridPopupMenu: true } },
    })
    await flushPromises()
    return wrapper
  }

  /** Evaluates the cell class rule exactly as AG Grid does when it renders a cell. */
  function isHighlighted(stub: VueWrapper) {
    const rule = stub.props<ColDef>('defaultColDef' as never).cellClassRules
      ?.communityCellRangeSelected
    expect(rule).toBeTypeOf('function')
    return (rule as RangeRule)({
      node: { rowIndex: 0 },
      column: { getColId: () => 'value' },
      colDef: {},
    })
  }

  /** Puts a body cell into the grid and presses the mouse on it, which starts a range there. */
  function pressCell(wrapper: VueWrapper) {
    const cell = document.createElement('div')
    cell.innerHTML =
      '<div class="ag-row" row-index="0"><div class="ag-cell" col-id="value"></div></div>'
    wrapper.find('.agGridTableViewWrapper').element.appendChild(cell)
    cell.querySelector('.ag-cell')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  }

  test('the highlight rule answers false instead of throwing when evaluated on a destroyed grid', async () => {
    const wrapper = await mountGrid()
    const stub = wrapper.findComponent({ name: 'StubAgGridVue' })
    const api = fakeApi()
    stub.vm.$emit('gridReady', { api })

    pressCell(wrapper)
    expect(isHighlighted(stub)).toBe(true)

    api.destroy()
    expect(() => isHighlighted(stub)).not.toThrow()
    wrapper.unmount()
  })

  test('forgets the API on gridPreDestroyed, so nothing calls into it afterwards', async () => {
    vi.useFakeTimers()
    const wrapper = await mountGrid()
    const stub = wrapper.findComponent({ name: 'StubAgGridVue' })
    const api = fakeApi()
    stub.vm.$emit('gridReady', { api })
    expect(wrapper.findComponent(AgGridTableView).vm.gridApi).toBe(api)

    // Queue a repaint, then destroy the grid before the timer fires.
    pressCell(wrapper)
    stub.vm.$emit('gridPreDestroyed', { api })
    api.destroy()
    vi.runAllTimers()

    expect(api.refreshCells).not.toHaveBeenCalled()
    expect(wrapper.findComponent(AgGridTableView).vm.gridApi).toBeUndefined()
    wrapper.unmount()
  })

  test('a late gridPreDestroyed of a replaced grid keeps the new grid’s API', async () => {
    const wrapper = await mountGrid()
    const stub = wrapper.findComponent({ name: 'StubAgGridVue' })
    const oldApi = fakeApi()
    const newApi = fakeApi()
    stub.vm.$emit('gridReady', { api: oldApi })
    stub.vm.$emit('gridReady', { api: newApi })
    stub.vm.$emit('gridPreDestroyed', { api: oldApi })
    expect(wrapper.findComponent(AgGridTableView).vm.gridApi).toBe(newApi)
    wrapper.unmount()
  })
})
