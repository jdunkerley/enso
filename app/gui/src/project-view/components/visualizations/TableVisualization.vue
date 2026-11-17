<script lang="ts">
import AgGridTableView, { commonContextMenuActions } from '@/components/shared/AgGridTableView.vue'

import {
  useTableVizToolbar,
  type SortModel,
} from '@/components/visualizations/TableVisualization/tableVizToolbar'
import { ProjectPath } from '@/util/projectPath'
import { useVisualizationConfig } from '@/util/visualizationBuiltins'
import type {
  CellClassParams,
  ColDef,
  ColumnMovedEvent,
  ColumnVisibleEvent,
  DefaultMenuItem,
  GetContextMenuItemsParams,
  ICellRendererParams,
  IDatasource,
  IGetRowsParams,
  MenuItemDef,
  SetFilterValuesFuncParams,
  SortChangedEvent,
} from 'ag-grid-community'
import {
  computed,
  onMounted,
  ref,
  shallowRef,
  watch,
  watchEffect,
  type ComponentInstance,
  type Ref,
} from 'vue'
import type { ComponentExposed } from 'vue-component-type-helpers'
import {
  convertFilterModel,
  convertSortModel,
  createDistinctExpressionTemplate,
  createExpressionRowTemplate,
  type RowsRequestParams,
  type ValueTypeArgumentChild,
  type ValueTypes,
} from './TableVisualization/TableVizDataSourceUtils'
import { columnValueToEnso } from './TableVisualization/columnValueToEnso'
import { tableMenuEntries } from './TableVisualization/tableContextMenu'
import { makeFilterModelList, type GridFilterModel } from './TableVisualization/tableVizFilterUtils'
import {
  buildTableView,
  distinctValuesFromResponse,
  getSvgTemplate,
  INDEX_FIELD_NAME,
  rowsFromPage,
  tableViewFlags,
  viewLink,
} from './TableVisualization/tableView'

import { formatText, isNumericType } from './TableVisualization/tableVizUtils'
import { parseVizActions, plainActionToolbar } from './vizActions'

export type { DataQualityMetricValue } from './TableVisualization/tableView'

export const name = 'Table'
export const icon = 'table'
export const inputType =
  'Standard.Table.Table.Table | Standard.Table.Column.Column | Standard.Table.Row.Row | Standard.Base.Data.Vector.Vector | Standard.Base.Data.Array.Array | Standard.Base.Any.Any'
export const defaultPreprocessor = [
  'Standard.Visualization.Table.Visualization',
  'prepare_visualization',
  '1000',
] as const

export type TextFormatOptions = 'full' | 'partial' | 'off'

/**
 * The row counts shown below the grid, or `undefined` when the view did not ask for a bottom
 * status bar. `gettingStarted.spec.ts` asserts on them, for a user-facing workflow.
 *
 * The filtered line appears only when it differs from the total.
 *
 * When this returns a value the template hides the top status bar — otherwise the row count would
 * be displayed twice.
 */
export function computeBottomStatusBar(
  requested: boolean,
  total: number | undefined,
  filtered: number | null,
): { total: number | undefined; filtered: number | null; showFiltered: boolean } | undefined {
  if (!requested) return undefined
  return { total, filtered, showFiltered: filtered != null && filtered !== total }
}
</script>

<script setup lang="ts">
const props = defineProps<{ data: unknown }>()
const config = useVisualizationConfig()

const rowLimit = ref(0)
const page = ref(0)
const pageLimit = ref(0)
const rowCount = ref(0)
const filteredRowCount = ref<number | null>(null)
const showRowCount = ref(true)
const isTruncated = ref(false)
const filterModel = ref<GridFilterModel[]>([])
const sortModel = ref<SortModel[]>([])
const hiddenColumns = ref<string[]>([])
const vizColumnOrder = ref<string[] | null>(null)
const defaultColDef: Ref<ColDef> = ref({
  editable: false,
  sortable: true,
  resizable: true,
  minWidth: 25,
  cellRenderer: cellRenderer,
  cellClass: cellClass,
  cellStyle: { 'padding-left': 0, 'border-right': '1px solid #C0C0C0' },
} satisfies ColDef)
const rowData = ref<Record<string, any>[]>([])
const columnDefs: Ref<ColDef[]> = ref([])
const nodeType = ref<ProjectPath | undefined>(undefined)
const grid = ref<
  ComponentInstance<typeof AgGridTableView> & ComponentExposed<typeof AgGridTableView>
>()

const getContextMenuItems = (
  params: GetContextMenuItemsParams,
): (MenuItemDef | DefaultMenuItem)[] => {
  const entries = tableMenuEntries(
    vizActions.value,
    viewLink(props.data),
    params.column ? params.column.getColId() : null,
    params.node?.data ?? null,
  )
  return [
    commonContextMenuActions.copy,
    commonContextMenuActions.copyWithHeaders,
    'separator',
    'export',
    ...entries.map((entry) => ({
      name: entry.name,
      action: () => config.createNodes({ content: entry.pattern, commit: true }),
      icon: getSvgTemplate(entry.icon),
    })),
  ]
}

const viewFlags = computed(() => tableViewFlags(props.data))

const allRowCount = computed(() => viewFlags.value.allRowCount)

const tableVersionHash = computed(() => viewFlags.value.versionHash)

const isSSRM = computed(() => viewFlags.value.isSSRM)

const bottomStatusBar = computed(() =>
  computeBottomStatusBar(
    viewFlags.value.bottomStatusBarRequested,
    allRowCount.value,
    isSSRM.value ? filteredRowCount.value : null,
  ),
)

const vizActions = computed(() => parseVizActions(props.data))

const ssrmServer = computed(() => {
  return isSSRM.value && createServer()
})

const refreshDataSource = ref(0)
const datasource = computed(() => {
  const value = refreshDataSource.value
  if (!isSSRM.value) return false
  return createInfiniteDatasource()
})

const isTableFilteredOrSorted = computed(
  () =>
    sortModel.value.length > 0 ||
    filterModel.value.length > 0 ||
    hiddenColumns.value.length > 0 ||
    vizColumnOrder.value != null,
)

// if there are upstream updates only to the row information the table version hash change indicates the grid needs to re get rows for any potetial changes
watch(tableVersionHash, () => {
  refreshDataSource.value++
})

watchEffect(() => {
  // if the column definitions remain the same but there has been updates upstream ag grid doesn't know to change its row model or to fetch new data
  if (
    (nodeType.value != null || config.nodeType != null) &&
    !nodeType.value?.equals(config.nodeType)
  ) {
    grid.value?.forceGridRefresh()
    nodeType.value = config.nodeType
  }
})

const textFormatterSelected = ref<TextFormatOptions>('partial')

const isRowCountSelectorVisible = computed(() => rowCount.value > 1000)
const dataGroupingMap = shallowRef<Map<string, boolean>>()

const selectableRowLimits = computed(() => {
  const defaults = [1000, 2500, 5000, 10000, 25000, 50000, 100000].filter(
    (r) => r <= rowCount.value,
  )
  if (rowCount.value < 100000 && !defaults.includes(rowCount.value)) {
    defaults.push(rowCount.value)
  }
  if (!defaults.includes(rowLimit.value)) {
    defaults.push(rowLimit.value)
  }
  return defaults
})

function setRowLimit(newRowLimit: number) {
  if (newRowLimit !== rowLimit.value) {
    rowLimit.value = newRowLimit
  }
}

watchEffect(() =>
  config.setPreprocessor(
    'Standard.Visualization.Table.Visualization',
    'prepare_visualization',
    rowLimit.value.toString(),
  ),
)

const numberFormatGroupped = new Intl.NumberFormat(undefined, {
  style: 'decimal',
  maximumSignificantDigits: 16,
  useGrouping: true,
})

const numberFormat = new Intl.NumberFormat(undefined, {
  style: 'decimal',
  maximumSignificantDigits: 16,
  useGrouping: false,
})

function formatNumber(params: ICellRendererParams) {
  const valueType = params.value?.type
  let value
  if (valueType === 'Integer') {
    value = BigInt(params.value?.value)
  } else if (valueType === 'Decimal') {
    value = Number(params.value?.value)
  } else {
    value = params.value
  }
  const needsGrouping = dataGroupingMap.value?.get(params.colDef?.field || '')
  return needsGrouping ? numberFormatGroupped.format(value) : numberFormat.format(value)
}

async function getFilterValues(params: SetFilterValuesFuncParams) {
  const colName = params.colDef.field
  const filters = params.api.getFilterModel()
  const columnHeaders = viewFlags.value.columnNames
  const gridFilterModelList: Array<GridFilterModel> = filters ? makeFilterModelList(filters) : []
  const { filterColumnIndexList, filterActions, valueList } = convertFilterModel(
    gridFilterModelList,
    columnHeaders,
    colTypeMap.value,
  )
  const index = columnHeaders.findIndex((h: string) => colName === h)
  const server = ssrmServer.value
  if (server) {
    const response = await server.getSetFilterValues(
      index,
      filterColumnIndexList,
      filterActions,
      valueList,
    )
    // `null` data: too many distinct values to list, so the set filter has none to offer.
    // The values go to AG Grid as the engine sent them (Booleans stay Booleans; #778).
    if (response.success && response.data != null) {
      params.success(response.data as (string | null)[])
    }
  }
}

function createServer() {
  return {
    getSetFilterValues: async (
      columnIndex: number,
      filterColumnIndexList: string[] | string,
      filterActions: string[] | string,
      valueList:
        | string
        | (
            | {
                valueType: ValueTypes
                value: string
              }
            | {
                valueType: 'Mixed'
                value: ValueTypeArgumentChild[]
              }
            | {
                valueType: ValueTypes
                value: string
              }[]
          )[],
    ) => {
      const expressionFunction = createDistinctExpressionTemplate(
        'Standard.Visualization.Table.Visualization',
        'get_distinct_values_for_column',
        `${columnIndex}`,
        //column indexes that require a filter
        filterColumnIndexList as string[] | 'Nothing',
        //column actions i.e. Greater Than, Between...
        filterActions as string[] | 'Nothing',
        //values to filter on
        valueList as string[] | 'Nothing',
      )

      try {
        // No deadline either (Note [Row Pages Wait For The Engine]): a list that timed out stayed
        // empty (#781). An answer for a table that has since been replaced is dropped.
        const version = tableVersionHash.value
        const response = await config.executeExpression(expressionFunction, null)
        if (version !== tableVersionHash.value) return { success: false, data: [] }
        // `executeExpression` resolves to `null` while the visualization subdoc is still syncing,
        // and to an `Err` when evaluation fails — neither carries a `value`. Reading it
        // unconditionally turned both into an opaque "Cannot read properties of undefined", which
        // hid whatever actually went wrong.
        if (response == null) return { success: false, data: [] }
        if (!response.ok) {
          response.error.log('Error loading filterValues for column')
          return { success: false, data: [] }
        }
        return {
          success: true,
          data: distinctValuesFromResponse(response.value),
        }
      } catch (error) {
        console.warn('Error loading filterValues for column.', error)
        return {
          success: false,
          data: [],
        }
      }
    },
    getData: async (request: RowsRequestParams) => {
      const columnHeaders = viewFlags.value.columnNames

      const { sortColIndexes, sortDirections } = convertSortModel(request, columnHeaders)
      const gridFilterModelList: Array<GridFilterModel> =
        request.filterModel ? makeFilterModelList(request.filterModel) : []
      const { filterColumnIndexList, filterActions, valueList } = convertFilterModel(
        gridFilterModelList,
        columnHeaders,
        colTypeMap.value,
      )

      const expressionFunction = createExpressionRowTemplate(
        'Standard.Visualization.Table.Visualization',
        'get_rows_for_table',
        //the index of the next bucket of rows to get
        `${request.startRow}`,
        //column indexes that require a sort
        sortColIndexes as string[] | 'Nothing',
        //direction (Ascending/Descending) for the sorts
        sortDirections as string[] | 'Nothing',
        //column indexes that require a filter
        filterColumnIndexList as string[] | 'Nothing',
        //column actions i.e Greater Than, Between...
        filterActions as string[] | 'Nothing',
        //values to filter on
        valueList as string[] | 'Nothing',
      )

      try {
        // No deadline (Note [Row Pages Wait For The Engine]), so the answer can belong to a table
        // that has since been replaced: its block is dead, and it must not set the row count.
        const version = tableVersionHash.value
        const response = await config.executeExpression(expressionFunction, null)
        if (version !== tableVersionHash.value)
          return { success: false, rows: [], rowCount: undefined }
        // See the note on the `getFilterValues` call above: `null` means "subdoc not synced yet"
        // and `Err` means the evaluation failed. Neither has a `value`, and reading one produced
        // the misleading "Cannot read properties of undefined (reading 'row_count')" that masked
        // the real failure.
        if (response == null) return { success: false, rows: [], rowCount: undefined }
        if (!response.ok) {
          response.error.log('Error loading rows for table')
          return { success: false, rows: [], rowCount: undefined }
        }
        const page = rowsFromPage(columnDefs.value, response.value)
        filteredRowCount.value = page.rowCount
        return { success: true, rows: page.rows, rowCount: page.rowCount }
      } catch (error) {
        console.warn('Error loading rows for table.', error)
        return {
          success: false,
          rows: [],
          rowCount: undefined,
        }
      }
    },
  }
}

/*
 * Note [Row Pages Wait For The Engine]
 * ====================================
 * A row page is requested with no timeout. The engine answers requests in turn, so right after a
 * project opens, or while a node evaluates, the first page can take far longer than the usual 5 s
 * (#777). A page that timed out was settled as an empty one, and AG Grid showed "No Rows To Show"
 * over a table with rows until the table changed. Asking again would not help either: the engine
 * still evaluates a request whose slot the GUI removed (a one-shot `inFrame` request is never
 * detached), so each retry would add work to an engine that is already behind. Until the page
 * comes, AG Grid shows its rows as loading.
 *
 * There is no cancellation either: a request the engine never answers (a lost language server
 * connection) stays pending, holding one slot and its observer on a visualization document that
 * is discarded with the session. The 5 s timeout was the only clean-up for that case; a grid that
 * keeps loading is the better failure than one claiming the table is empty. An answer that comes
 * after the table changed is dropped (`getData` compares `tableVersionHash`).
 *
 * A column filter's list of distinct values (`getSetFilterValues`) waits the same way: with the
 * old 2 s limit the list stayed empty when the engine was busy (#781). The filter's `success`
 * callback fills the list whenever the answer comes, and it is not called for a table that has
 * been replaced.
 */

interface Response {
  rows: Record<string, any>[]
  success: boolean
  rowCount: number | undefined
}

function createInfiniteDatasource(): IDatasource {
  return {
    getRows: async (params: IGetRowsParams) => {
      const server = ssrmServer.value
      if (server) {
        const serverResponse = await server.getData(params)
        const response: Response =
          serverResponse ? serverResponse : { rows: [], success: false, rowCount: 0 }
        if (response.success) {
          params.successCallback(response.rows, response.rowCount)
        } else {
          // The Infinite Row Model has no failed-load visual state to hook into and
          // `params.failCallback()` is a no-op here, so settle the grid to visibly empty rather
          // than leaving it spinning forever.
          params.successCallback([], 0)
        }
      }
    },
  }
}

function escapeHTML(str: string) {
  const mapping: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '"': '&quot;',
    "'": '&#39;',
    '>': '&gt;',
  }
  return str.replace(/[&<>"']/g, (m) => mapping[m]!)
}

function cellClass(params: CellClassParams) {
  if (params.colDef.field === '#') return null
  if (typeof params.value === 'number' || params.value === null) return 'ag-right-aligned-cell'
  if (typeof params.value === 'object') {
    const valueType = params.value?.type
    if (isNumericType(valueType)) return 'ag-right-aligned-cell'
  }
  return null
}

function cellRenderer(params: ICellRendererParams) {
  // Convert's the value into a display string.
  if (params.value === null) return '<span style="color:grey; font-style: italic;">Nothing</span>'
  else if (params.value === undefined) return ''
  else if (params.value === '') return '<span style="color:grey; font-style: italic;">Empty</span>'
  else if (typeof params.value === 'number') return formatNumber(params)
  else if (typeof params.value === 'string')
    return formatText(params.value, textFormatterSelected.value)
  else if (Array.isArray(params.value)) return `[Vector ${params.value.length} items]`
  else if (typeof params.value === 'object') {
    const valueType = params.value?.type
    if (valueType === 'Float')
      return `<span style="color:grey; font-style: italic;">${params.value?.value ?? 'Unknown'}</span>`
    else if (isNumericType(valueType)) return formatNumber(params)
    else if ('_display_text_' in params.value && params.value['_display_text_'])
      return String(params.value['_display_text_'])
    else return `{ ${valueType} Object }`
  } else return escapeHTML(params.value.toString())
}

watchEffect(() => {
  try {
    refresh()
  } catch (error) {
    console.warn('Error refreshing table.', error)
  }
})

// Update state computed from the input `data`.
function refresh() {
  const view = buildTableView(props.data, {
    isSSRM: isSSRM.value,
    getFilterValues,
    createNode: (pattern) => config.createNodes({ content: pattern, commit: true }),
  })
  columnDefs.value = view.columnDefs
  if (view.rowData !== undefined) rowData.value = view.rowData
  isTruncated.value = view.isTruncated
  dataGroupingMap.value = view.dataGrouping
  rowCount.value = view.rowCount
  showRowCount.value = view.showRowCount
  const newPageLimit = Math.ceil(view.rowCount / rowLimit.value)
  pageLimit.value = newPageLimit
  if (page.value > newPageLimit) {
    page.value = newPageLimit
  }

  // If data is truncated, we cannot rely on sorting/filtering so will disable.
  defaultColDef.value.filter = !isTruncated.value
  defaultColDef.value.sortable = !isTruncated.value
}

const colTypeMap = computed(() => viewFlags.value.columnTypes)

const getColumnValueToEnso = (columnName: string) => columnValueToEnso(colTypeMap.value)(columnName)

function checkSortAndFilter(e: SortChangedEvent) {
  const gridApi = e.api
  if (gridApi == null) {
    console.warn('AG Grid column API does not exist.')
    return
  }
  const colState = gridApi.getColumnState()
  const gridFilterModel = gridApi.getFilterModel()
  const sort = colState
    .map((cs) => {
      if (cs.sort) {
        return {
          columnName: cs.colId,
          sortDirection: cs.sort,
          sortIndex: cs.sortIndex,
        } as SortModel
      }
    })
    .filter((sort) => sort)
  const filter = makeFilterModelList(gridFilterModel)
  if (sort.length || filter.length) {
    sortModel.value = sort as SortModel[]
    filterModel.value = filter
  } else {
    sortModel.value = []
    filterModel.value = []
  }
}

const onColumnStateChange = (e: ColumnVisibleEvent | ColumnMovedEvent) => {
  const colState = e.api.getColumnState()
  hiddenColumns.value = colState.filter((col) => col.hide).map((col) => col.colId)
  const gridColOrder = colState
    .filter((col) => col.colId != INDEX_FIELD_NAME)
    .map((col) => col.colId)
  const defaultColOrder = viewFlags.value.columnNames
  if (gridColOrder.every((val, index) => val === defaultColOrder[index])) {
    vizColumnOrder.value = null
  } else {
    vizColumnOrder.value = gridColOrder
  }
}

const refreshGrid = () => {
  grid.value?.gridApi?.setFilterModel(null)
  grid.value?.gridApi?.resetColumnState()
}

// ===============
// === Updates ===
// ===============
onMounted(() => {
  rowLimit.value = 1000
})

// ===============
// === Toolbar ===
// ===============

const tableToolbar = useTableVizToolbar({
  textFormatterSelected,
  filterModel,
  sortModel,
  tableFilteredOrSorted: isTableFilteredOrSorted,
  actions: vizActions,
  createNodes: config.createNodes,
  getColumnValueToEnso,
  hiddenColumns,
  vizColumnOrder,
  refreshGrid,
})
config.setToolbar(
  computed(() => [
    ...tableToolbar.value,
    ...plainActionToolbar(vizActions.value, config.createNodes),
  ]),
)
</script>

<template>
  <div ref="rootNode" class="TableVisualization" @wheel.stop.passive @pointerdown.stop>
    <!-- Hidden whenever the bottom status bar is shown, which would otherwise show the row count
         twice. The bottom bar also replaces the row-limit selector. -->
    <template v-if="!bottomStatusBar">
      <div class="table-visualization-status-bar">
        <select
          v-if="isRowCountSelectorVisible"
          @change="setRowLimit(Number(($event.target as HTMLOptionElement).value))"
        >
          <option
            v-for="limit in selectableRowLimits"
            :key="limit"
            :value="limit"
            v-text="limit"
          ></option>
        </select>
        <template v-if="showRowCount">
          <span
            v-if="isRowCountSelectorVisible && isTruncated"
            v-text="` of ${rowCount} rows (Sorting/Filtering disabled).`"
          ></span>
          <span v-else-if="isRowCountSelectorVisible" v-text="' rows.'"></span>
          <span v-else-if="rowCount === 1" v-text="'1 row.'"></span>
          <span v-else v-text="`${rowCount} rows.`"></span>
        </template>
      </div>
    </template>
    <!-- TODO[ao]: Suspence in theory is not needed here (the entire visualization is inside
     suspense), but for some reason it causes reactivity loop - see https://github.com/enso-org/enso/issues/10782 -->
    <Suspense>
      <AgGridTableView
        ref="grid"
        class="scrollable grid"
        :columnDefs="columnDefs"
        :rowData="rowData"
        :defaultColDef="defaultColDef"
        :textFormatOption="textFormatterSelected"
        :datasource="datasource"
        :isServerSideModel="isSSRM"
        :gridIdHash="tableVersionHash"
        :getContextMenuItems="getContextMenuItems"
        @sortOrFilterUpdated="checkSortAndFilter"
        @columnVisibleChanged="onColumnStateChange"
        @columnMoved="onColumnStateChange"
      />
    </Suspense>
    <div v-if="bottomStatusBar" class="bottomStatusBar">
      <div><b>Total Row Count:</b> {{ bottomStatusBar.total }}</div>
      <div v-if="bottomStatusBar.showFiltered">
        <b>Filtered Row Count:</b> {{ bottomStatusBar.filtered }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.TableVisualization {
  display: flex;
  flex-flow: column;
  position: relative;
  height: 100%;
}

/* The row counts below the grid; see `bottomStatusBar`. */
.bottomStatusBar {
  flex: none;
  display: flex;
  gap: 16px;
  padding: 4px 8px;
  font-size: 11.5px;
  border-top: 1px solid rgb(0 0 0 / 0.1);
}

.grid {
  flex-grow: 1;
}

.table-visualization-status-bar {
  height: 20px;
  font-size: 14px;
  color: var(--color-ag-header-text);
  white-space: nowrap;
  padding: 0 5px;
  overflow: hidden;
}

.TableVisualization:deep(.ag-root-wrapper) {
  --ag-wrapper-border-radius: 0 0 var(--radius-default) var(--radius-default);
  border: none;
}

/* Tag selectors are inefficient to compute, and should be replaced with a class selector
 * if possible.
 * See https://vuejs.org/api/sfc-css-features.html#scoped-style-tips */
:deep(.link) {
  color: blue;
  text-decoration: underline;
}

:deep(.link):hover {
  color: darkblue;
}

.button-wrappers {
  display: flex;
  flex-direction: row;
}

.ag-header-cell .myclass {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  width: inherit;
}

:deep(.indexColumnHeader) {
  padding-left: 13px;
}
</style>
