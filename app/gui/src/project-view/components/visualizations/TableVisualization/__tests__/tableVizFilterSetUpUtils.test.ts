import { describe, expect, test, vi } from 'vitest'

const { AG_GRID_ENTERPRISE_AVAILABLE } = vi.hoisted(() => ({
  AG_GRID_ENTERPRISE_AVAILABLE: false,
}))
vi.mock('@/components/shared/AgGridTableView/agGridLicense', () => ({
  AG_GRID_ENTERPRISE_AVAILABLE,
}))

describe('getFilterType (no AG Grid Enterprise license configured)', () => {
  test('a Char column using the multi-filter gets CommunitySetFilter instead of agMultiColumnFilter', async () => {
    const { CommunitySetFilter } = await import('../CommunitySetFilter')
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Char', true)).toBe(CommunitySetFilter)
  })

  test('a Char column not using the multi-filter is unaffected (agTextColumnFilter is Community-native)', async () => {
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Char', false)).toBe('agTextColumnFilter')
  })

  test('any other set-filter column gets CommunitySetFilter instead of agSetColumnFilter', async () => {
    const { CommunitySetFilter } = await import('../CommunitySetFilter')
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Boolean', false)).toBe(CommunitySetFilter)
  })

  test('numeric and date columns are unaffected (their filters are Community-native)', async () => {
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Integer', false)).toBe('agNumberColumnFilter')
    expect(getFilterType('Date', false)).toBe('agDateColumnFilter')
  })
})

describe('getFilterParams with CommunitySetFilter', () => {
  test('returns the plain (non-multi) filter params shape, reusing the values callback unchanged', async () => {
    const { CommunitySetFilter } = await import('../CommunitySetFilter')
    const { getFilterParams } = await import('../tableVizFilterSetUpUtils')
    const getFilterValues = vi.fn()
    const params = getFilterParams(true, null, CommunitySetFilter, getFilterValues)
    expect(params).toEqual({
      maxNumConditions: 1,
      values: getFilterValues,
      filterOptions: null,
      buttons: null,
      refreshValuesOnOpen: true,
    })
  })
})
