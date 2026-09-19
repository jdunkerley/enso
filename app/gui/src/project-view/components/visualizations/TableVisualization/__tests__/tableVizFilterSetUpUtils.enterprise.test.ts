import { describe, expect, test, vi } from 'vitest'

vi.mock('@/components/shared/AgGridTableView/agGridLicense', () => ({
  AG_GRID_ENTERPRISE_AVAILABLE: true,
}))

describe('getFilterType (AG Grid Enterprise license configured — must stay unchanged)', () => {
  test('a Char column using the multi-filter still gets agMultiColumnFilter', async () => {
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Char', true)).toBe('agMultiColumnFilter')
  })

  test('any other set-filter column still gets agSetColumnFilter', async () => {
    const { getFilterType } = await import('../tableVizFilterSetUpUtils')
    expect(getFilterType('Boolean', false)).toBe('agSetColumnFilter')
  })
})
