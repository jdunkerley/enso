import { describe, expect, test } from 'vitest'
import { buildDefaultColDef } from '../../AgGridTableView.vue'

describe('buildDefaultColDef', () => {
  test('merges in a communityCellRangeSelected rule delegating to isInRange', () => {
    const isInRangeTrue = () => true
    const trueResult = buildDefaultColDef({}, isInRangeTrue)
    const trueRule = trueResult.cellClassRules?.communityCellRangeSelected
    expect(typeof trueRule).toBe('function')
    expect(
      (trueRule as (params: unknown) => boolean)({
        node: { rowIndex: 0 },
        colDef: { colId: 'a' },
      }),
    ).toBe(true)

    const isInRangeFalse = () => false
    const falseResult = buildDefaultColDef({}, isInRangeFalse)
    const falseRule = falseResult.cellClassRules?.communityCellRangeSelected
    expect(
      (falseRule as (params: unknown) => boolean)({
        node: { rowIndex: 0 },
        colDef: { colId: 'a' },
      }),
    ).toBe(false)
  })

  test('preserves pre-existing cellClassRules entries on the input defaultColDef', () => {
    const existingRule = () => true
    const result = buildDefaultColDef(
      { cellClassRules: { someOtherRule: existingRule } },
      () => false,
    )
    expect(result.cellClassRules?.someOtherRule).toBe(existingRule)
    expect(result.cellClassRules?.communityCellRangeSelected).toBeDefined()
  })
})
