/** @file Widget queries are attached after the visible visualizations (Note [Widget Queries After Visible Visualizations]). */
import { afterEach, expect, test, vi } from 'vitest'
import type { Uuid } from 'ydoc-shared/languageServerTypes'
import type { VisRequestId, VisSlotStatus } from 'ydoc-shared/visualizations'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import {
  BACKGROUND_HOLD_CAP_MS,
  BackgroundHold,
  foregroundSettled,
  visualizationsToAttach,
  type NodeVisualizationConfiguration,
} from '../executionContext'

const config = (expressionId: string): NodeVisualizationConfiguration => ({
  expressionId: expressionId as ExternalId,
  visualizationModule: 'Standard.Visualization.Preprocessor',
  expression: 'x -> x',
})
const WIDGET = 'widget' as Uuid
const TABLE = 'table' as Uuid
// The widget query was configured first, as it can be when a node's widgets render before its
// visualization.
const configs = new Map([
  [WIDGET, config('a')],
  [TABLE, config('b')],
])

test('holds widget queries back until released', () => {
  expect(visualizationsToAttach(configs, new Set([WIDGET]), false).map(([id]) => id)).toEqual([
    TABLE,
  ])
})
test('attaches the visible ones first once released', () => {
  expect(visualizationsToAttach(configs, new Set([WIDGET]), true).map(([id]) => id)).toEqual([
    TABLE,
    WIDGET,
  ])
})
test('the visible visualizations are settled once none is pending', () => {
  const status = new Map<string, VisSlotStatus>([
    ['r1', 'ready'],
    ['r2', 'pending'],
  ])
  const statusOf = (rid: VisRequestId) => status.get(rid)
  expect(foregroundSettled(['r1' as VisRequestId], statusOf)).toBe(true)
  expect(foregroundSettled(['r1', 'r2'] as VisRequestId[], statusOf)).toBe(false)
  expect(foregroundSettled([], statusOf)).toBe(false)
})

afterEach(() => {
  vi.useRealTimers()
})
test('holds nothing when no visible visualization is pending', () => {
  const onRelease = vi.fn()
  const hold = new BackgroundHold(onRelease)
  expect(hold.holds(false)).toBe(false)
})
test('releases widget queries after the cap, even if the visible one never answers', () => {
  vi.useFakeTimers()
  const onRelease = vi.fn()
  const hold = new BackgroundHold(onRelease)
  expect(hold.holds(true)).toBe(true)
  vi.advanceTimersByTime(BACKGROUND_HOLD_CAP_MS - 1)
  expect(hold.holds(true)).toBe(true)
  expect(onRelease).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(onRelease).toHaveBeenCalledOnce()
  expect(hold.holds(true)).toBe(false)
})
