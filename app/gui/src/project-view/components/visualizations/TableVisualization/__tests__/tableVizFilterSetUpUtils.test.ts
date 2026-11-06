import { describe, expect, test, vi } from 'vitest'
import { CommunitySetFilter } from '../CommunitySetFilter'
import { getFilterParams, getFilterType } from '../tableVizFilterSetUpUtils'

describe('getFilterType', () => {
  test('a Char column using the multi-filter gets CommunitySetFilter', () => {
    expect(getFilterType('Char', true)).toBe(CommunitySetFilter)
  })

  test('a Char column not using the multi-filter gets agTextColumnFilter', () => {
    expect(getFilterType('Char', false)).toBe('agTextColumnFilter')
  })

  test('any other set-filter column gets CommunitySetFilter', () => {
    expect(getFilterType('Boolean', false)).toBe(CommunitySetFilter)
  })

  test('numeric and date columns get the built-in number and date filters', () => {
    expect(getFilterType('Integer', false)).toBe('agNumberColumnFilter')
    expect(getFilterType('Date', false)).toBe('agDateColumnFilter')
  })
})

describe('getFilterParams', () => {
  test('returns the plain filter params shape, reusing the values callback unchanged', () => {
    const getFilterValues = vi.fn()
    const params = getFilterParams(true, null, getFilterValues)
    expect(params).toEqual({
      maxNumConditions: 1,
      values: getFilterValues,
      filterOptions: null,
      buttons: null,
      refreshValuesOnOpen: true,
    })
  })
})
