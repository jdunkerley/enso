import { setEngineLogSettings } from '$/providers/engineLogSettings'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { ProjectId, ProjectSessionId } from 'enso-common/src/services/Backend'
import { createDeferred } from 'enso-common/src/utilities/async'
import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import EngineLogPanel from '../EngineLogPanel.vue'
import { LIVE_ROW_CAP } from '../engineLogModel'
import { useEngineLogStream } from '../engineLogStream'
import { FakeEventSource } from './fakeEventSource'

const mocks = vi.hoisted(() => ({
  listProjectSessions: vi.fn(),
  getProjectSessionLogs: vi.fn(),
  listProjectSessionPages: vi.fn(),
  downloadProjectSessionLogs: vi.fn(),
  os: 'linux' as 'linux' | 'macos' | 'windows',
  noLocalBackend: false,
}))
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () => mockBackends({ localBackend: mocks.noLocalBackend ? null : mocks }),
  }
})
vi.mock('enso-common/src/utilities/detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('enso-common/src/utilities/detect')>()),
  isOnWindows: () => mocks.os === 'windows',
  isOnMacOS: () => mocks.os === 'macos',
}))

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
  mocks.getProjectSessionLogs.mockReset().mockResolvedValue({ scrollId: 'done', hits: [] })
  // Each session is one page, its active file.
  mocks.listProjectSessionPages.mockReset().mockResolvedValue(['active'])
  mocks.downloadProjectSessionLogs.mockReset().mockResolvedValue(undefined)
  mocks.os = 'linux'
  mocks.noLocalBackend = false
})

afterEach(() => {
  Reflect.deleteProperty(window, 'api')
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

type PanelWrapper = Awaited<ReturnType<typeof mountPanel>>['wrapper']

/** The Sources popover (teleported out of the panel), if it is open. */
const sourcesPopover = () =>
  document.querySelector<HTMLElement>('[data-testid="engine-logs-sources"]')
const sourcesButton = (wrapper: PanelWrapper) =>
  wrapper.find<HTMLButtonElement>('[data-testid="engine-logs-sources-button"]')

/** Open the Sources popover from its button, unless it is open. */
async function openSources(wrapper: PanelWrapper) {
  if (sourcesPopover() != null) return
  await sourcesButton(wrapper).trigger('click')
  await flushPromises()
  expect(sourcesPopover()).not.toBeNull()
}

function tickbox(name: string) {
  return document.querySelector<HTMLInputElement>(
    `fieldset[aria-label="Sources"] input[type="checkbox"][aria-label="${name}"]`,
  )
}

const tickboxLabels = () =>
  [...document.querySelectorAll('fieldset[aria-label="Sources"] label')].map((label) =>
    label.textContent?.trim(),
  )

/** Tick or untick a source, opening the Sources popover first. */
async function setTickbox(wrapper: PanelWrapper, name: string, checked: boolean) {
  await openSources(wrapper)
  const box = tickbox(name)!
  box.checked = checked
  box.dispatchEvent(new Event('change'))
  await flushPromises()
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
  await setTickbox(wrapper, 'Engine', true)
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
    scrollId: 'active',
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
    scrollId: 'active',
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

test('the source tickboxes: Engine off, Libraries and User log messages on', async () => {
  const { wrapper } = await mountPanel()
  await openSources(wrapper)
  expect(tickboxLabels()).toEqual(['Engine', 'Libraries', 'User log messages'])
  expect(tickbox('Engine')!.checked).toBe(false)
  expect(tickbox('Libraries')!.checked).toBe(true)
  expect(tickbox('User log messages')!.checked).toBe(true)
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
  await setTickbox(wrapper, 'Engine', true)
  expect(lineTexts()).toEqual(lines)
  await setTickbox(wrapper, 'Libraries', false)
  expect(lineTexts()).toEqual([ENGINE_INFO, USER_WARN])
  await setTickbox(wrapper, 'User log messages', false)
  expect(lineTexts()).toEqual([ENGINE_INFO])
  await setTickbox(wrapper, 'Engine', false)
  await setTickbox(wrapper, 'Libraries', true)
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
  await setTickbox(wrapper, 'Engine', true)
  await setTickbox(wrapper, 'Libraries', false)
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
  await setTickbox(wrapper, 'Libraries', false)
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
  await openSources(wrapper)
  const labels = tickboxLabels
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
  expect(tickbox('SQL queries')!.checked).toBe(true)
  await setTickbox(wrapper, 'SQL queries', false)
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
  await setTickbox(wrapper, 'Performance', false)
  expect(lineTexts()).toEqual([STD_BITS_INFO])
  // They are not Libraries.
  await setTickbox(wrapper, 'Libraries', false)
  await setTickbox(wrapper, 'SQL queries', true)
  await setTickbox(wrapper, 'Performance', true)
  expect(lineTexts()).toEqual([SQL_INFO, TIMING])
  // Turned off and on again, a box comes back checked.
  await setTickbox(wrapper, 'SQL queries', false)
  setEngineLogSettings({ sqlQueries: false })
  await flush()
  setEngineLogSettings({ sqlQueries: true })
  await flush()
  expect(tickbox('SQL queries')!.checked).toBe(true)
})

describe('the Sources popover', () => {
  const filterInput = (wrapper: PanelWrapper) =>
    wrapper.find<HTMLInputElement>('input[aria-label="Filter logs"]').element
  /** Let Reka register its outside-press listener, which it adds in a timeout. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()
  }

  test('its button opens it and says it is open; ticking a box leaves it open', async () => {
    const { wrapper } = await mountPanel()
    const button = sourcesButton(wrapper)
    expect(sourcesPopover()).toBeNull()
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')
    await flushPromises()
    expect(sourcesPopover()).not.toBeNull()
    expect(sourcesPopover()!.getAttribute('aria-label')).toBe('Sources')
    expect(button.attributes('aria-expanded')).toBe('true')
    await settle()
    const user = userEvent.setup()
    await user.click(tickbox('Engine')!)
    await flushPromises()
    expect(tickbox('Engine')!.checked).toBe(true)
    expect(sourcesPopover()).not.toBeNull()
    // The button toggles it closed.
    await button.trigger('click')
    await flushPromises()
    expect(sourcesPopover()).toBeNull()
  })

  test('Escape closes it, and focus returns to its button', async () => {
    const { wrapper } = await mountPanel()
    const button = sourcesButton(wrapper)
    button.element.focus()
    await openSources(wrapper)
    await settle()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(sourcesPopover()).toBeNull()
    expect(document.activeElement).toBe(button.element)
  })

  test('a press outside closes it', async () => {
    const { wrapper } = await mountPanel()
    await openSources(wrapper)
    await settle()
    const user = userEvent.setup()
    await user.click(wrapper.find('[role="log"]').element)
    await flushPromises()
    expect(sourcesPopover()).toBeNull()
  })

  test('the text filter opens it as it takes focus, and keeps the focus', async () => {
    const { wrapper } = await mountPanel()
    const input = filterInput(wrapper)
    input.focus()
    await flushPromises()
    await settle()
    expect(sourcesPopover()).not.toBeNull()
    expect(document.activeElement).toBe(input)
    // Typing goes on in the filter, and a press on it leaves the popover open.
    const user = userEvent.setup()
    await user.click(input)
    await user.keyboard('rows')
    await flushPromises()
    expect(input.value).toBe('rows')
    expect(sourcesPopover()).not.toBeNull()
    // A box ticked from there leaves it open too.
    await user.click(tickbox('Engine')!)
    await flushPromises()
    expect(sourcesPopover()).not.toBeNull()
    // Back in the filter, Escape closes it and leaves the focus in the filter.
    await user.click(input)
    await user.keyboard('{Escape}')
    await flushPromises()
    await settle()
    expect(sourcesPopover()).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  test('opened from its button, Escape in the filter leaves the focus in the filter', async () => {
    const { wrapper } = await mountPanel()
    await openSources(wrapper)
    await settle()
    const input = filterInput(wrapper)
    const user = userEvent.setup()
    await user.click(input)
    await user.keyboard('Slow')
    expect(sourcesPopover()).not.toBeNull()
    await user.keyboard('{Escape}')
    await flushPromises()
    await settle()
    expect(sourcesPopover()).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Slow')
  })

  test('Escape from a tickbox moves the keyboard to the button at once', async () => {
    const { wrapper } = await mountPanel()
    await openSources(wrapper)
    await settle()
    tickbox('Engine')!.focus()
    // Reka's own Escape listener closes it; no flush: the focus moves before the content goes.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.activeElement).toBe(sourcesButton(wrapper).element)
  })

  test('the filter says it opens the popover, and names it while it is open', async () => {
    const { wrapper } = await mountPanel()
    const input = filterInput(wrapper)
    expect(input.getAttribute('aria-haspopup')).toBe('dialog')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.getAttribute('aria-controls')).toBeNull()
    input.focus()
    await flushPromises()
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(sourcesPopover()!.id)
  })

  test('Tab goes from the filter to the button, through the tickboxes, then on', async () => {
    const { wrapper } = await mountPanel()
    const input = filterInput(wrapper)
    const button = sourcesButton(wrapper).element
    const session = wrapper.find('select[aria-label="Session"]').element
    input.focus()
    await flushPromises()
    await settle()
    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(button)
    expect(sourcesPopover()).not.toBeNull()
    await user.tab()
    expect(document.activeElement).toBe(tickbox('Engine'))
    // Space ticks it; the popover stays open.
    await user.keyboard(' ')
    await flushPromises()
    expect(tickbox('Engine')!.checked).toBe(true)
    await user.tab()
    expect(document.activeElement).toBe(tickbox('Libraries'))
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(button)
    expect(sourcesPopover()).not.toBeNull()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(tickbox('User log messages'))
    // Past the last box, on to the Session picker, which closes the popover.
    await user.tab()
    await flushPromises()
    await settle()
    expect(document.activeElement).toBe(session)
    expect(sourcesPopover()).toBeNull()
  })

  test('its button sums up the boxes shown: all, none, one by name, or how many', async () => {
    const { wrapper } = await mountPanel()
    const label = () => sourcesButton(wrapper).text()
    // By default, Libraries and User log messages but not Engine.
    expect(label()).toBe('Sources: 2 of 3')
    expect(sourcesButton(wrapper).attributes('title')).toBe('Libraries, User log messages')
    await setTickbox(wrapper, 'User log messages', false)
    expect(label()).toBe('Sources: Libraries')
    await setTickbox(wrapper, 'Libraries', false)
    expect(label()).toBe('Sources: None')
    await setTickbox(wrapper, 'Engine', true)
    await setTickbox(wrapper, 'Libraries', true)
    await setTickbox(wrapper, 'User log messages', true)
    expect(label()).toBe('Sources: All')
    // SQL queries appears ticked: still all of them.
    setEngineLogSettings({ sqlQueries: true })
    await flushPromises()
    expect(label()).toBe('Sources: All')
    await setTickbox(wrapper, 'SQL queries', false)
    expect(label()).toBe('Sources: 3 of 4')
    // A hidden box does not count.
    setEngineLogSettings({ sqlQueries: false })
    await flushPromises()
    expect(label()).toBe('Sources: All')
  })
})

describe('download and reveal', () => {
  const OLD_WITH_FILE = { ...OLD_SESSION, logFile: '/logs/enso-language-server-old.log' }
  const download = (wrapper: Awaited<ReturnType<typeof mountPanel>>['wrapper']) =>
    wrapper.find<HTMLButtonElement>('[data-testid="engine-logs-download"]')
  const reveal = (wrapper: Awaited<ReturnType<typeof mountPanel>>['wrapper']) =>
    wrapper.find<HTMLButtonElement>('[data-testid="engine-logs-reveal"]')
  const showItemInFolder = vi.fn()
  const withSystemApi = () =>
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { showLogFileInFolder: showItemInFolder } },
    })

  beforeEach(() => showItemInFolder.mockReset())

  test("downloads the shown session's log file: the live one, then an earlier one", async () => {
    mocks.listProjectSessions.mockResolvedValue([OLD_WITH_FILE])
    const { source, wrapper, flush } = await mountPanel()
    expect(download(wrapper).attributes('aria-label')).toBe('Download log file')
    // No session yet: nothing to download.
    expect(download(wrapper).element.disabled).toBe(true)
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: null,
      logFile: null,
    })
    source.emit('session', { seq: 1, sessionId: 's1', logFile: '/logs/live.log' })
    await flush()
    expect(download(wrapper).element.disabled).toBe(false)
    await download(wrapper).trigger('click')
    expect(mocks.downloadProjectSessionLogs).toHaveBeenLastCalledWith('s1')
    await wrapper.find('select[aria-label="Session"]').setValue('old')
    await flush()
    await download(wrapper).trigger('click')
    expect(mocks.downloadProjectSessionLogs).toHaveBeenLastCalledWith('old')
  })

  test('says when a download fails', async () => {
    mocks.downloadProjectSessionLogs.mockRejectedValue(new Error('disk full'))
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: 's1',
      logFile: null,
    })
    await flush()
    await download(wrapper).trigger('click')
    await flush()
    expect(wrapper.find('[role="alert"]').text()).toContain('disk full')
  })

  test('a download error goes once another session shows', async () => {
    mocks.listProjectSessions.mockResolvedValue([OLD_WITH_FILE])
    mocks.downloadProjectSessionLogs.mockRejectedValue(new Error('disk full'))
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: 's1',
      logFile: null,
    })
    await flush()
    await download(wrapper).trigger('click')
    await flush()
    expect(wrapper.text()).toContain('disk full')
    await wrapper.find('select[aria-label="Session"]').setValue('old')
    await flush()
    expect(wrapper.text()).not.toContain('disk full')
  })

  test('without the local backend, Download is disabled', async () => {
    mocks.noLocalBackend = true
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: 's1',
      logFile: null,
    })
    await flush()
    expect(download(wrapper).element.disabled).toBe(true)
  })

  test('has no reveal button without the desktop API', async () => {
    const { wrapper } = await mountPanel()
    expect(reveal(wrapper).exists()).toBe(false)
  })

  test("reveals the shown session's file, and is disabled while it has none", async () => {
    withSystemApi()
    mocks.listProjectSessions.mockResolvedValue([
      OLD_WITH_FILE,
      { ...OLD_SESSION, projectSessionId: ProjectSessionId('older') },
    ])
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: null,
      logFile: null,
    })
    source.emit('waiting', { seq: 1 })
    await flush()
    expect(reveal(wrapper).element.disabled).toBe(true)
    source.emit('session', { seq: 2, sessionId: 's1', logFile: '/logs/live.log' })
    await flush()
    await reveal(wrapper).trigger('click')
    expect(showItemInFolder).toHaveBeenLastCalledWith('/logs/live.log')
    const picker = wrapper.find('select[aria-label="Session"]')
    await picker.setValue('old')
    await flush()
    await reveal(wrapper).trigger('click')
    expect(showItemInFolder).toHaveBeenLastCalledWith('/logs/enso-language-server-old.log')
    // A session listed without its file cannot be revealed.
    await picker.setValue('older')
    await flush()
    expect(reveal(wrapper).element.disabled).toBe(true)
  })

  test.each([
    ['windows', 'Reveal in Explorer'],
    ['macos', 'Show in Finder'],
    ['linux', 'Show in folder'],
  ] as const)('on %s the reveal button is "%s"', async (os, label) => {
    mocks.os = os
    withSystemApi()
    const { wrapper } = await mountPanel()
    expect(reveal(wrapper).attributes('aria-label')).toBe(label)
  })
})

describe('the session log tab: a session without a live stream', () => {
  const NEWER_SESSION = {
    projectId: PROJECT,
    projectSessionId: ProjectSessionId('newer'),
    createdAt: Rfc3339DateTime('2026-10-20T09:00:00'),
  }

  async function mountStandalone(props: { initialSession: string; projectId?: typeof PROJECT }) {
    const { wrapper } = await mountWithProviders(EngineLogPanel, { props })
    await flushPromises()
    const lineTexts = () => wrapper.findAll('.row .text').map((text) => text.text())
    return { wrapper, lineTexts }
  }

  test('shows the session asked for, and offers the project’s other sessions but no live one', async () => {
    mocks.listProjectSessions.mockResolvedValue([OLD_SESSION, NEWER_SESSION])
    mocks.getProjectSessionLogs.mockImplementation(async (id: string) => ({
      scrollId: 'done',
      hits: [`from ${id}`],
    }))
    const { wrapper, lineTexts } = await mountStandalone({
      initialSession: 'old',
      projectId: PROJECT,
    })
    expect(lineTexts()).toEqual(['from old'])
    const picker = wrapper.find<HTMLSelectElement>('select[aria-label="Session"]')
    expect(picker.element.value).toBe('old')
    expect(picker.findAll('option').map((option) => option.text())).toEqual([
      expect.stringMatching(/^Session 2 /),
      expect.stringMatching(/^Session 1 /),
    ])
    await picker.setValue('newer')
    await flushPromises()
    expect(lineTexts()).toEqual(['from newer'])
    // No live view: no Jump to latest, no waiting notice.
    expect(wrapper.find('.jump').exists()).toBe(false)
  })

  test('a tab saved without its project shows its own session alone', async () => {
    mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: 'done', hits: ['line'] })
    const id = 'localprojectsession-key/enso-language-server-2026-10-19-09-00-00'
    const { wrapper, lineTexts } = await mountStandalone({ initialSession: id })
    expect(lineTexts()).toEqual(['line'])
    expect(mocks.listProjectSessions).not.toHaveBeenCalled()
    expect(wrapper.findAll('select[aria-label="Session"] option').map((o) => o.text())).toEqual([
      'Session enso-language-server-2026-10-19-09-00-00',
    ])
  })

  test('a session whose files are gone says so', async () => {
    mocks.listProjectSessionPages.mockResolvedValue([])
    const { wrapper, lineTexts } = await mountStandalone({ initialSession: 'old' })
    expect(lineTexts()).toEqual([])
    expect(wrapper.text()).toContain('log files are not there')
  })

  test('rows at the top of a window that continue an entry take its level', async () => {
    const lines = [
      '[ERROR] [2026-10-19T09:00:00.000Z] [Standard.Base.Data.Vector] boom',
      ...Array.from({ length: LIVE_ROW_CAP + 5 }, (_, n) => `  at frame ${n}`),
    ]
    mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: 'done', hits: lines })
    const { wrapper, lineTexts } = await mountStandalone({ initialSession: 'old' })
    expect(lineTexts()[0]).toBe('at frame 5')
    // ERROR, from the entry above the window: an unknown library's lines would be INFO.
    await wrapper.find('select[aria-label="Level"]').setValue('error')
    expect(lineTexts()[0]).toBe('at frame 5')
  })

  test('Reload reads the session again', async () => {
    mocks.getProjectSessionLogs.mockResolvedValueOnce({ scrollId: 'done', hits: ['first'] })
    const { wrapper, lineTexts } = await mountStandalone({ initialSession: 'old' })
    expect(lineTexts()).toEqual(['first'])
    mocks.getProjectSessionLogs.mockResolvedValueOnce({
      scrollId: 'done',
      hits: ['first', 'second'],
    })
    await wrapper.find('[data-testid="engine-logs-reload"]').trigger('click')
    await flushPromises()
    expect(lineTexts()).toEqual(['first', 'second'])
    expect(mocks.listProjectSessionPages).toHaveBeenCalledTimes(2)
  })

  test('pages back past the newest lines, and forward again', async () => {
    const archive = Array.from({ length: 15_000 }, (_, n) => `archived ${n}`)
    const active = Array.from({ length: 15_000 }, (_, n) => `active ${n}`)
    mocks.listProjectSessionPages.mockResolvedValue(['archive:0', 'active'])
    mocks.getProjectSessionLogs.mockImplementation(async (_id: string, { scrollId }) => ({
      scrollId: 'unused',
      hits: scrollId === 'active' ? active : archive,
    }))
    const { wrapper, lineTexts } = await mountStandalone({ initialSession: 'old' })
    const divider = () => wrapper.find('.row.divider')
    // The newest 20,000 lines, under an offer to load older ones.
    expect(divider().text()).toContain('Load older lines')
    expect(lineTexts()[0]).toBe('archived 10000')
    await divider().find('button').trigger('click')
    await flushPromises()
    // The list keeps its place: the line that was first is still in view, the older ones above it.
    expect(lineTexts()).toContain('archived 10000')
    expect(lineTexts()).toContain('archived 9999')
    const list = wrapper.find('[role="log"]')
    stubScroller(list.element, 0)
    await list.trigger('scroll')
    // At the start of the session: no more to load above, newer lines below.
    expect(lineTexts()[0]).toBe('archived 0')
    expect(divider().exists()).toBe(false)
    // The window moved back: the newest lines are offered again at its end.
    // Near the end of a long list, not following.
    const scrollTo = (rows: number) => {
      stubScroller(list.element, rows * 18)
      Object.defineProperty(list.element, 'scrollHeight', { configurable: true, value: 1e9 })
    }
    scrollTo(20_000)
    await list.trigger('scroll')
    expect(lineTexts()).toContain('active 4999')
    expect(divider().text()).toContain('Load newer lines')
    await divider().find('button').trigger('click')
    await flushPromises()
    scrollTo(20_001)
    await list.trigger('scroll')
    expect(lineTexts()).toContain('active 14999')
    expect(wrapper.findAll('.row.divider').map((d) => d.text())).not.toContain(
      expect.stringContaining('Load newer lines'),
    )
  })
})

test('Load older lines in the live view pages back through the file; Back to live returns', async () => {
  const history = Array.from({ length: LIVE_ROW_CAP + 5 }, (_, n) => `old ${n}`)
  mocks.getProjectSessionLogs.mockResolvedValue({ scrollId: 'done', hits: [...history, 'live'] })
  const { source, wrapper, flush, lineTexts } = await mountPanel()
  source.emit('hello', { channel: 'c1', oldestSeq: 1, nextSeq: 2, sessionId: 's1', logFile: null })
  source.emit('line', { seq: 1, source: 'file', sessionId: 's1', text: 'live' })
  await flush()
  // No Reload in the live view: it is already current.
  expect(wrapper.find('[data-testid="engine-logs-reload"]').exists()).toBe(false)
  await wrapper.find('[role="log"]').trigger('wheel', { deltaY: -100 })
  await flush()
  // The history filled the view; the rest is offered.
  expect(wrapper.find('.row.divider').text()).toContain('Load older lines')
  await wrapper.find('.row.divider button').trigger('click')
  await flush()
  expect(wrapper.text()).toContain('Showing earlier lines of this session')
  expect(lineTexts()[0]).toBe('old 0')
  expect(wrapper.find('[data-testid="engine-logs-reload"]').exists()).toBe(true)
  await wrapper
    .findAll('button')
    .find((b) => b.text() === 'Back to live')!
    .trigger('click')
  await flush()
  expect(wrapper.text()).not.toContain('Showing earlier lines of this session')
  expect(wrapper.find('[data-testid="engine-logs-reload"]').exists()).toBe(false)
  expect(wrapper.find('.row.divider').text()).toContain('Load older lines')
})

describe("the live view's older lines", () => {
  async function fillToCap(
    source: ReturnType<typeof FakeEventSource.latest>,
    sessionId: string | null,
    firstSeq: number,
  ) {
    for (let n = 0; n <= LIVE_ROW_CAP; n++) {
      source.emit('line', { seq: firstSeq + n, source: 'file', sessionId, text: `line ${n}` })
    }
    return firstSeq + LIVE_ROW_CAP + 1
  }

  test("after a restart, the earlier session's divider pages that session", async () => {
    mocks.listProjectSessions.mockResolvedValue([
      { ...OLD_SESSION, projectSessionId: ProjectSessionId('s1') },
    ])
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: 's1',
      logFile: null,
    })
    let seq = await fillToCap(source, 's1', 1)
    await flush()
    // The engine restarts: the new session's lines come below the old one's.
    source.emit('waiting', { seq: seq++ })
    source.emit('session', { seq: seq++, sessionId: 's2', logFile: '/logs/s2.log' })
    source.emit('line', { seq, source: 'file', sessionId: 's2', text: 'new session' })
    await flush()
    const button = wrapper.find('.row.divider button')
    expect(button.text()).toBe('Load older lines')
    mocks.getProjectSessionLogs.mockClear()
    await button.trigger('click')
    await flush()
    expect((wrapper.find('select[aria-label="Session"]').element as HTMLSelectElement).value).toBe(
      's1',
    )
    expect(mocks.getProjectSessionLogs).toHaveBeenCalledWith(ProjectSessionId('s1'), {
      scrollId: 'active',
    })
    expect(mocks.getProjectSessionLogs).not.toHaveBeenCalledWith(
      ProjectSessionId('s2'),
      expect.anything(),
    )
  })

  test('is not offered while its session has no id yet', async () => {
    const { source, wrapper, flush } = await mountPanel()
    source.emit('hello', {
      channel: 'c1',
      oldestSeq: 1,
      nextSeq: 1,
      sessionId: null,
      logFile: null,
    })
    source.emit('waiting', { seq: 1 })
    const seq = await fillToCap(source, null, 2)
    await flush()
    expect(wrapper.find('.row.divider').text()).toContain('Earlier lines are not shown')
    expect(wrapper.find('.row.divider button').exists()).toBe(false)
    // Once the session has its file, its older lines can be loaded.
    source.emit('session', { seq, sessionId: 's1', logFile: '/logs/s1.log' })
    await flush()
    expect(wrapper.find('.row.divider button').text()).toBe('Load older lines')
  })
})
