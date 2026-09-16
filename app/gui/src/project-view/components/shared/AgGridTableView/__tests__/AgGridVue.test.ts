import { describe, expect, test, vi } from 'vitest'

const { communityImported, enterpriseImported } = vi.hoisted(() => ({
  communityImported: vi.fn(),
  enterpriseImported: vi.fn(),
}))

vi.mock('ag-grid-community', async (importOriginal) => {
  communityImported()
  return importOriginal()
})
vi.mock('ag-grid-enterprise', async (importOriginal) => {
  enterpriseImported()
  return importOriginal()
})

describe('AgGridVue module loading (no AG Grid Enterprise license configured)', () => {
  test('resolves its AG Grid dependency from ag-grid-community, never importing ag-grid-enterprise', async () => {
    const { AgGridVue } = await import('../AgGridVue')

    expect(communityImported).toHaveBeenCalled()
    expect(enterpriseImported).not.toHaveBeenCalled()
    // Sanity check that Utils.ts's getAgGridProperties() still ran and populated props.
    expect(AgGridVue.props).toHaveProperty('rowData')
    expect(AgGridVue.props).toHaveProperty('columnDefs')
  })
})
