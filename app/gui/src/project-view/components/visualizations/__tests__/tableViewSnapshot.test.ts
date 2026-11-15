import { Ast } from '@/util/ast'
import type { CellDoubleClickedEvent, ColDef, ITooltipParams } from 'ag-grid-community'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  buildTableView,
  distinctValuesFromResponse,
  rowsFromPage,
  tableViewFlags,
  type TableViewContext,
} from '../TableVisualization/tableView'

// The gate of spec B (docs/superpowers/specs/2026-11-14-table-viz-one-format-design.md, "Proof
// that views do not change"). Each pinned golden of `test/Visualization_Tests` is what the table
// visualisation's preprocessors send for one kind of value; this records what the visualisation
// makes of it. A wire-format change regenerates the goldens and must leave this snapshot as it is.
// Resolve the goldens relative to this file: vitest may run from `app/gui`.
const pinnedDir = path.resolve(
  __dirname,
  '../../../../../../../test/Visualization_Tests/data/pinned',
)

function readPinned(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(pinnedDir, `${name}.json`), 'utf-8'))
}

const viewGoldens = fs
  .readdirSync(pinnedDir)
  .filter((file) => file.startsWith('table_') && file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))
  .sort()

/** Each server row page golden, with the view golden whose columns it fills. */
const pageGoldens = [
  ['ssrm_rows', 'table_mem_table'],
  ['ssrm_rows_column', 'table_mem_column'],
  ['ssrm_rows_sorted', 'table_mem_table'],
  ['ssrm_rows_filtered', 'table_mem_table'],
] as const

const distinctGoldens = ['ssrm_distinct', 'ssrm_distinct_nothing']

/** The node the visualised value comes from; a link's pattern is applied to it. */
const SOURCE_NODE = 'operator1'

function makeContext(data: unknown, created: string[]): TableViewContext {
  return {
    isSSRM: tableViewFlags(data).isSSRM,
    getFilterValues: async () => {},
    createNode: (pattern) =>
      created.push(pattern.instantiateCopied([Ast.parseExpression(SOURCE_NODE)!]).code()),
  }
}

/**
 * A JSON picture of `value` that does not depend on key order or on function identity: object
 * keys sorted, functions shown as `[function]` (classes AG Grid instantiates by name), and the
 * icon sprite's URL dropped from header templates.
 */
function plain(value: unknown, key?: string): unknown {
  if (typeof value === 'function') {
    return key === 'filter' || key === 'tooltipComponent' ? `[class ${value.name}]` : '[function]'
  }
  if (value instanceof Map) return plain(Object.fromEntries(value))
  if (Array.isArray(value)) return value.map((item) => plain(item))
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return Object.fromEntries(keys.map((k) => [k, plain((value as Record<string, unknown>)[k], k)]))
  }
  if (typeof value === 'string') return value.replace(/xlink:href="[^"#]*#/g, 'xlink:href="#')
  return value
}

/** Each column definition, and for a link column its tooltip, its cells and the node each row creates. */
function describeColumns(
  columnDefs: ColDef[],
  rows: Record<string, any>[] | undefined,
  created: string[],
) {
  return columnDefs.map((col) => {
    const described: Record<string, unknown> = { colDef: plain(col) }
    if (col.onCellDoubleClicked) {
      const tooltip = col.tooltipValueGetter as (params: ITooltipParams) => unknown
      described.linkTooltip = tooltip({
        node: { rowPinned: null },
      } as ITooltipParams)
      described.linkCells = (rows ?? []).map((row) => col.cellRenderer({ value: row[col.field!] }))
      described.createdNodes = (rows ?? []).map((row) => {
        created.length = 0
        col.onCellDoubleClicked!({ data: row } as CellDoubleClickedEvent)
        return created[0]
      })
    }
    return described
  })
}

function viewSnapshot(name: string) {
  const data = readPinned(name)
  const created: string[] = []
  const view = buildTableView(data, makeContext(data, created))
  const flags = tableViewFlags(data)
  return {
    columns: describeColumns(view.columnDefs, view.rowData, created),
    rowData: view.rowData === undefined ? 'unchanged (server-side rows)' : plain(view.rowData),
    isTruncated: view.isTruncated ?? false,
    rowCount: view.rowCount,
    showRowCount: view.showRowCount,
    numberGrouping: Object.fromEntries(
      view.columnDefs.map((col) => [col.field, view.dataGrouping.get(col.field!) ?? false]),
    ),
    flags: plain({
      allRowCount: flags.allRowCount,
      versionHash: flags.versionHash,
      isSSRM: flags.isSSRM,
      bottomStatusBarRequested: flags.bottomStatusBarRequested,
      createNodeEnabled: flags.createNodeEnabled,
      columnNames: flags.columnNames,
      columnTypes: flags.columnTypes,
    }),
  }
}

describe('Table view of each pinned golden', () => {
  test.each(viewGoldens)('%s', (name) => {
    expect(viewSnapshot(name)).toMatchSnapshot()
  })
})

describe('Rows of each pinned server page', () => {
  test.each(pageGoldens)('%s', (page, view) => {
    const data = readPinned(view)
    const { columnDefs } = buildTableView(data, makeContext(data, []))
    expect(plain(rowsFromPage(columnDefs, readPinned(page)))).toMatchSnapshot()
  })
})

/** Each server row page, with the view golden whose link definition its rows are clicked through. */
const linkPageGoldens = [
  ['ssrm_rows', 'table_mem_server_table'],
  ['ssrm_rows_sorted', 'table_mem_server_table'],
  ['ssrm_rows_filtered', 'table_mem_server_table'],
  ['ssrm_rows_column', 'table_mem_column'],
] as const

describe('Link cells and created nodes of each pinned server page', () => {
  test.each(linkPageGoldens)('%s', (page, view) => {
    const data = readPinned(view)
    const created: string[] = []
    const { columnDefs } = buildTableView(data, makeContext(data, created))
    const { rows } = rowsFromPage(columnDefs, readPinned(page))
    expect(
      describeColumns(columnDefs, rows, created).filter((col) => 'createdNodes' in col),
    ).toMatchSnapshot()
  })
})

describe('Distinct values of each pinned response', () => {
  test.each(distinctGoldens)('%s', (name) => {
    expect(plain(distinctValuesFromResponse(readPinned(name)))).toMatchSnapshot()
  })
})
