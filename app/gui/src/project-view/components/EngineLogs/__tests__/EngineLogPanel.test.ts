import { setEngineLogSettings } from '$/providers/engineLogSettings'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { ProjectId, ProjectSessionId } from 'enso-common/src/services/Backend'
import { createDeferred } from 'enso-common/src/utilities/async'
import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import EngineLogPanel from '../EngineLogPanel.vue'
import { LIVE_ROW_CAP } from '../engineLogModel'
import { useEngineLogStream } from '../engineLogStream'
import { FakeEventSource } from './fakeEventSource'

const mocks = vi.hoisted(() => ({
  listProjectSessions: vi.fn(),
  getProjectSessionLogs: vi.fn(),
}))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ localBackend: mocks }) }
})

const PROJECT = ProjectId('project-%2Fprojects%2FMock')
// A library's logger: the Libraries tickbox, shown by default.
const entry = (level: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [Standard.Base.Test] ${message}`

let scope: EffectScope
let frames: (() => void)[]

beforeEach(() => {
  scope = effectScope()
  frames = []
  mocks.listProjectSessions.mockResolvedValue([])
  mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: 'done', hits: [] })
})

afterEach(() => {
  scope.stop()
  FakeEventSource.reset()
  setEngineLogSettings({ sqlQueries: false, performanceTimings: false })
})

async function mountPanel() {
  const stream = scope.run(() =>
    useEngineLogStream({
      project: PROJECT,
      active: true,
      createEventSource: (url) => new FakeEventSource(url),
      requestFrame: (callback) => void frames.push(callback),
    }),
  )!
  const source = FakeEventSource.latest()
  const { wrapper } = await mountWithProviders(EngineLogPanel, {
    props: { stream, projectId: PROJECT },
  })
  const flush = async () => {
    while (frames.length > 0) frames.shift()!()
    await flushPromises()
  }
  const lineTexts = () => wrapper.findAll('.row .text').map((text) => text.text())
  return { stream, source, wrapper, flush, lineTexts }
}

function stubScroller(element: Element, scrollTop: number) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: scrollTop,
  })
}

test('shows live lines, marks stderr, and says while it waits for the engine', async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: null, logFile: null })
  source.emit('waiting', { seq: 1 })
  source.emit('line', {
    seq: 2,
    source: 'stderr',
    sessionId: null,
    text: 'Picked up JAVA_TOOL_OPTIONS',
  })
  await flush()
  // stderr is the engine's: hidden until Engine is ticked.
  expect(lineTexts()).toEqual([])
  await wrapper.find('input[type="checkbox"][aria-label="Engine"]').setValue(true)
  expect(lineTexts()).toEqual(['Picked up JAVA_TOOL_OPTIONS'])
  expect(wrapper.find('.row.stderr .marker').text()).toBe('stderr')
  expect(wrapper.text()).toContain('Waiting for the engine…')
  source.emit('session', { seq: 3, sessionId: 's1', logFile: '/logs/s1.log' })
  await flush()
  expect(wrapper.text()).not.toContain('Waiting for the engine…')
})

test('filters by level and by text', async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  source.emit('line', { seq: 1, source: 'file', sessionId: 's1', text: entry('INFO', 'started') })
  source.emit('line', {
    seq: 2,
    source: 'file',
    sessionId: 's1',
    text: entry('ERROR', 'query failed'),
  })
  source.emit('line', {
    seq: 3,
    source: 'file',
    sessionId: 's1',
    text: entry('ERROR', 'disk full'),
  })
  await flush()
  expect(lineTexts()).toHaveLength(3)
  await wrapper.find('select[aria-label="Level"]').setValue('error')
  expect(lineTexts()).toEqual([entry('ERROR', 'query failed'), entry('ERROR', 'disk full')])
  await wrapper.find('input[aria-label="Filter logs"]').setValue('DISK')
  expect(lineTexts()).toEqual([entry('ERROR', 'disk full')])
})

test('scrolling up pauses following; Jump to latest resumes it', async () => {
  const { source, wrapper, flush } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  source.emit('line', { seq: 1, source: 'file', sessionId: 's1', text: 'one' })
  await flush()
  const list = wrapper.find('[role="log"]')
  stubScroller(list.element, 400)
  await list.trigger('scroll')
  const jump = wrapper.find('button.jump')
  expect(jump.exists()).toBe(true)
  await jump.trigger('click')
  await flushPromises()
  expect(wrapper.find('button.jump').exists()).toBe(false)
  expect((list.element as HTMLElement).scrollTop).toBe(1000)
})

test("scrolling up at the top loads the session's earlier lines", async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', {
    channel: 'c1',
    oldestSeq: 40,
    nextSeq: 42,
    sessionId: 's1',
    logFile: '/logs/s1.log',
  })
  source.emit('line', { seq: 40, source: 'file', sessionId: 's1', text: 'L3' })
  source.emit('line', { seq: 41, source: 'file', sessionId: 's1', text: 'L4' })
  await flush()
  mocks.getProjectSessionLogs.mockResolvedValueOnce({
    scrollId: 'done',
    hits: ['L1', 'L2', 'L3', 'L4'],
  })
  await wrapper.find('[role="log"]').trigger('wheel', { deltaY: -100 })
  await flush()
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledWith(ProjectSessionId('s1'), {
    scrollId: null,
  })
  expect(lineTexts()).toEqual(['L1', 'L2', 'L3', 'L4'])
  // The session is now held from its start: scrolling up again loads nothing.
  await wrapper.find('[role="log"]').trigger('wheel', { deltaY: -100 })
  await flush()
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledTimes(1)
})

test('lists earlier sessions apart from the current one', async () => {
  mocks.listProjectSessions.mockResolvedValue([
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId('old'),
      createdAt: Rfc3339DateTime('2026-10-19T09:00:00'),
    },
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId('s1'),
      createdAt: Rfc3339DateTime('2026-10-20T10:00:00'),
    },
  ])
  const { source, wrapper, flush } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  await flush()
  const options = wrapper.find('select[aria-label="Session"]').findAll('option')
  expect(options.map((option) => option.text())).toEqual([
    'This session',
    expect.stringContaining('Session 1'),
  ])
})

test('shows an earlier session, read-only', async () => {
  mocks.listProjectSessions.mockResolvedValue([
    {
      projectId: PROJECT,
      projectSessionId: ProjectSessionId('old'),
      createdAt: Rfc3339DateTime('2026-10-19T09:00:00'),
    },
  ])
  mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: 'done', hits: ['from yesterday'] })
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  // The engine is starting: live, the tab would say it is waiting.
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: null, logFile: null })
  source.emit('waiting', { seq: 1 })
  await flush()
  expect(wrapper.text()).toContain('Waiting for the engine…')
  const picker = wrapper.find('select[aria-label="Session"]')
  await picker.setValue('old')
  await flush()
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledWith(ProjectSessionId('old'), {
    scrollId: null,
  })
  expect(lineTexts()).toEqual(['from yesterday'])
  // Read-only: no live notices.
  expect(wrapper.text()).not.toContain('Waiting for the engine…')
})

test('once the history has loaded, reaching the cap does not reload it at the top', async () => {
  const { source, wrapper, flush } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 5, nextSeq: 6, sessionId: 's1', logFile: null })
  source.emit('line', { seq: 5, source: 'file', sessionId: 's1', text: 'L3' })
  await flush()
  mocks.getProjectSessionLogs.mockResolvedValueOnce({ scrollId: 'done', hits: ['L1', 'L2', 'L3'] })
  const list = wrapper.find('[role="log"]')
  await list.trigger('wheel', { deltaY: -100 })
  await flush()
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledTimes(1)
  // Enough new lines to push the loaded history out at the cap.
  for (let n = 0; n < LIVE_ROW_CAP; n++) {
    source.emit('line', { seq: 6 + n, source: 'file', sessionId: 's1', text: `more ${n}` })
  }
  await flush()
  stubScroller(list.element, 0)
  await list.trigger('scroll')
  await list.trigger('wheel', { deltaY: -100 })
  await flush()
  expect(mocks.getProjectSessionLogs).toHaveBeenCalledTimes(1)
})

const OLD_SESSION = {
  projectId: PROJECT,
  projectSessionId: ProjectSessionId('old'),
  createdAt: Rfc3339DateTime('2026-10-19T09:00:00'),
}

test("going back to this session clears an earlier session's load error", async () => {
  mocks.listProjectSessions.mockResolvedValue([OLD_SESSION])
  mocks.getProjectSessionLogs.mockRejectedValue(new Error('unreadable'))
  const { source, wrapper, flush } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  await flush()
  const picker = wrapper.find('select[aria-label="Session"]')
  await picker.setValue('old')
  await flush()
  expect(wrapper.find('[role="alert"]').text()).toContain('unreadable')
  await picker.setValue('')
  await flush()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

test('only the latest request sets the loading and error notices', async () => {
  mocks.listProjectSessions.mockResolvedValue([OLD_SESSION])
  const history = createDeferred<{ scrollId: string; hits: string[] }>()
  const earlier = createDeferred<{ scrollId: string; hits: string[] }>()
  mocks.getProjectSessionLogs.mockImplementation((sessionId: string) =>
    sessionId === 'old' ? earlier.promise : history.promise,
  )
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 5, nextSeq: 6, sessionId: 's1', logFile: null })
  source.emit('line', { seq: 5, source: 'file', sessionId: 's1', text: 'live' })
  await flush()
  const loadingNotice = () =>
    wrapper.findAll('[role="status"]').some((n) => n.text().includes('Loading'))
  await wrapper.find('[role="log"]').trigger('wheel', { deltaY: -100 })
  await flush()
  expect(loadingNotice()).toBe(true)
  // The earlier session is asked for while the history is still being read.
  await wrapper.find('select[aria-label="Session"]').setValue('old')
  await flush()
  expect(loadingNotice()).toBe(true)
  // The stale history request fails: it neither ends the loading nor reports an error.
  history.reject(new Error('stale failure'))
  await flush()
  expect(loadingNotice()).toBe(true)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  earlier.resolve({ scrollId: 'done', hits: ['from yesterday'] })
  await flush()
  expect(loadingNotice()).toBe(false)
  expect(lineTexts()).toEqual(['from yesterday'])
})

const loggedBy = (level: string, logger: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [${logger}] ${message}`

const ENGINE_INFO = loggedBy('INFO', 'org.enso.languageserver.Boot', 'server started')
const LIBRARY_ERROR = loggedBy('ERROR', 'Standard.Table.Table.Table', 'query failed')
const STD_BITS_INFO = loggedBy('INFO', 'org.enso.table.Reader', 'read 10 rows')
const USER_WARN = loggedBy('WARN', 'User.local.My_Project.Main.Report', 'rows look odd')
const ENGINE_ERROR = loggedBy('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed')

function tickbox(wrapper: Awaited<ReturnType<typeof mountPanel>>['wrapper'], name: string) {
  return wrapper.find(`fieldset[aria-label="Sources"] input[type="checkbox"][aria-label="${name}"]`)
}

test('the source tickboxes: Engine off, Libraries and User log messages on', async () => {
  const { wrapper } = await mountPanel()
  const boxes = wrapper.findAll('fieldset[aria-label="Sources"] label')
  expect(boxes.map((box) => box.text())).toEqual(['Engine', 'Libraries', 'User log messages'])
  expect((tickbox(wrapper, 'Engine').element as HTMLInputElement).checked).toBe(false)
  expect((tickbox(wrapper, 'Libraries').element as HTMLInputElement).checked).toBe(true)
  expect((tickbox(wrapper, 'User log messages').element as HTMLInputElement).checked).toBe(true)
})

test('filters by source, with the level and text; the badge counts every ERROR entry but not stderr', async () => {
  const { stream, source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  const lines = [ENGINE_INFO, LIBRARY_ERROR, STD_BITS_INFO, USER_WARN]
  lines.forEach((text, n) =>
    source.emit('line', { seq: n + 1, source: 'file', sessionId: 's1', text }),
  )
  await flush()
  // By default, everything but the engine.
  expect(lineTexts()).toEqual([LIBRARY_ERROR, STD_BITS_INFO, USER_WARN])
  await tickbox(wrapper, 'Engine').setValue(true)
  expect(lineTexts()).toEqual(lines)
  await tickbox(wrapper, 'Libraries').setValue(false)
  expect(lineTexts()).toEqual([ENGINE_INFO, USER_WARN])
  await tickbox(wrapper, 'User log messages').setValue(false)
  expect(lineTexts()).toEqual([ENGINE_INFO])
  await tickbox(wrapper, 'Engine').setValue(false)
  await tickbox(wrapper, 'Libraries').setValue(true)
  expect(lineTexts()).toEqual([LIBRARY_ERROR, STD_BITS_INFO])
  await wrapper.find('select[aria-label="Level"]').setValue('error')
  expect(lineTexts()).toEqual([LIBRARY_ERROR])
  await wrapper.find('select[aria-label="Level"]').setValue('all')
  await wrapper.find('input[aria-label="Filter logs"]').setValue('rows')
  expect(lineTexts()).toEqual([STD_BITS_INFO])
  await wrapper.find('input[aria-label="Filter logs"]').setValue('')
  // An engine ERROR entry, hidden by the tickboxes, still counts; stderr does not.
  source.emit('line', { seq: 5, source: 'file', sessionId: 's1', text: ENGINE_ERROR })
  source.emit('line', { seq: 6, source: 'stderr', sessionId: 's1', text: 'boom' })
  await flush()
  expect(lineTexts()).toEqual([LIBRARY_ERROR, STD_BITS_INFO])
  expect(stream.state.unseenErrors).toBe(2)
  await tickbox(wrapper, 'Engine').setValue(true)
  await tickbox(wrapper, 'Libraries').setValue(false)
  expect(lineTexts()).toEqual([ENGINE_INFO, ENGINE_ERROR, 'boom'])
})

test('filters an earlier session by source', async () => {
  mocks.listProjectSessions.mockResolvedValue([OLD_SESSION])
  mocks.getProjectSessionLogs.mockResolvedValue({
    scrollId: 'done',
    hits: [
      loggedBy('INFO', 'akka.actor.ActorSystem', 'started'),
      loggedBy('WARN', 'local.My_Project.Main', 'from a library'),
      USER_WARN,
    ],
  })
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  await flush()
  await tickbox(wrapper, 'Libraries').setValue(false)
  await wrapper.find('select[aria-label="Session"]').setValue('old')
  await flush()
  expect(lineTexts()).toEqual([USER_WARN])
})

const SQL_INFO = loggedBy(
  'INFO',
  'Standard.Database.Connection',
  'jdbc:sqlite::memory: - query: SELECT 1',
)
const TIMING = loggedBy(
  'DEBUG',
  'Standard.Base.Logging.Progress.JDBC_Connection.[SQLite] SELECT 1',
  'ADVANCE JDBC_Connection.[SQLite] SELECT 1+1~12ms',
)

test('SQL queries and Performance tickboxes show only while their setting is on, checked', async () => {
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  const labels = () => wrapper.findAll('fieldset[aria-label="Sources"] label').map((b) => b.text())
  expect(labels()).toEqual(['Engine', 'Libraries', 'User log messages'])
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  const lines = [SQL_INFO, TIMING, STD_BITS_INFO]
  lines.forEach((text, n) =>
    source.emit('line', { seq: n + 1, source: 'file', sessionId: 's1', text }),
  )
  await flush()
  // Without a box, nothing hides them: the DEBUG timing shows at All levels.
  expect(lineTexts()).toEqual(lines)
  setEngineLogSettings({ sqlQueries: true })
  await flush()
  expect(labels()).toEqual(['Engine', 'Libraries', 'User log messages', 'SQL queries'])
  expect((tickbox(wrapper, 'SQL queries').element as HTMLInputElement).checked).toBe(true)
  await tickbox(wrapper, 'SQL queries').setValue(false)
  expect(lineTexts()).toEqual([TIMING, STD_BITS_INFO])
  setEngineLogSettings({ performanceTimings: true })
  await flush()
  expect(labels()).toEqual([
    'Engine',
    'Libraries',
    'User log messages',
    'SQL queries',
    'Performance',
  ])
  await tickbox(wrapper, 'Performance').setValue(false)
  expect(lineTexts()).toEqual([STD_BITS_INFO])
  // They are not Libraries.
  await tickbox(wrapper, 'Libraries').setValue(false)
  await tickbox(wrapper, 'SQL queries').setValue(true)
  await tickbox(wrapper, 'Performance').setValue(true)
  expect(lineTexts()).toEqual([SQL_INFO, TIMING])
  // Turned off and on again, a box comes back checked.
  await tickbox(wrapper, 'SQL queries').setValue(false)
  setEngineLogSettings({ sqlQueries: false })
  await flush()
  setEngineLogSettings({ sqlQueries: true })
  await flush()
  expect((tickbox(wrapper, 'SQL queries').element as HTMLInputElement).checked).toBe(true)
})
