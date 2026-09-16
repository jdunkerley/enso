import { $config } from '$/config'

/**
 * Whether a real AG Grid Enterprise license key is configured. When `false`, no code in this
 * codebase may import `ag-grid-enterprise` at runtime — merely importing that package
 * self-registers Enterprise and triggers its watermark/unlicensed execution regardless of grid
 * options. Only "is a non-empty key configured at all" is checked; an invalid/expired key is out
 * of scope (see docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md). A plain
 * `typeof === 'string'` check is not enough: `app/gui/.env` sets an empty-string placeholder for
 * this variable, and an empty string is still `typeof 'string'`.
 */
export const AG_GRID_ENTERPRISE_AVAILABLE =
  typeof $config.AG_GRID_LICENSE_KEY === 'string' && $config.AG_GRID_LICENSE_KEY.length > 0
