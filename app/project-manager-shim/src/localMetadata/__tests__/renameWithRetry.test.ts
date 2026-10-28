/**
 * @file `renameWithRetry` against a `rename` that fails as Windows does while another process (a
 * virus scanner, typically) holds the file.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const rename = vi.hoisted(() => ({
  /** The error code `rename` fails with until `lockedUntil`; `undefined` succeeds. */
  code: undefined as string | undefined,
  lockedUntil: 0,
  calls: 0,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: () => {
      rename.calls += 1
      return rename.code && Date.now() < rename.lockedUntil ?
          Promise.reject(Object.assign(new Error('rename failed'), { code: rename.code }))
        : Promise.resolve()
    },
  }
})
const { RENAME_RETRY_BUDGET_MS, renameWithRetry } = await import('../jsonFile.js')

beforeEach(() => {
  vi.useFakeTimers()
  rename.calls = 0
})
afterEach(() => {
  vi.useRealTimers()
  rename.code = undefined
})

/** Lock the file for `ms` from now with `code`. */
function lockFor(ms: number, code = 'EPERM') {
  rename.code = code
  rename.lockedUntil = Date.now() + ms
}

test('a rename blocked for longer than a scan holds a new file still succeeds', async () => {
  // The longest block measured on Windows with real-time protection on was 1.3 s.
  lockFor(1_500)
  const renamed = renameWithRetry('a.tmp', 'a')
  await vi.advanceTimersByTimeAsync(2_000)
  await expect(renamed).resolves.toBeUndefined()
  expect(rename.calls).toBeGreaterThan(1)
})

test.each(['EACCES', 'EBUSY'])('%s is retried too', async (code) => {
  lockFor(500, code)
  const renamed = renameWithRetry('a.tmp', 'a')
  await vi.advanceTimersByTimeAsync(1_000)
  await expect(renamed).resolves.toBeUndefined()
})

test('a lock that outlasts the budget fails with the last error', async () => {
  lockFor(RENAME_RETRY_BUDGET_MS * 10)
  const renamed = renameWithRetry('a.tmp', 'a')
  const failed = expect(renamed).rejects.toMatchObject({ code: 'EPERM' })
  await vi.advanceTimersByTimeAsync(RENAME_RETRY_BUDGET_MS + 1_000)
  await failed
})

test('any other error fails at once', async () => {
  lockFor(RENAME_RETRY_BUDGET_MS * 10, 'ENOENT')
  await expect(renameWithRetry('a.tmp', 'a')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(rename.calls).toBe(1)
})
