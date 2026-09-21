/**
 * @file Chooses which AG Grid modules this app registers, and registers the Enterprise licence
 * key when there is one.
 *
 * AG Grid v33 replaced the old "import the package and it registers itself" model with explicit
 * module registration, which is what lets the Community fallback be expressed directly: the
 * licensed and unlicensed paths differ only in which module bundle they hand to the grid, so
 * `ag-grid-enterprise` is never imported without a key — see {@link AG_GRID_ENTERPRISE_AVAILABLE}
 * for why merely importing it is the thing to avoid.
 *
 * Registration is per-grid (the `modules` prop) rather than global, so nothing here leaks into
 * other grids or into tests that mount their own.
 */

import type { Module } from 'ag-grid-community'
import { AG_GRID_ENTERPRISE_AVAILABLE, AG_GRID_LICENSE_KEY } from './agGridLicense'

/**
 * The module bundle for this app: everything Enterprise offers when a licence key is configured,
 * everything Community offers otherwise.
 */
export const agGridModules: Module[] = await (async (): Promise<Module[]> => {
  if (AG_GRID_ENTERPRISE_AVAILABLE && AG_GRID_LICENSE_KEY != null) {
    const { AllEnterpriseModule, LicenseManager } = await import('ag-grid-enterprise')
    LicenseManager.setLicenseKey(AG_GRID_LICENSE_KEY)
    return [AllEnterpriseModule]
  }
  console.warn('The AG_GRID_LICENSE_KEY is not defined; using AG Grid Community.')
  const { AllCommunityModule } = await import('ag-grid-community')
  return [AllCommunityModule]
})()
