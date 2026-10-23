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
const entry = (level: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [org.enso.Test] ${message}`

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

test('filters by source, with the level and text, and the badge still counts every error', async () => {
  const { stream, source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  const lines = [
    loggedBy('INFO', 'org.enso.languageserver.Boot', 'server started'),
    loggedBy('ERROR', 'Standard.Database.Connection', 'query failed'),
    loggedBy('INFO', 'org.enso.table.Reader', 'read 10 rows'),
  ]
  lines.forEach((text, n) =>
    source.emit('line', { seq: n + 1, source: 'file', sessionId: 's1', text }),
  )
  await flush()
  const picker = wrapper.find('select[aria-label="Source"]')
  expect(picker.findAll('option').map((option) => option.text())).toEqual([
    'All sources',
    'Libraries',
    'Engine',
  ])
  expect(lineTexts()).toEqual(lines)
  await picker.setValue('library')
  expect(lineTexts()).toEqual([lines[1], lines[2]])
  await wrapper.find('select[aria-label="Level"]').setValue('error')
  expect(lineTexts()).toEqual([lines[1]])
  await wrapper.find('select[aria-label="Level"]').setValue('info')
  await wrapper.find('input[aria-label="Filter logs"]').setValue('rows')
  expect(lineTexts()).toEqual([lines[2]])
  await wrapper.find('input[aria-label="Filter logs"]').setValue('')
  // An engine error and stderr, hidden by the Libraries filter, still count as unseen.
  source.emit('line', {
    seq: 4,
    source: 'file',
    sessionId: 's1',
    text: loggedBy('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed'),
  })
  source.emit('line', { seq: 5, source: 'stderr', sessionId: 's1', text: 'boom' })
  await flush()
  expect(lineTexts()).toEqual([lines[1], lines[2]])
  expect(stream.state.unseenErrors).toBe(3)
  await picker.setValue('engine')
  expect(lineTexts()).toEqual([
    lines[0],
    loggedBy('ERROR', 'org.enso.interpreter.runtime.EnsoContext', 'context failed'),
    'boom',
  ])
})

test('filters an earlier session by source', async () => {
  mocks.listProjectSessions.mockResolvedValue([OLD_SESSION])
  mocks.getProjectSessionLogs.mockResolvedValue({
    scrollId: 'done',
    hits: [
      loggedBy('INFO', 'akka.actor.ActorSystem', 'started'),
      loggedBy('WARN', 'local.My_Project.Main', 'from my project'),
    ],
  })
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: 's1', logFile: null })
  await flush()
  await wrapper.find('select[aria-label="Source"]').setValue('library')
  await wrapper.find('select[aria-label="Session"]').setValue('old')
  await flush()
  expect(lineTexts()).toEqual([loggedBy('WARN', 'local.My_Project.Main', 'from my project')])
})
