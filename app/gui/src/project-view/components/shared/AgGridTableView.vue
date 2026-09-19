<script lang="ts">
import type { CellCoord } from './AgGridTableView/communityCellRange'

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
 * `cellSelection`. Unlicensed builds disable it — the visual highlight instead comes from
 * `buildDefaultColDef` merging a `cellClassRules` entry into `defaultColDef` (NOT a top-level grid
 * option — `cellClassRules` only exists on `ColDef`, verified against
 * `ComponentUtil.ALL_PROPERTIES`, which is why this used to silently do nothing).
 */
export function buildSelectionGridOptions(enterpriseAvailable: boolean) {
  return enterpriseAvailable ? { cellSelection: true as const } : { cellSelection: undefined }
}

/**
 * Merges the Community range-selection highlight into `defaultColDef` when unlicensed, closing
 * directly over this grid instance's own `isInRange` predicate — no module-level indirection
 * needed (a prior version routed through a module-level ref, which leaked state across
 * simultaneously-mounted grid instances; closing per-instance avoids that entirely).
 */
export function buildDefaultColDef<TData, TValue>(
  defaultColDef: ColDef<TData, TValue>,
  enterpriseAvailable: boolean,
  isInRange: (coord: CellCoord) => boolean,
): ColDef<TData, TValue> {
  if (enterpriseAvailable) return defaultColDef
  return {
    ...defaultColDef,
    cellClassRules: {
      ...defaultColDef.cellClassRules,
      // Read the column id from the runtime column, not from `colDef`: `colDef` is the definition
      // as supplied, and TableVisualization's `toField` sets only `field`/`headerName`, leaving
      // `colDef.colId` undefined there. AG Grid derives an id for the runtime column regardless,
      // so keying off `colDef` made this predicate always false for visualizations — the highlight
      // never appeared, even though range tracking (which uses `column.getColId()` throughout) was
      // working. `colDef.colId` remains as a fallback for callers that do set it explicitly.
      communityCellRangeSelected: (params: {
        node: { rowIndex: number | null }
        column?: { getColId: () => string } | null | undefined
        colDef: { colId?: string }
      }) => {
        const colId = params.column?.getColId() ?? params.colDef.colId
        return (
          params.node.rowIndex != null &&
          colId != null &&
          isInRange({ rowIndex: params.node.rowIndex, colId })
        )
      },
    },
  }
}
</script>

<script setup lang="ts" generic="TData, TValue">
/**
 * Component adding some useful logic to AGGrid table component (like keeping track of colum sizes),
 * and using common style for tables in our application.
 */ import { LINE_BOUNDARIES } from '$/utils/data/string'
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
  CellContextMenuEvent,
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  ColDef,
  ColGroupDef,
  Column,
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
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
  type Component,
  type ComponentInstance,
} from 'vue'
import { AG_GRID_ENTERPRISE_AVAILABLE } from './AgGridTableView/agGridLicense'
import { useCommunityCellRange } from './AgGridTableView/communityCellRange'
import {
  installCommunityClipboardPatch,
  type ClipboardDeps,
  type PasteDeps,
} from './AgGridTableView/communityClipboard'

/**
 * `GridPopupMenu` deliberately lives outside `components/shared/` even though this shared
 * component imports it. `shared/README.md`'s "shared components must depend only on shared
 * components" rule exists because a non-shared dependency would be missing styles *inside the
 * shadow root* — but `GridPopupMenu` always `<Teleport>`s to `#floatingLayer` in the light DOM
 * and never renders in the shadow root, so it needs globally-injected (non-shared) styles, which
 * is exactly what living outside `shared/` gives it. Keeping it in `shared/` is what breaks it:
 * custom-element-mode compilation (`vite.config.ts`'s `customElement` matcher) would leave its
 * styles unapplied in both this component's light-DOM path and the shadow-DOM visualization path
 * (see `GridPopupMenu.vue`'s own comment for the visualization-side half of that story). Do not
 * "fix" this by moving it back.
 */ import GridPopupMenu from '@/components/GridPopupMenu.vue'
import { resolveGridMenuItems, type GridMenuItem } from './AgGridTableView/gridPopupMenuItems'

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

const effectiveDefaultColDef = computed(() =>
  buildDefaultColDef(props.defaultColDef, AG_GRID_ENTERPRISE_AVAILABLE, isInRange),
)

function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api
  // A new grid means the previous one's coordinates are meaningless. `gridKey` changes on a table
  // version change or `forceGridRefresh`, which recreates the grid without any sort/filter event —
  // the two places that otherwise clear the range — so a stale rectangle would survive and both
  // highlight and copy/cut the wrong cells.
  clear()
  if (rowModelType.value === 'serverSide') {
    gridApi.value.retryServerSideLoads()
  }
  installCommunityClipboardPatch(
    event.api,
    AG_GRID_ENTERPRISE_AVAILABLE,
    clipboardDeps,
    pasteClipboardDeps,
    () => copyWithHeaders.value,
  )
}

function clipboardDeps(): ClipboardDeps {
  return {
    enterpriseAvailable: AG_GRID_ENTERPRISE_AVAILABLE,
    gridApi: gridApi.value as unknown as ClipboardDeps['gridApi'],
    rectangle,
    processCellForClipboard,
    sendToClipboard,
  }
}

function pasteClipboardDeps(): PasteDeps {
  return {
    enterpriseAvailable: AG_GRID_ENTERPRISE_AVAILABLE,
    gridApi: gridApi.value as unknown as PasteDeps['gridApi'],
    readClipboardText: () => navigator.clipboard.readText(),
    processDataFromClipboard: (params) => props.processDataFromClipboard?.(params as any),
    parseTsvData,
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
  // Licensed path: Enterprise's own `MenuUtils.onContextMenu` calls `preventDefault()`
  // synchronously, during the browser's native `contextmenu` dispatch — so by the time this
  // handler runs (also synchronously, since it's bound to the native `contextmenu` event), it can
  // already see `event.defaultPrevented` and stop propagation from reaching ancestors (e.g.
  // `WidgetTableEditor`'s enclosing `GraphNode.vue`).
  //
  // Unlicensed path: AG Grid dispatches its own `cellContextMenu` event *asynchronously*
  // (`LocalEventService.dispatchAsync`, queued behind a `setTimeout(…, 0)` because
  // `cellContextMenu` isn't in `ALWAYS_SYNC_GLOBAL_EVENTS` and `suppressAsyncEvents` is never set
  // in this repo). `onCellContextMenu` below — and its `preventDefault()` — therefore runs a
  // macrotask *after* this handler and after the browser already finished dispatching
  // `contextmenu`, so checking `event.defaultPrevented` here would always see `false` for cells.
  // Do the prevent/stop synchronously ourselves instead, whenever the right-click lands on a grid
  // cell: `.ag-cell` is the class AG Grid puts on every cell element (verified against
  // `ag-grid.css`, e.g. its `.ag-cell { ... }` rule) — `preventDefaultOnContextMenu: true` is not a
  // substitute, since under Community it's honored only for the body viewport background and
  // header cells, not for cells. This intentionally suppresses the native menu over every cell,
  // matching how the background/header already suppress theirs, even for a cell whose resolved
  // item list later turns out empty — consistent Community behavior across the whole grid body,
  // rather than a menu that sometimes appears and sometimes silently does nothing.
  //
  // Right-clicks that aren't over a cell (the header — handled by `TableHeader.vue`'s own
  // `@click.right` — or outside the grid body entirely) are left alone and continue to bubble.
  if (
    !AG_GRID_ENTERPRISE_AVAILABLE &&
    event instanceof MouseEvent &&
    event.target instanceof Element &&
    event.target.closest('.ag-cell')
  ) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.defaultPrevented) event.stopPropagation()
}

// === Context menu fallback (no AG Grid Enterprise license) ===

const contextMenuState = ref<{
  point: { x: number; y: number }
  items: GridMenuItem[]
} | null>(null)

function resolveColumnOrGridContextMenuItems(
  event: CellContextMenuEvent<TData>,
): (string | MenuItemDef)[] {
  const colDef = event.column?.getColDef()
  const columnItems = colDef?.contextMenuItems
  if (columnItems != null) {
    return typeof columnItems === 'function' ?
        columnItems({
          api: event.api,
          context: event.context,
          column: event.column as Column,
          node: event.node ?? null,
          value: event.value,
          defaultItems: undefined,
        })
      : columnItems
  }
  const gridItems = props.getContextMenuItems?.({
    api: event.api,
    context: event.context,
    column: event.column ?? null,
    node: event.node ?? null,
    value: event.value,
    defaultItems: undefined,
  })
  if (gridItems == null) return []
  return typeof gridItems === 'function' ?
      gridItems({
        api: event.api,
        context: event.context,
        column: event.column ?? null,
        node: event.node ?? null,
        value: event.value,
        defaultItems: undefined,
      })
    : gridItems
}

function onCellContextMenu(event: CellContextMenuEvent<TData>) {
  if (AG_GRID_ENTERPRISE_AVAILABLE) return // native Enterprise context menu handles this instead
  const domEvent = event.event
  if (!(domEvent instanceof MouseEvent)) return
  const rawItems = resolveColumnOrGridContextMenuItems(event)
  if (!rawItems.length) return
  // No `domEvent.preventDefault()` here: it would run too late to matter (see `stopIfPrevented`'s
  // comment above, on the synchronous `@contextmenu` handler that now does this instead).
  contextMenuState.value = {
    point: { x: domEvent.clientX, y: domEvent.clientY },
    // `resolveGridMenuItems`'s parameter type narrows each item's `action` signature to the
    // subset of `IMenuActionParams` it actually invokes it with (`{ node, api }`) — see
    // `gridPopupMenuItems.ts`'s internal `RawMenuItem` type. A real AG Grid `MenuItemDef`'s
    // `action` is typed to expect the full `IMenuActionParams`, which `exactOptionalPropertyTypes`
    // then flags as a structural mismatch even though every actual action here only reads `node`
    // and `api` (see `commonContextMenuActions`). The cast documents that the narrower call is
    // intentional and safe for every item this codebase produces.
    items: resolveGridMenuItems(rawItems as Parameters<typeof resolveGridMenuItems>[0], {
      api: event.api,
      column: event.column ?? null,
      node: event.node ?? null,
    }),
  }
}

function closeContextMenu() {
  contextMenuState.value = null
}

// === Community cell-range selection (unlicensed fallback for Enterprise `cellSelection`) ===

function onCellMouseDown(event: {
  rowIndex: number | null
  column: { getColId(): string }
  event?: Event | null
}) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || event.rowIndex == null) return
  const nativeEvent = event.event instanceof MouseEvent ? event.event : undefined
  // Only the left/primary button starts or extends a range — right-click (context menu) and
  // middle-click must not collapse an existing selection.
  if (nativeEvent != null && nativeEvent.button !== 0) return
  const coord = { rowIndex: event.rowIndex, colId: event.column.getColId() }
  // Shift+Click extends the existing range from its anchor, matching the licensed Set Filter's
  // own Shift+Click behavior and the design spec's requirement for Shift+Click range extension.
  if (nativeEvent?.shiftKey && communityRange.value != null) {
    extendTo(coord)
  } else {
    startAt(coord)
  }
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

// Also listen on `window`, not just the wrapper's own `mouseup` — releasing the mouse button
// outside the grid (a normal thing to do mid-drag) would otherwise leave `mouseButtonDown` stuck
// `true`, so subsequent hovering (not dragging) keeps extending the range.
onMounted(() => {
  window.addEventListener('mouseup', onWrapperMouseUp)
})
onUnmounted(() => {
  window.removeEventListener('mouseup', onWrapperMouseUp)
})

function extendRangeByKeyboard(event: KeyboardEvent) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || !event.shiftKey) return
  // Back off while a cell editor is active, matching AG Grid's own native Shift+Arrow handling —
  // otherwise this fights with text selection inside an active cell editor (e.g. Table Input).
  if ((gridApi.value?.getEditingCells().length ?? 0) > 0) return
  const delta =
    event.key === 'ArrowDown' ? { rowIndex: 1, colIndex: 0 }
    : event.key === 'ArrowUp' ? { rowIndex: -1, colIndex: 0 }
    : event.key === 'ArrowLeft' ? { rowIndex: 0, colIndex: -1 }
    : event.key === 'ArrowRight' ? { rowIndex: 0, colIndex: 1 }
    : undefined
  const focused = gridApi.value?.getFocusedCell()
  if (delta == null || focused == null) return
  const columnIds = gridApi.value?.getAllDisplayedColumns().map((c) => c.getColId()) ?? []
  const current = communityRange.value ?? {
    anchor: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
    focus: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
  }
  // Use the tracked range's own focus column, not `focused.column` — AG Grid's native Shift+Arrow
  // navigation has already moved the DOM focus by the time this handler runs, so reading it here
  // would double-apply `delta.colIndex`.
  const currentColIndex = columnIds.indexOf(current.focus.colId)
  const nextColId = columnIds[currentColIndex + delta.colIndex] ?? current.focus.colId
  if (communityRange.value == null) startAt(current.anchor)
  const maxRowIndex = (gridApi.value?.getDisplayedRowCount() ?? 1) - 1
  extendTo({
    rowIndex: Math.min(maxRowIndex, Math.max(0, current.focus.rowIndex + delta.rowIndex)),
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
      :defaultColDef="effectiveDefaultColDef"
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
      :allowContextMenuWithControlKey="AG_GRID_ENTERPRISE_AVAILABLE ? true : undefined"
      :cacheBlockSize="rowModelType === 'clientSide' ? undefined : 1000"
      :getContextMenuItems="AG_GRID_ENTERPRISE_AVAILABLE ? getContextMenuItems : undefined"
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
      @sortChanged="(clear(), emit('sortOrFilterUpdated', $event))"
      @filterChanged="(clear(), emit('sortOrFilterUpdated', $event))"
      @columnVisible="emit('columnVisibleChanged', $event)"
      @columnMoved="emit('columnMoved', $event)"
      @contextmenu="stopIfPrevented"
      @cellContextMenu="onCellContextMenu"
    />
    <VueComponentHost :host="vueHost" />
    <GridPopupMenu
      v-if="contextMenuState"
      :items="contextMenuState.items"
      :point="contextMenuState.point"
      @close="closeContextMenu"
    />
  </div>
</template>

<style src="@ag-grid-community/styles/ag-grid.css" />
<style src="@ag-grid-community/styles/ag-theme-alpine.css" />
<style src="@/components/shared/AgGridTableView/tableViewStyle.css" />
