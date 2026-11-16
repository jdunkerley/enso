/**
 * @file The nodes the scatter plot creates, from the actions its value offers: a filter to the
 * brushed ranges (`brush_filter`) and a point's row (`open_row`). Snapshotted by
 * `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import type { Pattern } from '@/util/ast/match'
import { actionPattern, chainPattern, type VizAction } from '../vizActions'

/**
 * The node filtering the x column to `minX..maxX` and each series to `minY..maxY`: the `brush_filter`
 * action once per column, chained in one node. `undefined` when a bound cannot be written.
 */
export function brushFilterPattern(
  action: VizAction,
  series: string[],
  xColName: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): Pattern | undefined {
  return chainPattern([
    { template: action.template, values: { column: xColName, min: minX, max: maxX } },
    ...series.map((column) => ({
      template: action.template,
      values: { column, min: minY, max: maxY },
    })),
  ])
}

/** The node of one point's row: the `open_row` action at its row number. */
export function rowPattern(action: VizAction, rowNumber: number): Pattern | undefined {
  return actionPattern(action, { index: rowNumber })
}
