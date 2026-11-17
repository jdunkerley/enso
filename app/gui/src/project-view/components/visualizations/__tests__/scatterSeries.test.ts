import { expect, test } from 'vitest'
import { seriesColors, seriesEntries } from '../ScatterplotVisualization/scatterSeries'

// A multi-series plot's axes as `Scatter_Plot.enso` sends them: the keys (`y`, `(y_multi 0)`, …)
// name the series in the points, the labels are the column names shown in the legend.
const PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c']

const AXIS = {
  x: { label: 'Date' },
  y: { label: 'Sales' },
  '(y_multi 0)': { label: 'Cost' },
  '(y_multi 1)': { label: 'Margin' },
}

test('the series are the axis keys other than x, each with its label', () => {
  expect(seriesEntries(AXIS)).toEqual([
    { key: 'y', label: 'Sales' },
    { key: '(y_multi 0)', label: 'Cost' },
    { key: '(y_multi 1)', label: 'Margin' },
  ])
})

test('each series has its own colour, in series order', () => {
  const entries = seriesEntries(AXIS)
  const color = seriesColors(entries, PALETTE)
  expect(entries.map((entry) => color(entry.key))).toEqual(PALETTE)
})

test('a value that is not a series key gets the fallback', () => {
  expect(seriesColors(seriesEntries(AXIS), PALETTE, 'grey')('Sales')).toBe('grey')
})

// d3's ordinal scale adds any value it has not seen to its domain and gives it the next colour,
// which is how the legend (asking by label) drifted from the points (coloured by key).
test('asking for a value that is not a series key does not move the series colours', () => {
  const entries = seriesEntries(AXIS)
  const color = seriesColors(entries, PALETTE)
  const before = entries.map((entry) => color(entry.key))
  for (const entry of entries) color(entry.label)
  expect(entries.map((entry) => color(entry.key))).toEqual(before)
})
