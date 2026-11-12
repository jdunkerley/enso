/** @file The "Pre-start the engine" setting reaches the project service on load and on change. */
import { useSpareEngineSync } from '$/composables/spareEngineSync'
import { setPreStartEngine, spareEngineSettingsStore } from '$/providers/spareEngineSettings'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const fake = vi.hoisted(() => ({
  setSpareEngine: vi.fn<(enabled: boolean) => Promise<void>>(),
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
  fake.setSpareEngine.mockResolvedValue(undefined)
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

test('sends the setting on load and whenever it changes', async () => {
  startSync()
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true)
  setPreStartEngine(false)
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(false)
})

test('a failed request is not an error', async () => {
  fake.setSpareEngine.mockRejectedValue(new Error('no engine'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  startSync()
  await flushPromises()
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

test('requests go one at a time and the latest value is sent last', async () => {
  const first = deferred<void>()
  fake.setSpareEngine.mockReturnValueOnce(first.promise)
  startSync()
  await flushPromises()
  // Toggled off and on while the first request is in flight: coalesced, nothing sent yet.
  setPreStartEngine(false)
  await flushPromises()
  setPreStartEngine(true)
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true)
  first.resolve()
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledTimes(2)
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(true)
})
