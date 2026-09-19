import { expect, test } from 'vitest'
import {
  convertSortModel,
  type RowsRequestParams,
} from '../TableVisualization/TableVizDataSourceUtils'

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
