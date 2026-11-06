import { AllCommunityModule } from 'ag-grid-community'
import { describe, expect, test } from 'vitest'
import { agGridModules } from '../agGridModules'

describe('AG Grid module selection', () => {
  test('registers the Community bundle', () => {
    expect(agGridModules).toEqual([AllCommunityModule])
  })
})
