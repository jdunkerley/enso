import { describe, expect, test } from 'vitest'
import { computeBottomStatusBar } from '../TableVisualization.vue'

describe('computeBottomStatusBar', () => {
  test('shows the row counts when the view asks for a bottom status bar', () => {
    expect(computeBottomStatusBar(true, 42, null)).toEqual({
      total: 42,
      filtered: null,
      showFiltered: false,
    })
  })

  test('is absent when the view did not ask for one', () => {
    expect(computeBottomStatusBar(false, 42, null)).toBeUndefined()
  })

  test('shows the filtered count only when it differs from the total', () => {
    expect(computeBottomStatusBar(true, 42, 7)?.showFiltered).toBe(true)
    expect(computeBottomStatusBar(true, 42, 42)?.showFiltered).toBe(false)
    expect(computeBottomStatusBar(true, 42, null)?.showFiltered).toBe(false)
  })
})
