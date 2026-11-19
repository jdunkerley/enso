import { reportWidgetSchemaMismatch, reportWidgetTiming } from '$/providers/engineLogAppend'
import { setEngineLogSettings } from '$/providers/engineLogSettings'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fetchMock = vi.fn(
  async (..._args: [string, RequestInit]) => new Response(null, { status: 204 }),
)
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockClear()
  setEngineLogSettings({ performanceTimings: false })
})

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)))

test('a schema mismatch is appended once, on the GUI widgets logger', () => {
  const issues = [{ path: ['arguments', 0, 1], message: 'Invalid input' }]
  reportWidgetSchemaMismatch('project-1', 'Standard.Table.Table.Table.join', issues)
  reportWidgetSchemaMismatch('project-1', 'Standard.Table.Table.Table.join', issues)
  expect(sentBodies()).toEqual([
    expect.objectContaining({ project: 'project-1', level: 'WARN', logger: 'enso.gui.Widgets' }),
  ])
  expect(sentBodies()[0].message).toContain('arguments.0.1: Invalid input')
})

test('timings are appended only while the performance setting is on', () => {
  reportWidgetTiming('project-1', 'T.m', 1.23, 4.56)
  expect(fetchMock).not.toHaveBeenCalled()
  setEngineLogSettings({ performanceTimings: true })
  reportWidgetTiming('project-1', 'T.m', 1.23, 4.56)
  expect(sentBodies()).toEqual([
    expect.objectContaining({
      level: 'DEBUG',
      logger: 'enso.gui.performance',
      message: 'Widget_Query.T.m parse~1.2ms parse+render~4.6ms',
    }),
  ])
})
