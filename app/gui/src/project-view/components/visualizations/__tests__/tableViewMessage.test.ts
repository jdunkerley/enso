// The messages below are the engine's table view format, whose field names are snake_case
// (`row_count`, `number_format`, …); renaming them would stop them being that format.
/* eslint-disable camelcase */
import { Ast } from '@/util/ast'
import type { CellDoubleClickedEvent } from 'ag-grid-community'
import { describe, expect, test } from 'vitest'
import {
  buildTableView,
  distinctValuesFromResponse,
  rowsFromPage,
  tableViewFlags,
  type TableViewContext,
} from '../TableVisualization/tableView'

function context(created: string[] = []): TableViewContext {
  return {
    isSSRM: false,
    getFilterValues: async () => {},
    createNode: (pattern) =>
      created.push(pattern.instantiateCopied([Ast.parseExpression('operator1')!]).code()),
  }
}

describe('The table view message', () => {
  test('an error shows in one Error cell', () => {
    const view = buildTableView(
      { kind: 'error', error: 'Error querying the database:\nboom' },
      context(),
    )
    expect(view.columnDefs.map((col) => col.field)).toEqual(['Error'])
    expect(view.rowData).toEqual([{ Error: 'Error querying the database:\nboom' }])
  })

  test('a message that fails the schema shows why', () => {
    const view = buildTableView({ kind: 'grid', columns: 'x', data: [] }, context())
    expect(view.columnDefs.map((col) => col.field)).toEqual(['Error'])
    expect(view.rowData?.[0]?.Error).toMatch(/^Invalid table visualization data: columns: /)
  })

  test('an object of another visualisation shows an empty grid', () => {
    const view = buildTableView({ a: 1 }, context())
    expect(view.columnDefs).toEqual([])
    expect(view.rowData).toEqual([])
  })

  test('a value that is not an object shows as one value', () => {
    expect(buildTableView(42, context()).rowData).toEqual([{ Value: 42 }])
  })

  test('a grid without columns shows an empty grid', () => {
    const view = buildTableView(
      { kind: 'grid', row_count: 2, columns: [], data: [[], []] },
      context(),
    )
    expect(view.columnDefs).toEqual([])
    expect(view.rowData).toEqual([])
    expect(view.rowCount).toBe(2)
    expect(
      tableViewFlags({ kind: 'grid', row_count: 2, columns: [], data: [] }).columnNames,
    ).toEqual([])
  })

  test('a missing cell is empty, unlike Nothing', () => {
    const view = buildTableView(
      {
        kind: 'grid',
        row_count: 2,
        columns: [{ name: '0' }, { name: '1' }],
        index: { action: 'at {{#index}}' },
        data: [
          [1, null],
          [2, { _missing_: true }],
        ],
      },
      context(),
    )
    expect(view.rowData?.[1]).toEqual({ '#': 1, '0': null })
    expect('1' in view.rowData![1]! && view.rowData![1]!['1'] === undefined).toBe(true)
  })

  test('{{#index}} is the row number', () => {
    const created: string[] = []
    const view = buildTableView(
      {
        kind: 'grid',
        row_count: 1,
        columns: [{ name: 'index' }],
        index: { action: 'get_row {{#index}}' },
        data: [['x']],
      },
      context(created),
    )
    view.columnDefs[0]!.onCellDoubleClicked!({
      data: view.rowData![0],
    } as CellDoubleClickedEvent)
    expect(created[0]).toMatch(/\.get_row 0$/)
  })

  test('a server page numbers its rows from its index', () => {
    const view = buildTableView(
      {
        kind: 'grid',
        row_count: 5000,
        columns: [{ name: 'x' }],
        index: { action: 'get_row {{#index}}' },
        data: null,
        server: true,
      },
      context(),
    )
    expect(view.rowData).toBeUndefined()
    const page = rowsFromPage(view.columnDefs, {
      row_count: 2,
      index: [7, 3],
      data: [['a', 'b']],
    })
    expect(page).toEqual({
      rows: [
        { '#': 7, x: 'a' },
        { '#': 3, x: 'b' },
      ],
      rowCount: 2,
    })
  })

  test('distinct values pass through, null included', () => {
    expect(distinctValuesFromResponse({ values: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(distinctValuesFromResponse({ values: null })).toBeNull()
  })

  test('the flags come from the grid', () => {
    const flags = tableViewFlags({
      kind: 'grid',
      row_count: 3,
      columns: [
        {
          name: 'x',
          value_type: { constructor: 'Integer', display_text: 'Integer' },
        },
      ],
      data: [[1, 2, 3]],
      version_hash: 'v',
      options: { status_bar: true },
    })
    expect(flags).toEqual({
      allRowCount: 3,
      versionHash: 'v',
      isSSRM: false,
      bottomStatusBarRequested: true,
      columnNames: ['x'],
      columnTypes: new Map([['x', 'Integer']]),
    })
  })
})
