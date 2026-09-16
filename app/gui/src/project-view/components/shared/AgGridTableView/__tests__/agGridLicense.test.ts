import { $config } from '$/config'
import { describe, expect, test } from 'vitest'
import { AG_GRID_ENTERPRISE_AVAILABLE } from '../agGridLicense'

describe('AG_GRID_ENTERPRISE_AVAILABLE', () => {
  test('is false when no AG Grid license key is configured (the default under vitest — see .env.testing)', () => {
    expect($config.AG_GRID_LICENSE_KEY).toBeUndefined()
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(false)
  })

  test('mirrors a direct typeof check against $config.AG_GRID_LICENSE_KEY', () => {
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(typeof $config.AG_GRID_LICENSE_KEY === 'string')
  })
})
