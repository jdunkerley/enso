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

describe('AG Grid module selection (no AG Grid Enterprise license configured)', () => {
  test('registers the Community bundle, never importing ag-grid-enterprise', async () => {
    const { agGridModules } = await import('../agGridModules')

    expect(communityImported).toHaveBeenCalled()
    expect(enterpriseImported).not.toHaveBeenCalled()
    expect(agGridModules).toHaveLength(1)
  })
})

describe('AG Grid module selection (AG Grid Enterprise license configured)', () => {
  const TEST_LICENSE_KEY = 'test-license-key'

  test('registers the Enterprise bundle and the license key, never importing ag-grid-community', async () => {
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

    const { agGridModules } = await import('../agGridModules')

    expect(enterpriseImported).toHaveBeenCalled()
    expect(communityImported).not.toHaveBeenCalled()
    expect(setLicenseKeySpy).toHaveBeenCalledWith(TEST_LICENSE_KEY)
    expect(agGridModules).toHaveLength(1)
  })
})
