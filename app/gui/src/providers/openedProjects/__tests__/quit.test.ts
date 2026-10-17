import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { closeEachWithin, exitDialogKind, QUIT_CLOSE_TIMEOUT_MS } from '../quit'

describe('closeEachWithin', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('closes all at once, and resolves when all have closed', async () => {
    const started: string[] = []
    let finished = false
    const done = closeEachWithin(['a', 'b'], async (item) => {
      started.push(item)
    }).then(() => (finished = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['a', 'b'])
    await done
    expect(finished).toBe(true)
  })

  test('a project that never closes holds the quit for the timeout only', async () => {
    let finished = false
    void closeEachWithin(['stuck'], () => new Promise(() => {})).then(() => (finished = true))
    await vi.advanceTimersByTimeAsync(QUIT_CLOSE_TIMEOUT_MS - 1)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
  })

  test('a failed close is logged and does not stop the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const closed: string[] = []
    await closeEachWithin(['bad', 'good'], async (item) => {
      if (item === 'bad') throw new Error('boom')
      closed.push(item)
    })
    expect(closed).toEqual(['good'])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  test('a close that throws at once is logged and does not stop the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const closed: string[] = []
    await closeEachWithin(['bad', 'good'], (item) => {
      if (item === 'bad') throw new Error('boom')
      closed.push(item)
      return Promise.resolve()
    })
    expect(closed).toEqual(['good'])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('exitDialogKind', () => {
  test.each([
    [false, false, null],
    [true, false, 'sync'],
    [false, true, 'versions'],
    [true, true, 'both'],
  ] as const)('syncing %s, saving %s → %s', (syncing, saving, kind) => {
    expect(exitDialogKind(syncing, saving)).toBe(kind)
  })
})
