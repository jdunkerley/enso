import { describe, expect, test } from 'vitest'
import { buildSelectionGridOptions } from '../../AgGridTableView.vue'

describe('buildSelectionGridOptions', () => {
  test('licensed: enables native cellSelection, no custom cellClassRules', () => {
    const options = buildSelectionGridOptions(true)
    expect(options.cellSelection).toBe(true)
    expect(options.cellClassRules).toBeUndefined()
  })

  test('unlicensed: disables native cellSelection, adds a custom cellClassRules entry', () => {
    const options = buildSelectionGridOptions(false)
    expect(options.cellSelection).toBeUndefined()
    expect(options.cellClassRules).toBeDefined()
    expect(Object.keys(options.cellClassRules!)).toContain('communityCellRangeSelected')
  })
})
