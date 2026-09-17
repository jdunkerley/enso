<script lang="ts">
export type AgGridTableViewProps<TData, TValue> = {
  rowData: TData[]
  columnDefs: (ColDef<TData, TValue> | ColGroupDef<TData>)[] | null
  defaultColDef: ColDef<TData>
  getRowId?: GetRowIdFunc<TData>
  components?: Record<string, Component>
  singleClickEdit?: boolean
  stopEditingWhenCellsLoseFocus?: boolean
  suppressDragLeaveHidesColumns?: boolean
  suppressMoveWhenColumnDragging?: boolean
  textFormatOption?: TextFormatOptions
  processDataFromClipboard?: (params: ProcessDataFromClipboardParams<TData>) => string[][] | null
  datasource?: IServerSideDatasource | IDatasource | boolean
  rowCount?: number
  isServerSideModel?: boolean
  gridIdHash?: string | null
  getContextMenuItems?: (
    params: GetContextMenuItemsParams,
  ) => (MenuItemDef | string)[] | GetContextMenuItems
}

/**
 * A more specialized version of AGGrid's `MenuItemDef` to simplify testing (the tests need to provide
 * only values actually used by the composable)
 */
export interface MenuItem<TData> extends MenuItemDef<TData> {
  action: (params: {
    node: { data: TData | undefined } | null
    api: { copyToClipboard: () => void; cutToClipboard: () => void; pasteFromClipboard: () => void }
  }) => void
}

const AGGRID_DEFAULT_COPY_ICON =
  '<span class="ag-icon ag-icon-copy" unselectable="on" role="presentation"></span>'
const AGGRID_DEFAULT_CUT_ICON =
  '<span class="ag-icon ag-icon-cut" unselectable="on" role="presentation"></span>'
const AGGRID_DEFAULT_PASTE_ICON =
  '<span class="ag-icon ag-icon-paste" unselectable="on" role="presentation"></span>'

/** Whether to include column headers in copied clipboard content or not. See {@link sendToClipboard}. */
const copyWithHeaders = ref(false)

export const commonContextMenuActions = {
  cut: {
    name: 'Cut',
    shortcut: gridBindings.bindings['grid.cutCells'].humanReadable,
    action: ({ api }) => {
      copyWithHeaders.value = false
      api.cutToClipboard()
    },
    icon: AGGRID_DEFAULT_CUT_ICON,
  },
  copy: {
    name: 'Copy',
    shortcut: gridBindings.bindings['grid.copyCells'].humanReadable,
    action: ({ api }) => {
      copyWithHeaders.value = false
      api.copyToClipboard()
    },
    icon: AGGRID_DEFAULT_COPY_ICON,
  },
  copyWithHeaders: {
    name: 'Copy with Headers',
    action: ({ api }) => {
      copyWithHeaders.value = true
      api.copyToClipboard()
    },
    icon: AGGRID_DEFAULT_COPY_ICON,
  },
  paste: {
    name: 'Paste',
    shortcut: gridBindings.bindings['grid.pasteCells'].humanReadable,
    action: ({ api }) => api.pasteFromClipboard(),
    icon: AGGRID_DEFAULT_PASTE_ICON,
  },
} satisfies Record<string, MenuItem<unknown>>

/**
 * Grid options controlling cell selection. Licensed builds use AG Grid Enterprise's native
 * `cellSelection`; unlicensed builds disable it and rely on `communityCellRangeSelected`
 * (applied via `cellClassRules` in the template) for the visual highlight instead — see
 * `communityCellRange.ts` for the range-tracking logic driving that class.
 */
export function buildSelectionGridOptions(enterpriseAvailable: boolean) {
  return enterpriseAvailable ?
      { cellSelection: true as const, cellClassRules: undefined }
    : {
        cellSelection: undefined,
        cellClassRules: {
          communityCellRangeSelected: (params: {
            node: { rowIndex: number | null }
            colDef: { colId?: string }
          }) =>
            params.node.rowIndex != null &&
            params.colDef.colId != null &&
            isInCommunityRange({
              rowIndex: params.node.rowIndex,
              colId: params.colDef.colId,
            }),
        },
      }
}

// `cellClassRules` predicates are plain functions AG Grid calls with no closure over component
// state, so route them through this module-level indirection, reassigned per active grid.
let isInCommunityRangeRef: (coord: CellCoord) => boolean = () => false
function isInCommunityRange(coord: CellCoord) {
  return isInCommunityRangeRef(coord)
}
</script>

<script setup lang="ts" generic="TData, TValue">
/**
 * Component adding some useful logic to AGGrid table component (like keeping track of colum sizes),
 * and using common style for tables in our application.
 */
import { LINE_BOUNDARIES } from '$/utils/data/string'
import { gridBindings } from '@/bindings'
import { clipboardNodeData, writeClipboard } from '@/components/GraphEditor/graphClipboard'
import {
  parseTsvData,
  rowsToTsv,
  tableToEnsoExpression,
} from '@/components/GraphEditor/widgets/WidgetTableEditor/tableParsing'
import type { TextFormatOptions } from '@/components/visualizations/TableVisualization.vue'
import {
  default as VueComponentHost,
  VueHostInstance,
  type VueComponentHandle,
} from '@/components/VueHostRender.vue'
import { modKey } from '@/composables/events'
import { registerHandlers } from '@/providers/action'
import { useAutoBlur } from '@/util/autoBlur'
import type {
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  ColDef,
  ColGroupDef,
  ColumnMovedEvent,
  ColumnResizedEvent,
  ColumnVisibleEvent,
  FirstDataRenderedEvent,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  GetRowIdFunc,
  GridApi,
  GridReadyEvent,
  ICellEditorComp,
  IDatasource,
  IHeaderComp,
  IHeaderParams,
  IServerSideDatasource,
  MenuItemDef,
  ProcessDataFromClipboardParams,
  RowDataUpdatedEvent,
  RowEditingStartedEvent,
  RowEditingStoppedEvent,
  RowHeightParams,
  SortChangedEvent,
} from 'ag-grid-enterprise'
import * as iter from 'enso-common/src/utilities/data/iter'
import * as objects from 'enso-common/src/utilities/data/object'
import {
  computed,
  h,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
  type Component,
  type ComponentInstance,
} from 'vue'
import { AG_GRID_ENTERPRISE_AVAILABLE } from './AgGridTableView/agGridLicense'
import { useCommunityCellRange, type CellCoord } from './AgGridTableView/communityCellRange'

const props = defineProps<AgGridTableViewProps<TData, TValue>>()
const emit = defineEmits<{
  cellEditingStarted: [event: CellEditingStartedEvent]
  cellEditingStopped: [event: CellEditingStoppedEvent]
  rowEditingStarted: [event: RowEditingStartedEvent]
  rowEditingStopped: [event: RowEditingStoppedEvent]
  rowDataUpdated: [event: RowDataUpdatedEvent]
  sortOrFilterUpdated: [event: SortChangedEvent]
  columnVisibleChanged: [event: ColumnVisibleEvent]
  columnMoved: [event: ColumnMovedEvent]
}>()
defineOptions({ inheritAttrs: false })

const widths = reactive(new Map<string, number>())
const wrapper = ref<HTMLElement>()
const grid = ref<ComponentInstance<typeof AgGridVue>>()
const gridApi = shallowRef<GridApi<TData>>()
const popupParent = document.body
useAutoBlur(() => grid.value?.$el)

const {
  range: communityRange,
  startAt,
  extendTo,
  clear,
  isInRange,
  rectangle,
} = useCommunityCellRange(
  () => gridApi.value?.getAllDisplayedColumns().map((c) => c.getColId()) ?? [],
)

// `cellClassRules` predicates are plain functions AG Grid calls with no closure over component
// state, so route them through this module-level indirection, reassigned per active grid.
isInCommunityRangeRef = isInRange
onUnmounted(() => {
  if (isInCommunityRangeRef === isInRange) isInCommunityRangeRef = () => false
})

function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api
  if (rowModelType.value === 'serverSide') {
    gridApi.value.retryServerSideLoads()
  }
}

const rowModelType = computed(() => {
  if (!props.isServerSideModel) return 'clientSide'
  return AG_GRID_ENTERPRISE_AVAILABLE ? 'serverSide' : 'infinite'
})

const serverSideDatasourceValue = computed(() =>
  rowModelType.value === 'serverSide' ? (props.datasource as IServerSideDatasource) : undefined,
)
const infiniteDatasourceValue = computed(() =>
  rowModelType.value === 'infinite' ? (props.datasource as IDatasource) : undefined,
)

const gridKeyIncrement = ref(0)
const gridKey = computed(() =>
  props.gridIdHash ?
    `${props.gridIdHash}-${gridKeyIncrement.value}`
  : `grid-${gridKeyIncrement.value}`,
)

const forceGridRefresh = () => {
  //when using the ag grid severSide model this forces the grid to 'refresh' and call getRows
  gridKeyIncrement.value++
}

watch(
  () => props.textFormatOption,
  () => {
    gridApi.value?.redrawRows()
    gridApi.value?.resetRowHeights()
  },
)

function updateColumnWidths(event: FirstDataRenderedEvent | RowDataUpdatedEvent) {
  if (event.api == null) {
    console.warn('AG Grid API does not exist.')
    return
  }
  const cols = event.api.getAllGridColumns().filter((c) => {
    const id = c.getColId()
    return id && !widths.has(id)
  })
  event.api.autoSizeColumns(cols)
}

function lockColumnSize(e: ColumnResizedEvent) {
  // Check if the resize is finished, and it's not from the API (which is triggered by us).
  if (!e.finished || e.source === 'api') return
  // If the user manually resized (or manually autosized) a column, we don't want to auto-size it
  // on a resize.
  if (e.source !== 'autosizeColumns') {
    for (const column of e.columns ?? []) {
      const id = column.getColId()
      if (id) widths.set(id, column.getActualWidth())
    }
  }
}

/**
 * Copy the provided TSV-formatted table data to the clipboard.
 *
 * The data will be copied as `text/plain` TSV data for spreadsheet applications, and an Enso-specific MIME section for
 * pasting as a new table node.
 *
 * By default, AG Grid writes only `text/plain` TSV data to the clipboard. This is sufficient to paste into spreadsheet
 * applications, which are liberal in what they try to interpret as tabular data; however, when pasting into Enso, the
 * application needs to be able to distinguish tabular clipboard contents to choose the correct paste action.
 *
 * Our heuristic to identify clipboard data from applications like Excel and Google Sheets is to check for a <table> tag
 * in the clipboard `text/html` data. If we were to add a `text/html` section to the data so that it could be recognized
 * like other spreadsheets, when pasting into other applications some applications might use the `text/html` data in
 * preference to the `text/plain` content--so we would need to construct an HTML table that fully represents the
 * content.
 *
 * To avoid that complexity, we bypass our table-data detection by including application-specific data in the clipboard
 * content. This data contains a ready-to-paste node that constructs an Enso table from the provided TSV.
 */
function sendToClipboard({ data }: { data: string }) {
  const rows = parseTsvData(data)
  if (rows == null) return
  // First row of `data` contains column names.
  const columnNames = rows[0]
  const rowsWithoutHeaders = rows.slice(1)
  const expression = tableToEnsoExpression(rowsWithoutHeaders, columnNames)
  if (expression == null) return
  const clipboardContent = copyWithHeaders.value ? rows : rowsWithoutHeaders
  return writeClipboard({
    ...clipboardNodeData([{ expression }]),
    'text/plain': rowsToTsv(clipboardContent),
  })
}

/**
 * AgGrid does not conform RFC 4180 when serializing copied cells to TSV before calling {@link sendToClipboard}.
 * We need to escape tabs, newlines and double quotes in the cell values to make
 * sure round-trip with Excel and Google Spreadsheet works.
 */
function processCellForClipboard({
  value,
  formatValue,
}: {
  value: any
  formatValue: (arg: any) => string
}) {
  if (value == null) return ''
  else if (typeof value === 'object' && '_display_text_' in value && value['_display_text_'])
    return String(value['_display_text_'])
  const formatted = formatValue(value)
  if (formatted.match(/[\t\n\r"]/)) {
    return `"${formatted.replaceAll(/"/g, '""')}"`
  }
  return formatted
}

defineExpose({ gridApi, forceGridRefresh })

// === Keybinds ===

function gridAction(action: () => void) {
  return {
    action: () => {
      if (gridApi.value?.getFocusedCell() == null) return
      action()
    },
  }
}

const actionHandlers = registerHandlers({
  'grid.cutCells': gridAction(() => {
    copyWithHeaders.value = false
    gridApi.value?.cutToClipboard()
  }),
  'grid.copyCells': gridAction(() => {
    copyWithHeaders.value = false
    gridApi.value?.copyToClipboard()
  }),
  'grid.pasteCells': gridAction(() => gridApi.value?.pasteFromClipboard()),
})

const handler = gridBindings.handler(
  objects.mapEntries(gridBindings.bindings, (actionName) => actionHandlers[actionName].action),
)

function suppressCopy(event: KeyboardEvent) {
  // Suppress the default keybindings of AgGrid, because we want to use our own handlers (and bindings),
  // and AgGrid API does not allow copy suppression.
  if (
    (event.code === 'KeyX' || event.code === 'KeyC' || event.code === 'KeyV') &&
    modKey(event) &&
    wrapper.value != null &&
    event.target != wrapper.value
  ) {
    event.stopPropagation()
    wrapper.value.dispatchEvent(new KeyboardEvent(event.type, event))
  }
}

function stopIfPrevented(event: Event) {
  // When AG Grid handles the context menu event it prevents-default, but it doesn't stop propagation.
  if (event.defaultPrevented) event.stopPropagation()
}

// === Community cell-range selection (unlicensed fallback for Enterprise `cellSelection`) ===

function onCellMouseDown(event: { rowIndex: number | null; column: { getColId(): string } }) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || event.rowIndex == null) return
  startAt({ rowIndex: event.rowIndex, colId: event.column.getColId() })
  gridApi.value?.refreshCells({ force: true })
}

function onCellMouseOver(
  event: { rowIndex: number | null; column: { getColId(): string } },
  mouseButtonDown: boolean,
) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || event.rowIndex == null || !mouseButtonDown) return
  extendTo({ rowIndex: event.rowIndex, colId: event.column.getColId() })
  gridApi.value?.refreshCells({ force: true })
}

let mouseButtonDown = false
function onWrapperMouseDown() {
  mouseButtonDown = true
}
function onWrapperMouseUp() {
  mouseButtonDown = false
}

function extendRangeByKeyboard(event: KeyboardEvent) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || !event.shiftKey) return
  const delta =
    event.key === 'ArrowDown' ? { rowIndex: 1, colIndex: 0 }
    : event.key === 'ArrowUp' ? { rowIndex: -1, colIndex: 0 }
    : event.key === 'ArrowLeft' ? { rowIndex: 0, colIndex: -1 }
    : event.key === 'ArrowRight' ? { rowIndex: 0, colIndex: 1 }
    : undefined
  const focused = gridApi.value?.getFocusedCell()
  if (delta == null || focused == null) return
  const columnIds = gridApi.value?.getAllDisplayedColumns().map((c) => c.getColId()) ?? []
  const currentColIndex = columnIds.indexOf(focused.column.getColId())
  const current = communityRange.value ?? {
    anchor: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
    focus: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
  }
  const nextColId = columnIds[currentColIndex + delta.colIndex] ?? current.focus.colId
  if (communityRange.value == null) startAt(current.anchor)
  extendTo({
    rowIndex: Math.max(0, current.focus.rowIndex + delta.rowIndex),
    colId: nextColId,
  })
  gridApi.value?.refreshCells({ force: true })
  event.preventDefault()
}

// === Wrapping and Hosting Vue Components ===

const vueHost = new VueHostInstance()

const mappedComponents = computed(() => {
  if (!props.components) return
  const retval: Record<string, new () => IHeaderComp | ICellEditorComp> = {}
  for (const [key, comp] of Object.entries(props.components)) {
    class ComponentWrapper implements IHeaderComp {
      private readonly container: HTMLElement = document.createElement('div')
      private handle: VueComponentHandle | undefined

      init(params: IHeaderParams) {
        this.handle = vueHost.register(h(comp, params), this.container, params.column.getColId())
      }

      getGui() {
        return this.container
      }

      refresh(params: IHeaderParams) {
        this.handle?.update(h(comp, params), this.container)
        return true
      }

      destroy() {
        this.handle?.unregister()
      }
    }
    retval[key] = ComponentWrapper
  }
  return retval
})
const DEFAULT_ROW_HEIGHT = 22
function getRowHeight(params: RowHeightParams): number {
  if (props.textFormatOption === 'off') {
    return DEFAULT_ROW_HEIGHT
  }
  const rowData = Object.values(params.data)
  const textValues = rowData.filter((r): r is string => typeof r === 'string')
  if (!textValues.length) {
    return DEFAULT_ROW_HEIGHT
  }
  const returnCharsCount = iter.map(textValues, (text) =>
    iter.count(text.matchAll(LINE_BOUNDARIES)),
  )
  const maxReturnCharsCount = iter.reduce(returnCharsCount, Math.max, 0)
  return (maxReturnCharsCount + 1) * DEFAULT_ROW_HEIGHT
}

const { AgGridVue } = await import('./AgGridTableView/AgGridVue')
</script>

<template>
  <div
    ref="wrapper"
    class="agGridTableViewWrapper"
    @keydown="(handler($event) || stopIfPrevented($event), extendRangeByKeyboard($event))"
    @keydown.capture="suppressCopy"
    @keydown.space.stop
    @mousedown.capture="onWrapperMouseDown"
    @mouseup.capture="onWrapperMouseUp"
  >
    <!-- The `cacheBlockSize` value of `1000` below must stay in sync with the backend's
         `max_rows` in `get_rows_for_table`
         (distribution/lib/Standard/Visualization/0.0.0-dev/src/Table/Visualization.enso) —
         nothing currently links them, so a one-sided change would silently break paging. -->
    <AgGridVue
      v-bind="{ ...$attrs, ...buildSelectionGridOptions(AG_GRID_ENTERPRISE_AVAILABLE) }"
      ref="grid"
      :key="gridKey"
      class="ag-theme-alpine agGridTableView"
      :headerHeight="26"
      :rowModelType="rowModelType"
      :serverSideDatasource="serverSideDatasourceValue"
      :datasource="infiniteDatasourceValue"
      :rowCount="rowCount"
      :rowData="rowModelType === 'clientSide' ? rowData : null"
      :columnDefs="columnDefs"
      :defaultColDef="defaultColDef"
      :copyHeadersToClipboard="true"
      :processCellForClipboard="processCellForClipboard"
      :sendToClipboard="sendToClipboard"
      :suppressFieldDotNotation="true"
      :popupParent="popupParent"
      :components="mappedComponents"
      :singleClickEdit="singleClickEdit"
      :stopEditingWhenCellsLoseFocus="stopEditingWhenCellsLoseFocus"
      :suppressDragLeaveHidesColumns="suppressDragLeaveHidesColumns"
      :suppressMoveWhenColumnDragging="suppressMoveWhenColumnDragging"
      :processDataFromClipboard="processDataFromClipboard"
      :allowContextMenuWithControlKey="true"
      :cacheBlockSize="rowModelType === 'clientSide' ? undefined : 1000"
      :getContextMenuItems="getContextMenuItems"
      :getRowHeight="rowModelType === 'clientSide' ? getRowHeight : null"
      @cellMouseDown="onCellMouseDown"
      @cellMouseOver="onCellMouseOver($event, mouseButtonDown)"
      @gridReady="onGridReady"
      @firstDataRendered="updateColumnWidths"
      @rowDataUpdated="(updateColumnWidths($event), emit('rowDataUpdated', $event))"
      @columnResized="lockColumnSize"
      @cellEditingStarted="emit('cellEditingStarted', $event)"
      @cellEditingStopped="emit('cellEditingStopped', $event)"
      @rowEditingStarted="emit('rowEditingStarted', $event)"
      @rowEditingStopped="emit('rowEditingStopped', $event)"
      @sortChanged="emit('sortOrFilterUpdated', $event)"
      @filterChanged="emit('sortOrFilterUpdated', $event)"
      @columnVisible="emit('columnVisibleChanged', $event)"
      @columnMoved="emit('columnMoved', $event)"
      @contextmenu="stopIfPrevented"
    />
    <VueComponentHost :host="vueHost" />
  </div>
</template>

<style src="@ag-grid-community/styles/ag-grid.css" />
<style src="@ag-grid-community/styles/ag-theme-alpine.css" />
<style src="@/components/shared/AgGridTableView/tableViewStyle.css" />
