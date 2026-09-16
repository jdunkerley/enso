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

describe('AgGridVue module loading (AG Grid Enterprise license configured)', () => {
  const TEST_LICENSE_KEY = 'test-license-key'

  test('resolves its AG Grid dependency from ag-grid-enterprise and registers the license key, never importing ag-grid-community', async () => {
    vi.resetModules()
    // Deterministic regardless of the real $config.AG_GRID_LICENSE_KEY in this test environment:
    // stub the flag/key module directly rather than relying on env configuration. Registered here
    // (not at describe-collection time) so it takes effect only for this test's fresh imports,
    // leaving the unlicensed-path test above unaffected.
    vi.doMock('../agGridLicense', () => ({
      AG_GRID_ENTERPRISE_AVAILABLE: true,
      AG_GRID_LICENSE_KEY: TEST_LICENSE_KEY,
    }))

    const { LicenseManager } = await import('ag-grid-enterprise')
    const setLicenseKeySpy = vi.spyOn(LicenseManager, 'setLicenseKey').mockImplementation(() => {})

    const { AgGridVue } = await import('../AgGridVue')

    expect(enterpriseImported).toHaveBeenCalled()
    expect(communityImported).not.toHaveBeenCalled()
    expect(setLicenseKeySpy).toHaveBeenCalledWith(TEST_LICENSE_KEY)
    // Sanity check that Utils.ts's getAgGridProperties() still ran and populated props.
    expect(AgGridVue.props).toHaveProperty('rowData')
    expect(AgGridVue.props).toHaveProperty('columnDefs')
  })
})
