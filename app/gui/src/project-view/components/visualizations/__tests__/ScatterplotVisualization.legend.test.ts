/** @file The scatter plot's legend shows each series in the colour of its points. */
/* eslint-disable camelcase */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import { defineComponent, h, Suspense } from 'vue'
import ScatterplotVisualization from '../ScatterplotVisualization.vue'

// jsdom has no canvas to measure text with.
vi.mock('@/util/measurement', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTextWidthByFont: (text: string) => text.length * 6,
}))

vi.mock('@/providers/visualizationConfig', () => ({
  useVisualizationConfig: () => ({
    size: { x: 600, y: 400 },
    createNodes: vi.fn(),
    setPreprocessor: vi.fn(),
    setToolbar: vi.fn(),
  }),
}))

// Two series, with labels that differ from their keys, as `Scatter_Plot.enso` sends them.
const DATA = {
  axis: { x: { label: 'Day' }, y: { label: 'Sales' }, '(y_multi 0)': { label: 'Cost' } },
  is_multi_series: true,
  x_value_type: 'Integer',
  error_message: null,
  data: [
    { x: 1, y: 10, '(y_multi 0)': 4, row_number: 0 },
    { x: 2, y: 12, '(y_multi 0)': 5, row_number: 1 },
  ],
}

test("each legend entry has the colour of its series' points", async () => {
  // The view loads d3 in its setup (`await import('d3')`), so it renders inside a Suspense.
  const Host = defineComponent(
    () => () => h(Suspense, null, () => h(ScatterplotVisualization, { data: DATA })),
  )
  const { wrapper } = await mountWithProviders(Host)
  // The first `import('d3')` of a run can take seconds to transform, longer than `waitFor`'s
  // default second.
  await vi.waitFor(
    async () => {
      await flushPromises()
      expect(wrapper.findAll('circle.scatterPoint').length).toBeGreaterThan(0)
    },
    { timeout: 10_000 },
  )
  const fill = (el: Element) => (el as SVGElement).style.fill
  const points = wrapper.findAll('circle.scatterPoint').map((c) => fill(c.element))
  // The points come series by series: the first two are Sales, the next two Cost.
  expect(points).toHaveLength(4)
  expect(points[0]).toBe(points[1])
  expect(points[2]).toBe(points[3])
  expect(points[0]).not.toBe(points[2])
  // The legend is the first group of the plot: a circle and a label per series.
  const legendGroup = wrapper.find('svg > g')
  const legend = legendGroup.findAll('circle').map((c) => fill(c.element))
  const labels = legendGroup.findAll('text').map((t) => t.element.firstChild?.textContent)
  expect(labels).toEqual(['Sales', 'Cost'])
  expect(legend).toEqual([points[0], points[2]])
})
