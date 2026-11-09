/** @file The "Pre-start the engine" setting reaches the project service on load and on change. */
import { useSpareEngineSync } from '$/composables/spareEngineSync'
import {
  engineRunsOnJvm,
  setPreStartEngine,
  spareEngineSettingsStore,
} from '$/providers/spareEngineSettings'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'

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

afterEach(() => vi.clearAllMocks())

test('sends the setting on load and whenever it changes, and keeps the engine mode', async () => {
  const scope = effectScope()
  scope.run(() => useSpareEngineSync())
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenCalledExactlyOnceWith(true)
  expect(engineRunsOnJvm.value).toBe(true)
  setPreStartEngine(false)
  await flushPromises()
  expect(fake.setSpareEngine).toHaveBeenLastCalledWith(false)
  scope.stop()
})

test('a native engine hides the setting', async () => {
  fake.setSpareEngine.mockResolvedValue({ engineMode: 'native' })
  const scope = effectScope()
  scope.run(() => useSpareEngineSync())
  await flushPromises()
  expect(engineRunsOnJvm.value).toBe(false)
  scope.stop()
})

test('a failed request is not an error, and reports no JVM engine', async () => {
  engineRunsOnJvm.value = true
  fake.setSpareEngine.mockRejectedValue(new Error('no engine'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const scope = effectScope()
  scope.run(() => useSpareEngineSync())
  await flushPromises()
  expect(engineRunsOnJvm.value).toBe(false)
  expect(warn).toHaveBeenCalled()
  scope.stop()
  warn.mockRestore()
})

test('nothing is sent without a local backend', async () => {
  fake.localBackend = null
  const scope = effectScope()
  scope.run(() => useSpareEngineSync())
  await flushPromises()
  expect(fake.setSpareEngine).not.toHaveBeenCalled()
  scope.stop()
})
