/** @file The toast shown while the JDK AOT cache trains, and when the training ends. */
import { useJvmAotTrainingToast } from '$/composables/jvmAotTrainingToast'
import type { JvmAotApi } from '$/electronApi'
import { useText } from '$/providers/text'
import { DEFAULT_AUTO_CLOSE_MS, useToasts } from '$/providers/toasts'
import type { JvmAotTrainingStatus } from 'enso-common/src/jvmAot'
import { afterEach, describe, expect, test } from 'vitest'
import { effectScope, nextTick } from 'vue'

const { getText } = useText()

afterEach(() => {
  const toasts = useToasts()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
})

/** A fake Electron API: `status` answers the query on load, `emit` broadcasts a change. */
function fakeApi(status: JvmAotTrainingStatus | Promise<JvmAotTrainingStatus> = 'idle') {
  const handlers = new Set<(status: JvmAotTrainingStatus) => void>()
  const api: JvmAotApi = {
    trainingStatus: () => Promise.resolve(status),
    onTrainingStatus: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  return {
    api,
    handlers,
    emit: (next: JvmAotTrainingStatus) => {
      for (const handler of handlers) handler(next)
    },
  }
}

/** The toasts that are shown and not closing. */
function shown() {
  return useToasts().toasts.value.filter((toast) => toast.isIn)
}

async function settle() {
  await Promise.resolve()
  await nextTick()
}

function run(api: JvmAotApi) {
  const scope = effectScope()
  scope.run(() => useJvmAotTrainingToast(api))
  return scope
}

describe('useJvmAotTrainingToast', () => {
  test('a training shows a lasting toast with a spinner and a close button, bottom-right', async () => {
    const { api, emit } = fakeApi()
    const scope = run(api)
    await settle()
    expect(shown()).toEqual([])
    emit('training')
    await settle()
    expect(shown()).toEqual([
      expect.objectContaining({
        content: getText('jvmAotTrainingToast'),
        isLoading: true,
        autoClose: false,
        closeButton: true,
        position: 'bottom-right',
      }),
    ])
    scope.stop()
  })

  test('a success turns it into "Engine ready", which closes by itself', async () => {
    const { api, emit } = fakeApi()
    const scope = run(api)
    emit('training')
    emit('trained')
    await settle()
    expect(shown()).toEqual([
      expect.objectContaining({
        content: getText('jvmAotTrainedToast'),
        position: 'bottom-right',
        type: 'success',
        isLoading: false,
        autoClose: DEFAULT_AUTO_CLOSE_MS,
      }),
    ])
    scope.stop()
  })

  test('a failure turns it into a lasting, closable message', async () => {
    const { api, emit } = fakeApi()
    const scope = run(api)
    emit('training')
    emit('failed')
    await settle()
    expect(shown()).toEqual([
      expect.objectContaining({
        content: getText('jvmAotTrainingFailedToast'),
        isLoading: false,
        autoClose: false,
        closeButton: true,
      }),
    ])
    scope.stop()
  })

  test('the outcome is shown even after the training toast was closed', async () => {
    const { api, emit } = fakeApi()
    const scope = run(api)
    emit('training')
    useToasts().dismiss('jvm-aot-training')
    useToasts().remove('jvm-aot-training')
    emit('trained')
    await settle()
    expect(shown().map((toast) => toast.content)).toEqual([getText('jvmAotTrainedToast')])
    scope.stop()
  })

  test('a window that loads mid-training shows the toast', async () => {
    const { api } = fakeApi('training')
    const scope = run(api)
    await settle()
    expect(shown().map((toast) => toast.content)).toEqual([getText('jvmAotTrainingToast')])
    scope.stop()
  })

  test('a window that loads after the training ended, or with nothing to train, shows nothing', async () => {
    for (const status of ['idle', 'trained', 'failed'] as const) {
      const scope = run(fakeApi(status).api)
      await settle()
      expect(shown()).toEqual([])
      scope.stop()
    }
  })

  test('a broadcast that overtakes the answer on load wins', async () => {
    let answer: (status: JvmAotTrainingStatus) => void = () => {}
    const { api, emit } = fakeApi(new Promise((resolve) => (answer = resolve)))
    const scope = run(api)
    emit('training')
    emit('trained')
    answer('training')
    await settle()
    expect(shown().map((toast) => toast.content)).toEqual([getText('jvmAotTrainedToast')])
    scope.stop()
  })

  test('stops listening with its scope; nothing happens outside Electron', async () => {
    const { api, handlers } = fakeApi()
    const scope = run(api)
    expect(handlers.size).toBe(1)
    scope.stop()
    expect(handlers.size).toBe(0)
    // The tests have no `window.api`, as in the browser build.
    const browser = effectScope()
    expect(() => browser.run(() => useJvmAotTrainingToast())).not.toThrow()
    await settle()
    expect(shown()).toEqual([])
    browser.stop()
  })
})
