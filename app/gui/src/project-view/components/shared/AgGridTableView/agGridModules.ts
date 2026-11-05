/**
 * @file The AG Grid modules this app registers: everything AG Grid Community offers.
 *
 * Registration is per-grid (the `modules` prop) rather than global, so nothing here leaks into
 * other grids or into tests that mount their own. `AgGridTableView.vue` imports this module
 * dynamically, together with `ag-grid-vue3`, so AG Grid stays out of the chunks that never show a
 * table.
 */

import { AllCommunityModule, type Module } from 'ag-grid-community'

export const agGridModules: Module[] = [AllCommunityModule]
