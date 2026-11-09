/** @file The "Pre-start the engine" setting reaches the project service on load and on change. */
import { useSpareEngineSync } from '$/composables/spareEngineSync'
import {
  engineRunsOnJvm,
  setPreStartEngine,
  spareEngineSettingsStore,
} from '$/providers/spareEngineSettings'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const fake = vi.hoisted(() => ({
  setSpareEngine: vi.fn<(enabled: boolean) => Promise<{ engineMode: 'native' | 'jvm' }>>(),
  localBackend: null as { setSpareEngine: (enabled: boolean) => Promise<unknown> } | null,
}))

vi.mock('$/providers/backends', () => ({
  useBackends: () => ({
    get localBackend() {
      return fake.localBackend
    },
  }),
}))

beforeEach(() => {
  localStorage.clear()
  spareEngineSettingsStore.setState({ preStart: true })
  engineRunsOnJvm.value = false
  fake.setSpareEngine.mockResolvedValue({ engineMode: 'jvm' })
  fake.localBackend = { setSpareEngine: fake.setSpareEngine }
})

let scope: EffectScope | undefined

/** Run the sync in its own scope, which `afterEach` stops. */
function startSync() {
  scope = effectScope()
  scope.run(() => useSpareEngineSync())
}

afterEach(() => {
  scope?.stop()
  scope = undefined
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('sends the setting on load and whenever it changes, and keeps the engine mode', async () => {
  startSync()
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true)
  expect(engineRunsOnJvm.value).toBe(true)
  setPreStartEngine(false)
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(false)
})

test('a native engine hides the setting', async () => {
  fake.setSpareEngine.mockResolvedValue({ engineMode: 'native' })
  startSync()
  await flushPromises()
  expect(engineRunsOnJvm.value).toBe(false)
})

test('a failed request is not an error, and reports no JVM engine', async () => {
  engineRunsOnJvm.value = true
  fake.setSpareEngine.mockRejectedValue(new Error('no engine'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  startSync()
  await flushPromises()
  expect(engineRunsOnJvm.value).toBe(false)
  expect(warn).toHaveBeenCalled()
})

test('nothing is sent without a local backend', async () => {
  fake.localBackend = null
  startSync()
  await flushPromises()
  expect(fake.setSpareEngine).not.toHaveBeenCalled()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

test('requests go one at a time and only the latest answer is kept', async () => {
  const first = deferred<{ engineMode: 'native' | 'jvm' }>()
  const second = deferred<{ engineMode: 'native' | 'jvm' }>()
  fake.setSpareEngine.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  startSync()
  await flushPromises()
  // Toggled off and on while the first request is in flight: coalesced, nothing sent yet.
  setPreStartEngine(false)
  await flushPromises()
  setPreStartEngine(true)
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true)
  first.resolve({ engineMode: 'native' })
  await flushPromises()
  // The stale answer is dropped; the latest value is then sent.
  expect(engineRunsOnJvm.value).toBe(false)
  expect(fake.setSpareEngine).toHaveBeenCalledTimes(2)
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(true)
  second.resolve({ engineMode: 'jvm' })
  await flushPromises()
  expect(engineRunsOnJvm.value).toBe(true)
})

test('a stale failure does not overwrite the latest answer', async () => {
  let rejectFirst: (reason: Error) => void = () => {}
  const first = new Promise<{ engineMode: 'native' | 'jvm' }>((_, reject) => (rejectFirst = reject))
  fake.setSpareEngine.mockReturnValueOnce(first).mockResolvedValueOnce({ engineMode: 'jvm' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  startSync()
  await flushPromises()
  setPreStartEngine(false)
  await flushPromises()
  rejectFirst(new Error('old'))
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(false)
  expect(engineRunsOnJvm.value).toBe(true)
})
