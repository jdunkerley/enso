import { $config } from '$/config'
import { describe, expect, test } from 'vitest'
import { AG_GRID_ENTERPRISE_AVAILABLE } from '../agGridLicense'

describe('AG_GRID_ENTERPRISE_AVAILABLE', () => {
  test('is false when no real AG Grid license key is configured (app/gui/.env sets an empty placeholder; only untracked .dev-env/* files carry a real key)', () => {
    expect($config.AG_GRID_LICENSE_KEY).toBeFalsy()
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(false)
  })

  test('mirrors a direct non-empty-string check against $config.AG_GRID_LICENSE_KEY', () => {
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(
      typeof $config.AG_GRID_LICENSE_KEY === 'string' && $config.AG_GRID_LICENSE_KEY.length > 0,
    )
  })
})
