/**
 * The table visualisation's view of the data `prepare_visualization` sends: the column
 * definitions and rows AG Grid receives, and the flags the component reads. Pure (the component
 * passes in what it owns), so that `__tests__/tableViewSnapshot.test.ts` can run it over the
 * pinned goldens in `test/Visualization_Tests/data/pinned`.
 */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { svgUseHref } from '@/util/icons'
import type {
  CellDoubleClickedEvent,
  ColDef,
  ICellRendererParams,
  ITooltipParams,
  SetFilterValuesFuncParams,
} from 'ag-grid-community'
import { TableVisualisationTooltip } from './TableVisualisationTooltip'
import { isError, isGenericGrid, type Error, type GenericGrid } from './TableVisualisationTypes'
import { getCellDataType, getFilterParams, getFilterType } from './tableVizFilterSetUpUtils'
import type { ValueType } from './tableVizUtils'

export const INDEX_FIELD_NAME = '#'

export type Data = number | string | Error | Matrix | ObjectMatrix | EnsoTableOrColumn | GenericGrid

interface Matrix {
  type: 'Matrix'
  column_count: number
  all_rows_count: number
  json: unknown[][]
  value_type: ValueType[]
  get_child_node_action: string
  child_label: string
  visualization_header: string
}

interface ObjectMatrix {
  type: 'Object_Matrix'
  column_count: number
  all_rows_count: number
  json: object[]
  value_type: ValueType[]
  get_child_node_action: string
  child_label: string
  visualization_header: string
}

interface EnsoTableOrColumn {
  type: 'EnsoTableOrColumn'
  json: unknown
  all_rows_count?: number
  header: string[] | undefined
  data: unknown[][] | undefined
  value_type: ValueType[]
  has_index_col: boolean | undefined
  links: string[] | undefined
  get_child_node_action: string
  get_child_node_link_name: string
  child_label: string
  visualization_header: string
  data_quality_metrics?: DataQualityMetric[]
  is_using_server_sort_and_filter: boolean
  use_bottom_status_bar: boolean
  enable_create_node: boolean
  requires_number_format: boolean[]
  is_using_multi_filter: boolean[]
  table_version_hash?: string
}

type DataQualityMetricNumber = {
  name: string
  values: (number | null)[]
  type: 'Percentage' | 'Count'
}

type DataQualityMetricText = {
  name: string
  values: (string | null)[]
  type: 'Text'
}

type DataQualityMetric = DataQualityMetricNumber | DataQualityMetricText

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

/** What `buildTableView` needs from the component. */
export interface TableViewContext {
  /** Whether the server sorts, filters and pages the rows. */
  isSSRM: boolean
  /** Fetches a set filter's values from the server. */
  getFilterValues: (params: SetFilterValuesFuncParams<any, string>) => Promise<void>
  /** Creates a node from a link's pattern; the pattern is applied to the visualised node. */
  createNode: (pattern: Pattern<Ast.Expression>) => void
  /** The rows of the previous refresh: a server-side view keeps them. */
  previousRowData: Record<string, any>[]
  /** The data the component was created with: what a value that is not a JSON object shows. */
  initialData: unknown
}

/** What a refresh gives AG Grid and the status bar. */
export interface TableView {
  columnDefs: ColDef[]
  /** `undefined`: keep the previous rows (the server-side row model). */
  rowData: Record<string, any>[] | undefined
  /** `undefined`: keep the previous value. */
  isTruncated: boolean | undefined
  /** Per column: whether its numbers group their digits. */
  dataGrouping: Map<string, boolean>
  rowCount: number
  showRowCount: boolean
}

/** What the component reads from the data outside a refresh. */
export interface TableViewFlags {
  allRowCount: number | undefined
  versionHash: string | null | undefined
  isSSRM: boolean
  bottomStatusBarRequested: boolean
  createNodeEnabled: boolean
  /** The column names that server-side requests index into. */
  columnNames: string[]
  /** Column name to its value type's constructor, for the filters. */
  columnTypes: Map<string, string>
}

export const getSvgTemplate = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16"><use xlink:href="${svgUseHref(icon)}"/></svg>`

function addRowIndex(data: object[]): object[] {
  return data.map((row, i) => ({ [INDEX_FIELD_NAME]: i, ...row }))
}

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

/**
 * Generates the column definition for the table vizulization, including displaying the data value type and
 * data quality indicators.
 * @param name - The name which will be displayed in the table header and used to idenfiy the column.
 * @param [options.index] - The index of column the corresponds to the data in the `dataQuality` arrays
 * (`number_of_nothing` and `number_of_whitespace`). This identifies the correct indicators for each column
 * to be displayed in the toolip. If absent the data quality metrics will not be shown.
 * @param [options.valueType] - The data type of the column, displayed as an icon
 * and in text within the tooltip. If absent the value type icon and text will not be shown.
 */
function toField(
  name: string,
  options: { index?: number; valueType?: ValueType | null | undefined } = {},
  data: Data,
  ctx: TableViewContext,
): ColDef {
  const { index, valueType } = options

  const displayValue = valueType ? valueType.display_text : null
  const icon = valueType ? getValueTypeIcon(valueType.constructor) : null
  const cellValueType = valueType ? getCellDataType(valueType.constructor) : false

  const usingMultiFilterLists =
    typeof data === 'object' && 'is_using_multi_filter' in data ? data.is_using_multi_filter : []
  const isUsingMultiFilter = usingMultiFilterLists[index!] ?? false

  const filterType = valueType ? getFilterType(valueType.constructor, isUsingMultiFilter) : null

  const filterParams = getFilterParams(ctx.isSSRM, valueType, ctx.getFilterValues)

  const dataQualityMetrics =
    typeof data === 'object' && 'data_quality_metrics' in data ?
      data.data_quality_metrics
        .map((metric: DataQualityMetric) => {
          const result: DataQualityMetricValue =
            metric.type === 'Text' ?
              { name: metric.name, value: metric.values[index!] || '', displayType: 'Text' }
            : { name: metric.name, displayType: metric.type, value: metric.values[index!] || 0 }
          return (
              metric.values[index!] === null ||
                (result.displayType === 'Percentage' && result.value === 0)
            ) ?
              null
            : result
        })
        .filter((obj) => obj !== null)
    : []

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
      total: typeof data === 'object' ? data.all_rows_count : 0,
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

type ParsedActionTemplate = {
  pattern: string
  selectors: { name: string; numeric: boolean }[]
}

function parseActionTemplate(input: string, defaultSelector: string): ParsedActionTemplate {
  const regex = /{{([#@]?)(\w+)}}/g
  const selectors: { name: string; numeric: boolean }[] = []
  let pattern = input

  pattern = pattern.replace(regex, (_, flag, key) => {
    selectors.push({ name: key, numeric: flag === '#' })
    return '__'
  })

  pattern = '__.' + pattern

  // template didn't contain any {{}} placeholders so add a single default argument
  if (selectors.length === 0) {
    selectors.push({ name: defaultSelector, numeric: false })
    pattern = pattern + ' __'
  }

  return { pattern, selectors }
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value)
}

function getAstPattern(params: CellDoubleClickedEvent, action: string, defaultSelector: string) {
  const parsedAction = parseActionTemplate(action, defaultSelector)

  return Pattern.new<Ast.Expression>((ast) => {
    const mappedExpressions = parsedAction.selectors.map(({ name, numeric }) => {
      const value = params.data[name]
      const castedValue = numeric && !isNaN(Number(value)) ? Number(value) : value
      return isNumber(castedValue) ?
          Ast.tryNumberToEnso(castedValue, ast.module)!
        : Ast.TextLiteral.new(castedValue, ast.module)
    })

    const templatePattern = Pattern.parseExpression(parsedAction.pattern)
    return templatePattern.instantiateCopied([ast, ...mappedExpressions])
  })
}

/**
 * Creates a new node in the graph based on the given action template and data from a grid row.
 *
 * The action string should be of the format `at {{#fieldname}}` which will generate a Node `at 2`
 * or `at {{\@fieldname}}` which will generate a Node `at "2"`
 * If the action contains no placeholders then the defaultSelector is used like so
 * `action {{\@defaultSelector}}`
 * @param params - The grid cell event containing the clicked row's data.
 * @param defaultSelector - A fallback key used when the template contains no placeholders.
 * @param action - A template string with placeholders (e.g., `at {{\@name}}`, `at {{#value}}`) used to generate the AST.
 * @param ctx - The component's context, which creates the node.
 */
function createNode(
  params: CellDoubleClickedEvent,
  defaultSelector: string,
  action: string,
  ctx: TableViewContext,
) {
  const pattern = getAstPattern(params, action, defaultSelector)
  if (pattern) ctx.createNode(pattern)
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
    onCellDoubleClicked: (params) => createNode(params, fieldName, getChildAction, ctx),
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

/** What a value that is not a JSON object shows: the value itself, in one cell. */
function defaultData(value: unknown) {
  return {
    type: typeof value,
    json: value,
    // eslint-disable-next-line camelcase
    all_rows_count: 1,
    data: undefined,
    header: undefined,
    // eslint-disable-next-line camelcase
    value_type: undefined,
    // eslint-disable-next-line camelcase
    has_index_col: false,
    links: undefined,
    // eslint-disable-next-line camelcase
    get_child_node_action: '',
    // eslint-disable-next-line camelcase
    get_child_node_link_name: undefined,
    // eslint-disable-next-line camelcase
    child_label: undefined,
    // eslint-disable-next-line camelcase
    visualization_header: undefined,
    // eslint-disable-next-line camelcase
    is_using_server_sort_and_filter: undefined,
    // eslint-disable-next-line camelcase
    requires_number_format: undefined,
  }
}

/** Rows from column-major `data`; the index column holds the row number (or, for a server page, `data[0]`). */
export function createRowsForTable(
  columnDefs: ColDef[],
  data: unknown[][],
  shift: number,
  isSSrm: boolean,
) {
  const rows = data && data.length > 0 ? (data[0]?.length ?? 0) : 0
  const getIndexInfo = (i: number) => {
    return isSSrm ? data?.[0]?.[i] : i
  }
  return Array.from({ length: rows }, (_, i) => {
    return Object.fromEntries(
      columnDefs.map((h, j) => {
        return [h.field, h.field === INDEX_FIELD_NAME ? getIndexInfo(i) : data?.[j - shift]?.[i]]
      }),
    )
  })
}

/** The view of `value`, the data `prepare_visualization` sent. */
export function buildTableView(value: unknown, ctx: TableViewContext): TableView {
  const data = value as Data
  // If the user switches from one visualization type to another, we can receive the raw object.
  const data_ = typeof data === 'object' ? data : defaultData(ctx.initialData)
  let columnDefs: ColDef[] = []
  let rowData: Record<string, any>[] | undefined = undefined
  let isTruncated: boolean | undefined = undefined
  if (isError(data_)) {
    columnDefs = [
      {
        field: 'Error',
        cellStyle: { 'white-space': 'normal' },
      },
    ]
    rowData = [{ Error: data_.error }]
  } else if (data_.type === 'Matrix') {
    columnDefs = [
      toLinkField(
        INDEX_FIELD_NAME,
        {
          tooltipValue: data_.child_label,
          headerName: data_.visualization_header,
          getChildAction: data_.get_child_node_action,
        },
        ctx,
      ),
    ]
    for (let i = 0; i < data_.column_count; i++) {
      columnDefs.push(toField(i.toString(), {}, data, ctx))
    }
    rowData = addRowIndex(data_.json)
    isTruncated = data_.all_rows_count !== data_.json.length
  } else if (data_.type === 'Object_Matrix') {
    columnDefs = [
      toLinkField(
        INDEX_FIELD_NAME,
        {
          tooltipValue: data_.child_label,
          headerName: data_.visualization_header,
          getChildAction: data_.get_child_node_action,
        },
        ctx,
      ),
    ]
    const keys = new Set<string>()
    for (const val of data_.json) {
      if (val != null) {
        Object.keys(val).forEach((k) => {
          if (!keys.has(k)) {
            keys.add(k)
            columnDefs.push(toField(k, {}, data, ctx))
          }
        })
      }
    }
    rowData = addRowIndex(data_.json)
    isTruncated = data_.all_rows_count !== data_.json.length
  } else if (isGenericGrid(data_)) {
    columnDefs = data_.headers.map((header) => {
      if (header.get_child_node_action) {
        return toLinkField(
          header.visualization_header,
          {
            tooltipValue: header.child_label,
            headerName: header.visualization_header,
            getChildAction: header.get_child_node_action,
          },
          ctx,
        )
      } else {
        return toField(header.visualization_header, {}, data, ctx)
      }
    })
    rowData = createRowsForTable(columnDefs, data_.data, 0, false)
  } else if (Array.isArray(data_.json)) {
    columnDefs = [
      toLinkField(
        INDEX_FIELD_NAME,
        {
          tooltipValue: data_.child_label,
          headerName: data_.visualization_header,
          getChildAction: data_.get_child_node_action,
        },
        ctx,
      ),
      toField('Value', {}, data, ctx),
    ]
    rowData = data_.json.map((row, i) => ({ [INDEX_FIELD_NAME]: i, Value: row }))
    isTruncated = data_.all_rows_count ? data_.all_rows_count !== data_.json.length : false
  } else if (data_.json !== undefined) {
    // single values like Integer or Text
    columnDefs = [toField('Value', {}, data, ctx)]
    rowData = [{ Value: data_.json }]
  } else {
    const dataHeader =
      ('header' in data_ ? data_.header : [])?.map((v, i) => {
        const valueType = data_.value_type ? data_.value_type[i] : null
        if (data_.get_child_node_link_name === v) {
          return toLinkField(
            v,
            {
              tooltipValue: data_.child_label,
              headerName: data_.visualization_header,
              getChildAction: data_.get_child_node_action,
            },
            ctx,
          )
        }
        return toField(v, { index: i, valueType }, data, ctx)
      }) ?? []

    columnDefs =
      data_.has_index_col ?
        [
          toLinkField(
            INDEX_FIELD_NAME,
            {
              tooltipValue: data_.child_label,
              headerName: data_.visualization_header,
              getChildAction: data_.get_child_node_action,
            },
            ctx,
          ),
          ...dataHeader,
        ]
      : dataHeader

    if (!data_.is_using_server_sort_and_filter) {
      const shift = data_.type === 'EnsoTableOrColumn' ? 1 : 0
      rowData = data_.data ? createRowsForTable(columnDefs, data_.data, shift, false) : []
    }
  }
  const rows = rowData ?? ctx.previousRowData
  const headerGroupingMap = new Map()

  const determineGrouping = (header: string) =>
    rows.some((row) => {
      const value = row[header] && typeof row[header] === 'object' ? row[header].value : row[header]
      return value > 999999 || value < -999999
    })

  if ('header' in data_) {
    const headers = data_.header || []

    if (data_.requires_number_format) {
      columnDefs.forEach((col) => {
        const colHeader = col.headerName
        if (colHeader === INDEX_FIELD_NAME) {
          headerGroupingMap.set(INDEX_FIELD_NAME, false)
        }

        if (typeof data === 'object' && 'header' in data) {
          const dataHeaderIndex = data.header?.indexOf(colHeader ?? '')
          const needsGrouping =
            dataHeaderIndex !== -1 ? data_.requires_number_format[dataHeaderIndex!] : false
          headerGroupingMap.set(colHeader, needsGrouping)
        }
      })
    } else {
      headers.forEach((header) => headerGroupingMap.set(header, determineGrouping(header)))
    }
  } else {
    const headers = rows[0] ? Object.keys(rows[0]) : []
    Object.keys(headers).forEach((header) =>
      headerGroupingMap.set(header, determineGrouping(header)),
    )
  }

  const rowCount = data_.all_rows_count == null ? 1 : data_.all_rows_count
  return {
    columnDefs,
    rowData,
    isTruncated,
    dataGrouping: headerGroupingMap,
    rowCount,
    showRowCount: !(data_.all_rows_count == null),
  }
}

function columnTypes(data: Data): Map<string, string> {
  const colMap: Map<string, string> = new Map()
  if (typeof data === 'object' && !('error' in data)) {
    const valueTypes = 'value_type' in data ? data.value_type : []
    const headers = 'header' in data ? data.header : []
    headers?.forEach((header, index) => {
      if (valueTypes[index]) {
        colMap.set(header, valueTypes[index].constructor)
      }
    })
  }
  return colMap
}

/** What the component reads from `value` outside a refresh. */
export function tableViewFlags(value: unknown): TableViewFlags {
  const data = value as Data
  const isObject = typeof data === 'object'
  return {
    allRowCount: isObject && 'all_rows_count' in data ? data.all_rows_count : 0,
    versionHash: isObject && 'table_version_hash' in data ? data.table_version_hash : null,
    isSSRM: Boolean(
      isObject && 'is_using_server_sort_and_filter' in data && data.is_using_server_sort_and_filter,
    ),
    bottomStatusBarRequested:
      isObject && 'use_bottom_status_bar' in data && Boolean(data.use_bottom_status_bar),
    createNodeEnabled: Boolean(isObject && 'enable_create_node' in data && data.enable_create_node),
    columnNames: isObject && 'header' in data ? (data.header ?? []) : [],
    columnTypes: columnTypes(data),
  }
}

/** The rows of a server-side page (`get_rows_for_table`), for the view's `columnDefs`. */
export function rowsFromPage(
  columnDefs: ColDef[],
  page: unknown,
): { rows: Record<string, any>[]; rowCount: number } {
  const value = page as { rows: unknown[][]; row_count: number }
  return {
    rows: createRowsForTable(columnDefs, value.rows, 0, true),
    rowCount: value.row_count,
  }
}

/** A column's distinct values (`get_distinct_values_for_column`), for its set filter. */
export function distinctValuesFromResponse(response: unknown): any {
  return (response as { distinct_vals: unknown }).distinct_vals
}
