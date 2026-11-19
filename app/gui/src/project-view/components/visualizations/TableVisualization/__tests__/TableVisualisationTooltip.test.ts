import type { ITooltipParams } from 'ag-grid-community'
import { expect, test } from 'vitest'
import { TableVisualisationTooltip } from '../TableVisualisationTooltip'
import type { DataQualityMetricValue } from '../tableView'

function render(value: string, metrics: DataQualityMetricValue[], showDataQuality = true) {
  const tooltip = new TableVisualisationTooltip()
  tooltip.init({
    value,
    dataQualityMetrics: metrics,
    total: 4,
    showDataQuality,
  } as ITooltipParams & {
    dataQualityMetrics: DataQualityMetricValue[]
    total: number
    showDataQuality: boolean
  })
  return tooltip.getGui()
}

test('uses the app font, not a hard-coded one', () => {
  expect(render('Char', []).style.fontFamily).toBe('var(--font-sans)')
})

test('shows the type and the metrics', () => {
  const gui = render('Integer (64 bits)', [
    { name: 'Number of nothing', value: 1, displayType: 'Percentage' },
    { name: 'Number of distinct', value: 3, displayType: 'Count' },
  ])
  expect(gui.textContent).toBe(
    'Column value type: Integer (64 bits)Number of nothing: 25.00%Number of distinct: 3',
  )
  expect(gui.querySelectorAll('span')).toHaveLength(1)
})

test('hides the metrics when data quality is off', () => {
  const gui = render('Char', [{ name: 'Count', value: 3, displayType: 'Count' }], false)
  expect(gui.textContent).toBe('Column value type: Char')
})

test('engine text is shown as text, never parsed as HTML', () => {
  const gui = render('<img src=x onerror=alert(1)>', [
    { name: '', value: '<b>first</b>\nsecond', displayType: 'Text' },
  ])
  expect(gui.querySelector('img')).toBeNull()
  expect(gui.querySelectorAll('b')).toHaveLength(1)
  expect(gui.textContent).toContain('<b>first</b>\nsecond')
})
