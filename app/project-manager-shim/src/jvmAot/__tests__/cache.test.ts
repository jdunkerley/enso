/** @file The AOT cache manager with a fake trainer: when it trains, yields, uses and deletes. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { JvmAotCache, type JvmAotCacheSettings, type Trainer } from '../index.js'

class FakeTrainer implements Trainer {
  runs: {
    output: string
    signal: AbortSignal
    finish: () => Promise<void>
    fail: () => void
  }[] = []
  train(output: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      this.runs.push({
        output,
        signal,
        finish: async () => {
          await fs.mkdir(path.dirname(output), { recursive: true })
          await fs.writeFile(output, 'cache')
          resolve()
        },
        fail: () => reject(new Error('the engine crashed')),
      })
    })
  }
}

let root: string
let bundle: string
const caches: JvmAotCache[] = []

/** A temp tree that `enginePaths` accepts: enso/dist/1.0/bin/enso, enso/runtime/g/, jvm.options. */
async function fakeBundle(directory: string): Promise<string> {
  const engineRoot = path.join(directory, 'enso', 'dist', '1.0')
  await fs.mkdir(path.join(engineRoot, 'bin'), { recursive: true })
  await fs.mkdir(path.join(directory, 'enso', 'runtime', 'g'), { recursive: true })
  await fs.writeFile(path.join(engineRoot, 'jvm.options'), '-Dx=1\n')
  const enso = path.join(engineRoot, 'bin', 'enso')
  await fs.writeFile(enso, '')
  return enso
}

function cache(trainer: FakeTrainer, settings: Partial<JvmAotCacheSettings> = {}): JvmAotCache {
  const created = new JvmAotCache(
    {
      rootDirectory: root,
      appVersion: '1',
      ensoExecutable: bundle,
      isJvmDefault: () => true,
      ...settings,
    },
    trainer,
  )
  caches.push(created)
  return created
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

/** Start a cache and finish its training; returns its key directory. */
async function trained(trainer: FakeTrainer, created: JvmAotCache): Promise<string> {
  await created.start()
  await trainer.runs.at(-1)!.finish()
  await vi.waitFor(async () => expect(await created.jvmOptions()).toHaveLength(2))
  return (await created.keyDirectory())!
}

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-cache-'))
  root = path.join(base, 'jvm-aot')
  bundle = await fakeBundle(base)
})

afterEach(async () => {
  for (const created of caches.splice(0)) await created.dispose()
  vi.useRealTimers()
  await fs.rm(path.dirname(root), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('trains at launch when the JVM is the default, and uses the cache after', async () => {
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  expect(trainer.runs).toHaveLength(1)
  expect(trainer.runs[0]!.output).toBe(path.join((await created.keyDirectory())!, 'enso.aot'))
  expect(await created.jvmOptions()).toEqual([])
  await trainer.runs[0]!.finish()
  await vi.waitFor(async () => expect(await created.jvmOptions()).toHaveLength(2))
  const [aot, log] = await created.jvmOptions()
  expect(aot).toBe(`-XX:AOTCache=${trainer.runs[0]!.output}`)
  expect(log).toBe(
    `-Xlog:aot=warning,cds=warning:file="${path.join((await created.keyDirectory())!, 'use.log')}"::filecount=0`,
  )
  // The lock is released once the training is over.
  await vi.waitFor(async () => expect(await exists(path.join(root, 'train.lock'))).toBe(false))
})

test('no training when the default is native', async () => {
  const trainer = new FakeTrainer()
  await cache(trainer, { isJvmDefault: () => false }).start()
  expect(trainer.runs).toHaveLength(0)
})

test('no training when the cache exists', async () => {
  const first = new FakeTrainer()
  await trained(first, cache(first))
  const second = new FakeTrainer()
  await cache(second).start()
  expect(second.runs).toHaveLength(0)
})

test('no cache and no training for a translocated app or a bundle without a runtime', async () => {
  const translocated = path.join(path.dirname(root), 'x', 'AppTranslocation', 'y')
  const trainer = new FakeTrainer()
  const created = cache(trainer, { ensoExecutable: await fakeBundle(translocated) })
  await created.start()
  expect(trainer.runs).toHaveLength(0)
  expect(await created.keyDirectory()).toBeUndefined()
  expect(await created.jvmOptions()).toEqual([])

  await fs.rm(path.join(path.dirname(root), 'enso', 'runtime'), { recursive: true })
  const noRuntime = cache(trainer)
  await noRuntime.start()
  expect(trainer.runs).toHaveLength(0)
  expect(await noRuntime.jvmOptions()).toEqual([])
})

test('no cache and no training for an engine in an AppImage mount', async () => {
  // A new mount at every launch: a cache trained there would be useless at the next one.
  const mounted = path.join(path.dirname(root), 'tmp', '.mount_enso-abc123', 'resources')
  const trainer = new FakeTrainer()
  const created = cache(trainer, { ensoExecutable: await fakeBundle(mounted) })
  await created.start()
  expect(trainer.runs).toHaveLength(0)
  expect(await created.keyDirectory()).toBeUndefined()
  expect(await created.jvmOptions()).toEqual([])
})

test('no training while another live process holds the lock', async () => {
  await fs.mkdir(root, { recursive: true })
  // This test's own pid is alive.
  await fs.writeFile(path.join(root, 'train.lock'), String(process.pid))
  const trainer = new FakeTrainer()
  await cache(trainer).start()
  expect(trainer.runs).toHaveLength(0)
})

test('an open kills the training; it restarts 60 s after the last answer', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  created.openStarted()
  expect(trainer.runs[0]!.signal.aborted).toBe(true)
  // The killed training's lock is released (real file I/O, outside the fake clock).
  await vi.waitFor(async () => expect(await exists(path.join(root, 'train.lock'))).toBe(false))
  created.openAnswered()
  await vi.advanceTimersByTimeAsync(30_000)
  created.openStarted()
  created.openAnswered()
  await vi.advanceTimersByTimeAsync(59_000)
  expect(trainer.runs).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2_000)
  await vi.waitFor(() => expect(trainer.runs).toHaveLength(2))
})

test('no restart while an open is still in flight', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  created.openStarted()
  created.openStarted()
  created.openAnswered()
  // The killed training's lock is released (real file I/O, outside the fake clock).
  await vi.waitFor(async () => expect(await exists(path.join(root, 'train.lock'))).toBe(false))
  await vi.advanceTimersByTimeAsync(120_000)
  expect(trainer.runs).toHaveLength(1)
  created.openAnswered()
  await vi.advanceTimersByTimeAsync(61_000)
  await vi.waitFor(() => expect(trainer.runs).toHaveLength(2))
})

test('a finished training is not restarted by an open', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await trained(trainer, created)
  created.openStarted()
  created.openAnswered()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(trainer.runs).toHaveLength(1)
})

test('a use.log naming a mismatch deletes the cache', async () => {
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  const dir = await trained(trainer, created)
  await fs.writeFile(
    path.join(dir, 'use.log'),
    '[0.012s][warning][aot] The AOT cache was created by a different version or build\n',
  )
  await created.checkUseLog()
  expect(await created.jvmOptions()).toEqual([])
  expect(await exists(path.join(dir, 'enso.aot'))).toBe(false)
})

test('an empty or info-only use.log keeps the cache', async () => {
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  const dir = await trained(trainer, created)
  await created.checkUseLog()
  await fs.writeFile(path.join(dir, 'use.log'), '')
  await created.checkUseLog()
  await fs.writeFile(path.join(dir, 'use.log'), '[0.01s][info][aot] Opened AOT cache\n')
  await created.checkUseLog()
  expect(await created.jvmOptions()).toHaveLength(2)
})

/** A key directory of another install or version, last used at `usedAt` (ms since the epoch). */
async function otherKey(name: string, usedAt: number): Promise<string> {
  const directory = path.join(root, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'enso.aot'), 'old')
  await fs.writeFile(path.join(directory, 'use.log'), '')
  const time = new Date(usedAt)
  await fs.utimes(path.join(directory, 'use.log'), time, time)
  return directory
}

test('a finished training keeps the most recently used other key and deletes the rest', async () => {
  const older = await otherKey('00000000000000aa', Date.now() - 3 * 86_400_000)
  const newer = await otherKey('00000000000000bb', Date.now() - 86_400_000)
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  const dir = await trained(trainer, created)
  await vi.waitFor(async () => expect(await exists(older)).toBe(false))
  expect(await exists(newer)).toBe(true)
  expect(await exists(path.join(dir, 'enso.aot'))).toBe(true)
})

test('nothing in the root but key directories is ever deleted', async () => {
  // `ENSO_JVM_AOT_DIR` may name a directory that holds other things.
  await fs.mkdir(path.join(root, 'notes'), { recursive: true })
  await fs.writeFile(path.join(root, 'notes', 'keep.txt'), 'mine')
  await fs.writeFile(path.join(root, 'readme.txt'), 'mine')
  await fs.mkdir(path.join(root, 'train'), { recursive: true })
  await fs.mkdir(path.join(root, '0123456789ABCDEF'), { recursive: true })
  await otherKey('00000000000000aa', Date.now() - 3 * 86_400_000)
  await otherKey('00000000000000bb', Date.now() - 86_400_000)
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await trained(trainer, created)
  await vi.waitFor(async () =>
    expect(await exists(path.join(root, '00000000000000aa'))).toBe(false),
  )
  for (const kept of ['notes/keep.txt', 'readme.txt', 'train', '0123456789ABCDEF']) {
    expect(await exists(path.join(root, kept))).toBe(true)
  }
})

test('a failed training is not retried after opens, only at the next launch', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  trainer.runs[0]!.fail()
  await vi.waitFor(async () => expect(await exists(path.join(root, 'train.lock'))).toBe(false))
  created.openStarted()
  created.openAnswered()
  await vi.advanceTimersByTimeAsync(61_000)
  expect(trainer.runs).toHaveLength(1)
  // The next launch tries again.
  await cache(trainer).start()
  expect(trainer.runs).toHaveLength(2)
})

test('a quit during a training leaves nothing that the next launch keeps', async () => {
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  const output = trainer.runs[0]!.output
  // What a killed `java -XX:AOTMode=create` and recording engine leave.
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(`${output}.tmp`, 'partial')
  await fs.writeFile(`${output}.aotconf`, 'partial')
  await created.dispose()
  await cache(trainer).start()
  expect(await exists(`${output}.tmp`)).toBe(false)
  expect(await exists(`${output}.aotconf`)).toBe(false)
})

test('the key moves with the app version', async () => {
  const one = cache(new FakeTrainer(), { appVersion: '1' })
  const two = cache(new FakeTrainer(), { appVersion: '2' })
  expect(await one.keyDirectory()).not.toBe(await two.keyDirectory())
  expect(path.dirname((await one.keyDirectory())!)).toBe(root)
})

test('dispose stops a running training at once, before it awaits anything', async () => {
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  await created.start()
  const disposed = created.dispose()
  expect(trainer.runs[0]!.signal.aborted).toBe(true)
  await disposed
  expect(await exists(path.join(root, 'train.lock'))).toBe(false)
})

test('isTraining: from the launch check, through an open and the wait to restart, until a cache is made', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const trainer = new FakeTrainer()
  const created = cache(trainer)
  expect(created.isTraining()).toBe(false)
  const starting = created.start()
  // Looking for the cache, before anything is known.
  expect(created.isTraining()).toBe(true)
  await starting
  expect(created.isTraining()).toBe(true)
  created.openStarted()
  created.openAnswered()
  // Killed by the open, waiting to restart: still to come.
  await vi.waitFor(async () => expect(await exists(path.join(root, 'train.lock'))).toBe(false))
  expect(created.isTraining()).toBe(true)
  await vi.advanceTimersByTimeAsync(61_000)
  await vi.waitFor(() => expect(trainer.runs).toHaveLength(2))
  expect(created.isTraining()).toBe(true)
  await trainer.runs[1]!.finish()
  await vi.waitFor(() => expect(created.isTraining()).toBe(false))
})

test('isTraining is false with a cache, the native default, after a failed training, and after a quit', async () => {
  const first = new FakeTrainer()
  const withCache = cache(first)
  await trained(first, withCache)
  expect(withCache.isTraining()).toBe(false)
  const again = cache(new FakeTrainer())
  await again.start()
  expect(again.isTraining()).toBe(false)

  const native = cache(new FakeTrainer(), { isJvmDefault: () => false })
  await native.start()
  expect(native.isTraining()).toBe(false)

  await fs.rm(path.join(root), { recursive: true, force: true })
  const failing = new FakeTrainer()
  const failed = cache(failing)
  await failed.start()
  failing.runs[0]!.fail()
  await vi.waitFor(() => expect(failed.isTraining()).toBe(false))

  const quitting = new FakeTrainer()
  const quit = cache(quitting)
  await fs.rm(path.join(root), { recursive: true, force: true })
  await quit.start()
  expect(quit.isTraining()).toBe(true)
  await quit.dispose()
  expect(quit.isTraining()).toBe(false)
})
