import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import {
  RECONNECT_DELAYS_MS,
  useEngineLogStream,
  type EngineLogStreamOptions,
} from '../engineLogStream'
import { FakeEventSource } from './fakeEventSource'

const PROJECT = 'project-%2Fprojects%2FMock Project'
const HELLO = { channel: 'c1', oldestSeq: 1, nextSeq: 1, sessionId: null, logFile: null }
const line = (seq: number, text: string, source = 'file') => ({
  seq,
  source,
  sessionId: 's1',
  text,
})

let scope: EffectScope
let frames: (() => void)[]

beforeEach(() => {
  scope = effectScope()
  frames = []
})

afterEach(() => {
  scope.stop()
  FakeEventSource.reset()
  vi.useRealTimers()
})

function start(options: Partial<EngineLogStreamOptions> = {}) {
  return scope.run(() =>
    useEngineLogStream({
      project: PROJECT,
      active: true,
      createEventSource: (url) => new FakeEventSource(url),
      requestFrame: (callback) => void frames.push(callback),
      ...options,
    }),
  )!
}

function runFrames() {
  const pending = frames
  frames = []
  for (const frame of pending) frame()
}

const texts = (stream: ReturnType<typeof start>) =>
  stream.rows.value.map((row) => (row.kind === 'line' ? row.text : `--${row.divider}--`))

test("connects to the project's stream and applies events once per frame", () => {
  const stream = start()
  const source = FakeEventSource.latest()
  expect(source.params.get('project')).toBe(PROJECT)
  expect(source.params.has('after')).toBe(false)
  source.emit('hello', HELLO)
  source.emit('waiting', { seq: 1 })
  source.emit('line', line(2, 'first'))
  source.emit('line', line(3, 'oops', 'stderr'))
  expect(stream.rows.value).toEqual([])
  expect(frames).toHaveLength(1)
  runFrames()
  expect(texts(stream)).toEqual(['first', 'oops'])
  expect(stream.state.waiting).toBe(true)
  expect(stream.state.unseenErrors).toBe(1)
  stream.markSeen()
  expect(stream.state.unseenErrors).toBe(0)
})

test('reconnects with backoff, resuming after the last event of its channel', () => {
  vi.useFakeTimers()
  start()
  const first = FakeEventSource.latest()
  first.emit('hello', HELLO)
  first.emit('line', line(1, 'one'))
  first.emit('line', line(2, 'two'))
  first.fail()
  expect(first.closed).toBe(true)
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1)
  expect(FakeEventSource.created).toHaveLength(1)
  vi.advanceTimersByTime(1)
  const second = FakeEventSource.latest()
  expect(second.params.get('channel')).toBe('c1')
  expect(second.params.get('after')).toBe('2')
  // No `hello` before this failure, so the next wait is longer.
  second.fail()
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1] - 1)
  expect(FakeEventSource.created).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(FakeEventSource.created).toHaveLength(3)
})

test('shows a skipped divider when the server cannot replay from where it left off', () => {
  vi.useFakeTimers()
  const stream = start()
  const first = FakeEventSource.latest()
  first.emit('hello', HELLO)
  first.emit('line', line(1, 'one'))
  first.fail()
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
  const second = FakeEventSource.latest()
  second.emit('hello', { ...HELLO, oldestSeq: 50, nextSeq: 60 })
  second.emit('line', line(55, 'later'))
  runFrames()
  expect(texts(stream)).toEqual(['one', '--skipped--', 'later'])
})

test('does not reconnect once the stream has ended', () => {
  vi.useFakeTimers()
  const stream = start()
  const source = FakeEventSource.latest()
  source.emit('end', { reason: 'closed' })
  source.fail()
  vi.advanceTimersByTime(60_000)
  expect(FakeEventSource.created).toHaveLength(1)
  runFrames()
  expect(stream.state.ended).toBe('closed')
})

test('retries with backoff while the project is not open yet', () => {
  vi.useFakeTimers()
  const stream = start()
  FakeEventSource.latest().emit('end', { reason: 'not-open' })
  runFrames()
  expect(stream.state.ended).toBe('not-open')
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0])
  expect(FakeEventSource.created).toHaveLength(2)
  FakeEventSource.latest().emit('end', { reason: 'not-open' })
  vi.advanceTimersByTime(RECONNECT_DELAYS_MS[1] - 1)
  expect(FakeEventSource.created).toHaveLength(2)
  vi.advanceTimersByTime(1)
  expect(FakeEventSource.created).toHaveLength(3)
  FakeEventSource.latest().emit('hello', HELLO)
  runFrames()
  expect(stream.state.ended).toBeUndefined()
})

test('a closed stream connects again when the tab becomes active again', async () => {
  const active = ref(true)
  const stream = start({ active })
  FakeEventSource.latest().emit('end', { reason: 'closed' })
  runFrames()
  expect(stream.state.ended).toBe('closed')
  active.value = false
  await nextTick()
  active.value = true
  await nextTick()
  expect(FakeEventSource.created).toHaveLength(2)
  expect(stream.state.ended).toBeUndefined()
})

test('a closed stream connects again for another project', async () => {
  const project = ref(PROJECT)
  const stream = start({ project })
  FakeEventSource.latest().emit('end', { reason: 'closed' })
  runFrames()
  project.value = 'project-other'
  await nextTick()
  expect(FakeEventSource.created).toHaveLength(2)
  expect(FakeEventSource.latest().params.get('project')).toBe('project-other')
  expect(stream.state.ended).toBeUndefined()
})

test('holds no connection while inactive, and catches up when active again', async () => {
  const active = ref(true)
  start({ active })
  const first = FakeEventSource.latest()
  first.emit('hello', HELLO)
  first.emit('line', line(1, 'one'))
  active.value = false
  await nextTick()
  expect(first.closed).toBe(true)
  active.value = true
  await nextTick()
  const second = FakeEventSource.latest()
  expect(second).not.toBe(first)
  expect(second.params.get('after')).toBe('1')
})

test('loadHistory puts earlier lines above the live ones', () => {
  const stream = start()
  const source = FakeEventSource.latest()
  source.emit('hello', { ...HELLO, sessionId: 's1' })
  source.emit('line', line(5, 'L3'))
  runFrames()
  expect(stream.state.sessionStartHeld).toBe(false)
  stream.loadHistory(['L1', 'L2', 'L3'], { project: PROJECT, sessionId: 's1' })
  expect(texts(stream)).toEqual(['L1', 'L2', 'L3'])
  expect(stream.state.sessionStartHeld).toBe(true)
})

test('loadHistory discards lines requested for another session or project', async () => {
  const project = ref(PROJECT)
  const stream = start({ project })
  const source = FakeEventSource.latest()
  source.emit('hello', { ...HELLO, sessionId: 's2' })
  source.emit('line', line(5, 'L3'))
  runFrames()
  stream.loadHistory(['L1', 'L2', 'L3'], { project: PROJECT, sessionId: 's1' })
  expect(texts(stream)).toEqual(['L3'])
  project.value = 'project-other'
  await nextTick()
  stream.loadHistory(['L1'], { project: PROJECT, sessionId: 's2' })
  expect(texts(stream)).toEqual([])
})

test('an unrelated change in a getter does not reconnect or clear a closed stream', async () => {
  const unrelated = ref(0)
  const stream = start({ active: () => unrelated.value >= 0 })
  FakeEventSource.latest().emit('end', { reason: 'closed' })
  runFrames()
  unrelated.value = 1
  await nextTick()
  expect(FakeEventSource.created).toHaveLength(1)
  expect(stream.state.ended).toBe('closed')
})
