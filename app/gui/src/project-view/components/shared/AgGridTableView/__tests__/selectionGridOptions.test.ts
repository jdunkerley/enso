import { describe, expect, test } from 'vitest'
import { buildDefaultColDef, buildSelectionGridOptions } from '../../AgGridTableView.vue'

describe('buildSelectionGridOptions', () => {
  test('licensed: enables native cellSelection', () => {
    const options = buildSelectionGridOptions(true)
    expect(options.cellSelection).toBe(true)
  })

  test('unlicensed: disables native cellSelection', () => {
    const options = buildSelectionGridOptions(false)
    expect(options.cellSelection).toBeUndefined()
  })
})

describe('buildDefaultColDef', () => {
  test('licensed: returns defaultColDef unchanged', () => {
    const defaultColDef = { sortable: true }
    const result = buildDefaultColDef(defaultColDef, true, () => true)
    expect(result).toEqual(defaultColDef)
  })

  test('unlicensed: merges in a communityCellRangeSelected rule delegating to isInRange', () => {
    const isInRangeTrue = () => true
    const trueResult = buildDefaultColDef({}, false, isInRangeTrue)
    const trueRule = trueResult.cellClassRules?.communityCellRangeSelected
    expect(typeof trueRule).toBe('function')
    expect(
      (trueRule as (params: unknown) => boolean)({
        node: { rowIndex: 0 },
        colDef: { colId: 'a' },
      }),
    ).toBe(true)

    const isInRangeFalse = () => false
    const falseResult = buildDefaultColDef({}, false, isInRangeFalse)
    const falseRule = falseResult.cellClassRules?.communityCellRangeSelected
    expect(
      (falseRule as (params: unknown) => boolean)({
        node: { rowIndex: 0 },
        colDef: { colId: 'a' },
      }),
    ).toBe(false)
  })

  test('unlicensed: preserves pre-existing cellClassRules entries on the input defaultColDef', () => {
    const existingRule = () => true
    const result = buildDefaultColDef(
      { cellClassRules: { someOtherRule: existingRule } },
      false,
      () => false,
    )
    expect(result.cellClassRules?.someOtherRule).toBe(existingRule)
    expect(result.cellClassRules?.communityCellRangeSelected).toBeDefined()
  })
})
