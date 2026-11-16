/**
 * The table visualisation's view of the data `prepare_visualization` sends: the column
 * definitions and rows AG Grid receives, and the flags the component reads. Pure (the component
 * passes in what it owns), so that `__tests__/tableViewSnapshot.test.ts` can run it over the
 * pinned goldens in `test/Visualization_Tests/data/pinned`.
 */
/* eslint-disable camelcase */
// The schema spells the wire format's snake_case field names (`row_count`, `value_type`, …).
import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { svgUseHref } from '@/util/icons'
import type {
  ColDef,
  ICellRendererParams,
  ITooltipParams,
  SetFilterValuesFuncParams,
} from 'ag-grid-community'
import { z } from 'zod'
import { actionPattern, placeholderNames } from '../vizActions'
import { TableVisualisationTooltip } from './TableVisualisationTooltip'
import { getCellDataType, getFilterParams, getFilterType } from './tableVizFilterSetUpUtils'
import type { ValueType } from './tableVizUtils'

export const INDEX_FIELD_NAME = '#'

export type DataQualityMetricValue =
  | {
      name: string
      value: number
      displayType: 'Percentage' | 'Count'
    }
  | {
      name: string
      value: string
      displayType: 'Text'
    }

const linkSchema = z.object({
  action: z.string(),
  label: z.string().optional(),
})

/** A data quality metric: its value matches its type. */
const metricSchema = z.discriminatedUnion('type', [
  z.object({ name: z.string(), type: z.literal('Text'), value: z.string().nullable() }),
  z.object({
    name: z.string(),
    type: z.enum(['Count', 'Percentage']),
    value: z.number().nullable(),
  }),
])

const columnSchema = z.object({
  name: z.string(),
  value_type: z.object({ constructor: z.string(), display_text: z.string() }).optional(),
  link: linkSchema.optional(),
  metrics: z.array(metricSchema).optional(),
  multi_filter: z.boolean().optional(),
  number_format: z.boolean().optional(),
})

const gridSchema = z.object({
  kind: z.literal('grid'),
  row_count: z.number().optional(),
  columns: z.array(columnSchema),
  index: linkSchema.optional(),
  data: z.array(z.array(z.unknown())).nullable(),
  version_hash: z.string().optional(),
  server: z.boolean().optional(),
  options: z
    .object({
      status_bar: z.boolean().optional(),
      disable_sort_when_partial: z.boolean().optional(),
    })
    .optional(),
})

/** The table view message (`Standard.Visualization.Internal.View_Json`). */
const viewMessageSchema = z.discriminatedUnion('kind', [
  gridSchema,
  z.object({ kind: z.literal('value'), value: z.unknown() }),
  z.object({ kind: z.literal('error'), error: z.string() }),
])

/** A server-side page (`get_rows_for_table`). */
const rowsPageSchema = z.object({
  row_count: z.number(),
  index: z.array(z.unknown()),
  data: z.array(z.array(z.unknown())),
})

/** A column's distinct values (`get_distinct_values_for_column`). */
const distinctValuesSchema = z.object({
  values: z.array(z.unknown()).nullable(),
})

type ViewMessage = z.infer<typeof viewMessageSchema>
type GridMessage = z.infer<typeof gridSchema>
type ViewColumn = z.infer<typeof columnSchema>

/** What `buildTableView` needs from the component. */
export interface TableViewContext {
  /** Whether the server sorts, filters and pages the rows. */
  isSSRM: boolean
  /** Fetches a set filter's values from the server. */
  getFilterValues: (params: SetFilterValuesFuncParams<any, string>) => Promise<void>
  /** Creates a node from a link's pattern; the pattern is applied to the visualised node. */
  createNode: (pattern: Pattern<Ast.Expression>) => void
}

/** What a refresh gives AG Grid and the status bar. */
export interface TableView {
  columnDefs: ColDef[]
  /** `undefined`: the server pages the rows. */
  rowData: Record<string, any>[] | undefined
  isTruncated: boolean
  /** Per column: whether its numbers group their digits. */
  dataGrouping: Map<string, boolean>
  rowCount: number
  showRowCount: boolean
}

/** What the component reads from the data outside a refresh. */
export interface TableViewFlags {
  allRowCount: number | undefined
  versionHash: string | null
  isSSRM: boolean
  bottomStatusBarRequested: boolean
  /** The column names that server-side requests index into. */
  columnNames: string[]
  /** Column name to its value type's constructor, for the filters. */
  columnTypes: Map<string, string>
}

const parsedMessages = new WeakMap<object, ViewMessage | undefined>()

/**
 * The message `data` holds. A value that is not an object is shown as one value. An object
 * without a `kind` is another visualisation's data, received briefly while the visualisation is
 * switched: `undefined`, an empty grid. A message that fails the schema becomes an error saying
 * why. Parsed once per object (the flags and the refresh both ask).
 */
function parseViewMessage(data: unknown): ViewMessage | undefined {
  if (typeof data !== 'object' || data === null) return { kind: 'value', value: data }
  if (parsedMessages.has(data)) return parsedMessages.get(data)
  let message: ViewMessage | undefined = undefined
  if ('kind' in data) {
    const parsed = viewMessageSchema.safeParse(data)
    message =
      parsed.success ?
        parsed.data
      : {
          kind: 'error',
          error: `Invalid table visualization data: ${describeIssues(parsed.error)}`,
        }
  }
  parsedMessages.set(data, message)
  return message
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(message)'}: ${issue.message}`)
    .join('; ')
}

export const getSvgTemplate = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16"><use xlink:href="${svgUseHref(icon)}"/></svg>`

function getValueTypeIcon(valueType: string) {
  switch (valueType) {
    case 'Char':
      return 'text_char'
    case 'Boolean':
      return 'check'
    case 'Integer':
    case 'Float':
    case 'Decimal':
    case 'Byte':
      return 'math'
    case 'Date':
    case 'Date_Time':
      return 'calendar'
    case 'Time':
      return 'time'
    case 'Mixed':
      return 'mixed'
  }
}

interface FieldOptions {
  valueType?: ValueType | undefined
  metrics?: ViewColumn['metrics']
  multiFilter?: boolean | undefined
  total: number | undefined
}

/**
 * Generates the column definition for the table vizulization, including displaying the data value type and
 * data quality indicators.
 * @param name - The name which will be displayed in the table header and used to idenfiy the column.
 * @param [options.valueType] - The data type of the column, displayed as an icon
 * and in text within the tooltip. If absent the value type icon and text will not be shown.
 * @param [options.metrics] - The column's data quality metrics, shown in the tooltip.
 */
function toField(name: string, options: FieldOptions, ctx: TableViewContext): ColDef {
  const { valueType, metrics, multiFilter = false, total } = options

  const displayValue = valueType ? valueType.display_text : null
  const icon = valueType ? getValueTypeIcon(valueType.constructor) : null
  const cellValueType = valueType ? getCellDataType(valueType.constructor) : false

  const filterType = valueType ? getFilterType(valueType.constructor, multiFilter) : null

  const filterParams = getFilterParams(ctx.isSSRM, valueType, ctx.getFilterValues)

  const dataQualityMetrics = (metrics ?? []).flatMap((metric): DataQualityMetricValue[] => {
    if (metric.value === null) return []
    const result: DataQualityMetricValue =
      metric.type === 'Text' ?
        { name: metric.name, value: metric.value || '', displayType: 'Text' }
      : { name: metric.name, displayType: metric.type, value: metric.value || 0 }
    return result.displayType === 'Percentage' && result.value === 0 ? [] : [result]
  })

  const hasDataQualityMetrics = dataQualityMetrics.length > 0
  const showDataQuality =
    dataQualityMetrics.filter((obj) => obj.displayType === 'Percentage').length > 0

  const svgTemplateWarning = showDataQuality ? getSvgTemplate('warning') : ''
  const menu = `<span data-ref="eMenu" class="ag-header-icon ag-header-cell-menu-button"> </span>`
  const filterButton = `<span data-ref="eFilterButton" class="ag-header-icon ag-header-cell-filter-button" aria-hidden="true"></span>`
  const sort = `
      <span data-ref="eFilter" class="ag-header-icon ag-header-label-icon ag-filter-icon" aria-hidden="true"></span>
      <span data-ref="eSortOrder" class="ag-header-icon ag-sort-order" aria-hidden="true"></span>
      <span data-ref="eSortAsc" class="ag-header-icon ag-sort-ascending-icon" aria-hidden="true"></span>
      <span data-ref="eSortDesc" class="ag-header-icon ag-sort-descending-icon" aria-hidden="true"></span>
      <span data-ref="eSortNone" class="ag-header-icon ag-sort-none-icon" aria-hidden="true"></span>
    `

  const styles = 'display:flex; flex-direction:row; justify-content:space-between; width:inherit;'
  const template =
    icon ?
      `<span style='${styles}'><span data-ref="eLabel" class="ag-header-cell-label" role="presentation" style='${styles}'><span data-ref="eText" class="ag-header-cell-text"></span></span>${menu} ${filterButton} ${sort} ${getSvgTemplate(icon)} ${svgTemplateWarning}</span>`
    : `<span style='${styles}' data-ref="eLabel"><span data-ref="eText" class="ag-header-cell-label"></span> ${menu} ${filterButton} ${sort} ${svgTemplateWarning}</span>`

  const colDef = {
    field: name,
    headerName: name, // AGGrid would demangle it its own way if not specified.
    filter: filterType,
    filterParams: filterParams,
    headerComponentParams: {
      template,
      setAriaSort: () => {},
    },
    tooltipComponent: TableVisualisationTooltip,
    headerTooltip: displayValue ? displayValue : '',
    tooltipComponentParams: {
      dataQualityMetrics,
      total,
      showDataQuality: hasDataQualityMetrics,
    },
    cellDataType: cellValueType,

    sortable: valueType?.constructor !== 'Mixed',
  }
  if (valueType && ['Date', 'Date_Time', 'Time'].includes(valueType.constructor)) {
    return {
      ...colDef,
      comparator: (valueA, valueB) => {
        const textA =
          valueA && typeof valueA === 'object' && '_display_text_' in valueA ?
            valueA['_display_text_']
          : valueA
        const textB =
          valueB && typeof valueB === 'object' && '_display_text_' in valueB ?
            valueB['_display_text_']
          : valueB

        if (textA == null && textB == null) return 0
        if (textA == null) return 1
        if (textB == null) return -1

        return textA.toString().localeCompare(textB.toString())
      },
    }
  }
  return colDef
}

/**
 * The node a link creates from a row: its template filled from the row, `{{#index}}` from the row
 * number. A link is the view's own `chain` action (Enso writes it beside the columns it reads).
 */
function linkPattern(row: Record<string, unknown>, template: string) {
  const values = Object.fromEntries(
    placeholderNames(template).map((name) => [
      name,
      (name === 'index' ? row[INDEX_FIELD_NAME] : row[name]) as string | number | null | undefined,
    ]),
  )
  return actionPattern({ kind: 'chain', template }, values)
}

interface LinkFieldOptions {
  tooltipValue?: string | undefined
  headerName?: string | undefined
  getChildAction: string
}

function toLinkField(fieldName: string, options: LinkFieldOptions, ctx: TableViewContext): ColDef {
  const { tooltipValue, headerName, getChildAction } = options
  return {
    headerName: headerName ? headerName : fieldName,
    field: fieldName,
    onCellDoubleClicked: (params) => {
      const pattern = linkPattern(params.data, getChildAction)
      if (pattern) ctx.createNode(pattern)
    },
    tooltipValueGetter: (params: ITooltipParams) =>
      params.node?.rowPinned === 'top' ?
        null
      : `Double click to view this ${tooltipValue ?? 'value'} in a separate component`,
    cellRenderer: (params: ICellRendererParams) =>
      params.value !== null && params.value !== undefined ?
        `<div class='link'> ${params.value} </div>`
      : null,
    cellStyle: { 'padding-left': '13px', 'border-right': '1px solid #C0C0C0' },
    headerClass: 'indexColumnHeader',
    filter: fieldName != INDEX_FIELD_NAME,
  }
}

function isMissing(cell: unknown): boolean {
  return typeof cell === 'object' && cell !== null && '_missing_' in cell && cell._missing_ === true
}

/**
 * Rows from column-major `data`, one array per column after the index column. The index column
 * holds `index[i]` when given (a server page), else the row number. A missing cell becomes
 * `undefined` (an empty cell).
 */
function createRows(
  columnDefs: ColDef[],
  data: unknown[][],
  index?: readonly unknown[],
): Record<string, any>[] {
  const rows = index ? index.length : (data[0]?.length ?? 0)
  const shift = columnDefs[0]?.field === INDEX_FIELD_NAME ? 1 : 0
  return Array.from({ length: rows }, (_, i) =>
    Object.fromEntries(
      columnDefs.map((col, j) => {
        if (col.field === INDEX_FIELD_NAME) return [col.field, index ? index[i] : i]
        const cell = data[j - shift]?.[i]
        return [col.field, isMissing(cell) ? undefined : cell]
      }),
    ),
  )
}

/** Whether a column's values call for digit grouping (beyond ±999999). */
function needsGrouping(rows: Record<string, any>[], field: string): boolean {
  return rows.some((row) => {
    const value = row[field] && typeof row[field] === 'object' ? row[field].value : row[field]
    return value > 999999 || value < -999999
  })
}

function buildGrid(message: GridMessage, ctx: TableViewContext): TableView {
  const total = message.row_count
  const columnDefs: ColDef[] = []
  if (message.index) {
    columnDefs.push(
      toLinkField(
        INDEX_FIELD_NAME,
        { tooltipValue: message.index.label, getChildAction: message.index.action },
        ctx,
      ),
    )
  }
  for (const column of message.columns) {
    columnDefs.push(
      column.link ?
        toLinkField(
          column.name,
          { tooltipValue: column.link.label, getChildAction: column.link.action },
          ctx,
        )
      : toField(
          column.name,
          {
            valueType: column.value_type,
            metrics: column.metrics,
            multiFilter: column.multi_filter,
            total,
          },
          ctx,
        ),
    )
  }
  const rowData = message.data == null ? undefined : createRows(columnDefs, message.data)
  const rowsSent = message.data?.[0]?.length ?? 0
  const dataGrouping = new Map<string, boolean>()
  if (message.index) dataGrouping.set(INDEX_FIELD_NAME, false)
  for (const column of message.columns) {
    dataGrouping.set(column.name, column.number_format ?? needsGrouping(rowData ?? [], column.name))
  }
  return {
    columnDefs,
    rowData,
    isTruncated:
      message.options?.disable_sort_when_partial === true &&
      message.data != null &&
      total != null &&
      total !== rowsSent,
    dataGrouping,
    rowCount: total ?? 1,
    showRowCount: total != null,
  }
}

/** The view of `data`, the message `prepare_visualization` sent. */
export function buildTableView(data: unknown, ctx: TableViewContext): TableView {
  const message = parseViewMessage(data)
  if (message === undefined) {
    return {
      columnDefs: [],
      rowData: [],
      isTruncated: false,
      dataGrouping: new Map(),
      rowCount: 1,
      showRowCount: false,
    }
  }
  switch (message.kind) {
    case 'error':
      return {
        columnDefs: [{ field: 'Error', cellStyle: { 'white-space': 'normal' } }],
        rowData: [{ Error: message.error }],
        isTruncated: false,
        dataGrouping: new Map([['Error', false]]),
        rowCount: 1,
        showRowCount: false,
      }
    case 'value':
      return {
        columnDefs: [toField('Value', { total: undefined }, ctx)],
        rowData: [{ Value: message.value }],
        isTruncated: false,
        dataGrouping: new Map([['Value', false]]),
        rowCount: 1,
        showRowCount: false,
      }
    case 'grid':
      return buildGrid(message, ctx)
  }
}

/** What the component reads from `data` outside a refresh. */
export function tableViewFlags(data: unknown): TableViewFlags {
  const message = parseViewMessage(data)
  if (message?.kind !== 'grid') {
    return {
      allRowCount: 0,
      versionHash: null,
      isSSRM: false,
      bottomStatusBarRequested: false,
      columnNames: [],
      columnTypes: new Map(),
    }
  }
  return {
    allRowCount: message.row_count ?? 0,
    versionHash: message.version_hash ?? null,
    isSSRM: message.server === true,
    bottomStatusBarRequested: message.options?.status_bar === true,
    columnNames: message.columns.map((column) => column.name),
    columnTypes: new Map<string, string>(
      message.columns.flatMap((column) =>
        column.value_type ? [[column.name, column.value_type.constructor] as const] : [],
      ),
    ),
  }
}

/** The rows of a server-side page, for the view's `columnDefs`. Throws when it is malformed. */
export function rowsFromPage(
  columnDefs: ColDef[],
  page: unknown,
): { rows: Record<string, any>[]; rowCount: number } {
  const parsed = rowsPageSchema.parse(page)
  return {
    rows: createRows(columnDefs, parsed.data, parsed.index),
    rowCount: parsed.row_count,
  }
}

/** A column's distinct values, for its set filter; `null` when there are too many to list. */
export function distinctValuesFromResponse(response: unknown): unknown[] | null {
  return distinctValuesSchema.parse(response).values
}
