/** @file A quit waits for the spare engine (`src/spareQuit.ts`), against a fake `app`. */
import { EventEmitter } from 'node:events'
import { expect, test, vi } from 'vitest'

import { holdQuitForSpareEngine } from '../../src/spareQuit'

/** An `app` whose `quit` emits `before-quit` and counts the quits that were not cancelled. */
class FakeApp extends EventEmitter {
  quits = 0
  quit() {
    let cancelled = false
    this.emit('before-quit', { preventDefault: () => (cancelled = true) })
    if (!cancelled) this.quits += 1
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => (resolve = res))
  return { promise, resolve }
}

test('without a spare the quit goes on at once', () => {
  const app = new FakeApp()
  const stop = vi.fn(async () => {})
  holdQuitForSpareEngine(app, { alive: () => false, stop })
  app.quit()
  expect(app.quits).toBe(1)
  expect(stop).not.toHaveBeenCalled()
})

test('a live spare holds the quit until it has stopped, once however often quit is asked', async () => {
  const app = new FakeApp()
  const stopped = deferred()
  let alive = true
  const stop = vi.fn(async () => {
    await stopped.promise
    alive = false
  })
  holdQuitForSpareEngine(app, { alive: () => alive, stop })
  app.quit()
  app.quit()
  expect(app.quits).toBe(0)
  expect(stop).toHaveBeenCalledOnce()
  stopped.resolve()
  await vi.waitFor(() => expect(app.quits).toBe(1))
  expect(stop).toHaveBeenCalledOnce()
})

test('a stop that fails, or leaves the spare alive, still lets the quit through, once', async () => {
  const app = new FakeApp()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stop = vi.fn(async () => {
    throw new Error('taskkill failed')
  })
  holdQuitForSpareEngine(app, { alive: () => true, stop })
  app.quit()
  await vi.waitFor(() => expect(app.quits).toBe(1))
  expect(stop).toHaveBeenCalledOnce()
  expect(error).toHaveBeenCalled()
  // A later quit (one cancelled elsewhere, then asked again) is not held a second time.
  app.quit()
  expect(app.quits).toBe(2)
  error.mockRestore()
})
