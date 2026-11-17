import { describe, expect, test } from 'vitest'
import {
  convertFilterModel,
  convertSortModel,
  createExpressionRowTemplate,
  type RowsRequestParams,
} from '../TableVisualization/TableVizDataSourceUtils'
import { makeFilterModelList } from '../TableVisualization/tableVizFilterUtils'

test('convertSortModel reads a Server-Side Row Model-shaped request (startRow may be undefined)', () => {
  const request: RowsRequestParams = {
    startRow: undefined,
    sortModel: [{ colId: 'b', sort: 'desc' }],
    filterModel: null,
  }
  expect(convertSortModel(request, ['a', 'b', 'c'])).toEqual({
    sortColIndexes: ['1'],
    sortDirections: ['-1'],
  })
})

test('convertSortModel reads an Infinite Row Model-shaped request (startRow always a number)', () => {
  const request: RowsRequestParams = {
    startRow: 0,
    sortModel: [{ colId: 'a', sort: 'asc' }],
    filterModel: {},
  }
  expect(convertSortModel(request, ['a', 'b', 'c'])).toEqual({
    sortColIndexes: ['0'],
    sortDirections: ['1'],
  })
})

test('convertSortModel returns "Nothing" when there is no sort', () => {
  const request: RowsRequestParams = {
    startRow: 0,
    sortModel: [],
    filterModel: null,
  }
  expect(convertSortModel(request, ['a', 'b'])).toEqual({
    sortColIndexes: 'Nothing',
    sortDirections: 'Nothing',
  })
})

describe('a set filter on a column', () => {
  /** The row-page request the filter makes, as the code a node would hold. */
  function rowsRequest(filterModel: Record<string, unknown>, columnTypes: [string, string][]) {
    const columnNames = columnTypes.map(([name]) => name)
    const { filterColumnIndexList, filterActions, valueList } = convertFilterModel(
      makeFilterModelList(filterModel),
      columnNames,
      new Map(columnTypes),
    )
    return createExpressionRowTemplate(
      'Standard.Visualization.Table.Visualization',
      'get_rows_for_table',
      '0',
      'Nothing',
      'Nothing',
      filterColumnIndexList as string[] | 'Nothing',
      filterActions as string[] | 'Nothing',
      valueList as string[] | 'Nothing',
    )('x').code()
  }

  // The engine sends a Boolean column's distinct values as JSON `true` and `false` (#778).
  test.each([
    [[true], '(..Equal True)'],
    [[false], '(..Equal False)'],
    [[true, false], '(..Is_In [True, False])'],
  ])('of Booleans %j writes Enso Booleans: %s', (values, filter) => {
    const request = rowsRequest({ flag: { filterType: 'set', values } }, [['flag', 'Boolean']])
    expect(request).toContain(`([${filter}])`)
  })

  test('of Text still writes Text', () => {
    const request = rowsRequest({ name: { filterType: 'set', values: ['a', 'b'] } }, [
      ['name', 'Char'],
    ])
    expect(request).toContain("([(..Is_In ['a', 'b'])])")
  })
})
