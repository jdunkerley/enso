/**
 * @file A training that throws while it starts (here, releasing the training lock) ends as a
 * failed one, so that an announced start is always followed by an end.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { locks } = vi.hoisted(() => ({
  /** The releases `acquireTrainingLock` hands out, in order; a missing one releases quietly. */
  locks: [] as (() => Promise<void>)[],
}))
vi.mock('../lock.js', () => ({
  acquireTrainingLock: async () => locks.shift() ?? (async () => {}),
}))

const { JvmAotCache } = await import('../index.js')

let base: string

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-start-failure-'))
  const engineRoot = path.join(base, 'enso', 'dist', '1.0')
  await fs.mkdir(path.join(engineRoot, 'bin'), { recursive: true })
  await fs.mkdir(path.join(base, 'enso', 'runtime', 'g'), { recursive: true })
  await fs.writeFile(path.join(engineRoot, 'jvm.options'), '-Dx=1\n')
  await fs.writeFile(path.join(engineRoot, 'bin', 'enso'), '')
})

afterEach(async () => {
  locks.length = 0
  vi.restoreAllMocks()
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('a lock release that throws before the training runs ends it as failed', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const onTrainingStarted = vi.fn()
  const onTrainingEnded = vi.fn()
  const train = vi.fn(() => new Promise<void>(() => {}))
  const cache = new JvmAotCache(
    {
      rootDirectory: path.join(base, 'jvm-aot'),
      appVersion: '1',
      ensoExecutable: path.join(base, 'enso', 'dist', '1.0', 'bin', 'enso'),
      isJvmDefault: () => true,
      onTrainingStarted,
      onTrainingEnded,
    },
    { train },
  )
  // The first lock is the launch check's clean-up; the second is the training's, whose release
  // runs because an open starts while it is taken.
  locks.push(
    async () => {},
    async () => {
      throw new Error('the lock file is held')
    },
  )
  const originalShift = locks.shift.bind(locks)
  vi.spyOn(locks, 'shift').mockImplementation(() => {
    if (locks.length === 1) cache.openStarted()
    return originalShift()
  })
  await expect(cache.start()).resolves.toBeUndefined()
  await vi.waitFor(() => expect(onTrainingEnded).toHaveBeenCalledExactlyOnceWith('failed'))
  expect(onTrainingStarted).toHaveBeenCalledOnce()
  expect(train).not.toHaveBeenCalled()
  expect(cache.isTraining()).toBe(false)
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining('training could not start'),
    expect.anything(),
  )
  await cache.dispose()
})
