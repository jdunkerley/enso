import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PANEL_QUIET_CAP_MS, PANEL_QUIET_MS, panelQuiet } from '../panelQuiet'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

/** A panel in the document, with an open shadow root inside it. */
function panelWithShadow(): { panel: HTMLElement; shadow: ShadowRoot } {
  const panel = document.createElement('div')
  const host = document.createElement('div')
  panel.append(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(document.createElement('span'))
  document.body.append(panel)
  return { panel, shadow }
}

/** Whether `promise` has resolved, after the queued microtasks have run. */
async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false
  void promise.then(() => (done = true))
  await vi.advanceTimersByTimeAsync(0)
  return done
}

test('a quiet panel resolves after the quiet period', async () => {
  const { panel } = panelWithShadow()
  const quiet = panelQuiet(panel, 10_000)
  await vi.advanceTimersByTimeAsync(PANEL_QUIET_MS - 1)
  expect(await settled(quiet)).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await settled(quiet)).toBe(true)
})

test('a mutation inside a shadow root restarts the quiet period', async () => {
  const { panel, shadow } = panelWithShadow()
  const quiet = panelQuiet(panel, 10_000)
  await vi.advanceTimersByTimeAsync(PANEL_QUIET_MS - 50)
  shadow.append(document.createElement('span'))
  await vi.advanceTimersByTimeAsync(PANEL_QUIET_MS - 50)
  expect(await settled(quiet)).toBe(false)
  await vi.advanceTimersByTimeAsync(50)
  expect(await settled(quiet)).toBe(true)
})

test('a shadow root on a node added after the start is watched too', async () => {
  const { panel } = panelWithShadow()
  const quiet = panelQuiet(panel, 10_000)
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })
  panel.append(host)
  await vi.advanceTimersByTimeAsync(PANEL_QUIET_MS - 50)
  shadow.append(document.createElement('span'))
  await vi.advanceTimersByTimeAsync(PANEL_QUIET_MS - 50)
  expect(await settled(quiet)).toBe(false)
  await vi.advanceTimersByTimeAsync(50)
  expect(await settled(quiet)).toBe(true)
})

test('continuous mutation ends at the cap', async () => {
  const { panel, shadow } = panelWithShadow()
  const quiet = panelQuiet(panel, 10_000)
  let elapsed = 0
  while (elapsed < PANEL_QUIET_CAP_MS - 100) {
    shadow.append(document.createElement('span'))
    await vi.advanceTimersByTimeAsync(100)
    elapsed += 100
  }
  expect(await settled(quiet)).toBe(false)
  shadow.append(document.createElement('span'))
  await vi.advanceTimersByTimeAsync(100)
  expect(await settled(quiet)).toBe(true)
})

test('the budget caps the wait', async () => {
  const { panel, shadow } = panelWithShadow()
  const quiet = panelQuiet(panel, 500)
  for (let elapsed = 0; elapsed < 400; elapsed += 100) {
    shadow.append(document.createElement('span'))
    await vi.advanceTimersByTimeAsync(100)
  }
  expect(await settled(quiet)).toBe(false)
  shadow.append(document.createElement('span'))
  await vi.advanceTimersByTimeAsync(100)
  expect(await settled(quiet)).toBe(true)
})

test('a missing or disconnected panel resolves at once', async () => {
  expect(await settled(panelQuiet(undefined, 10_000))).toBe(true)
  expect(await settled(panelQuiet(document.createElement('div'), 10_000))).toBe(true)
})
