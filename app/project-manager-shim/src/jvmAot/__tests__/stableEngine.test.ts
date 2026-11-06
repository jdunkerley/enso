/** @file The Linux AppImage's copy of the bundled engine, at a path that survives remounts. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  readyStableEngine,
  stableEnginePath,
  type StableEngineHooks,
  type StableEngineOptions,
} from '../stableEngine.js'

let base: string
let options: StableEngineOptions

/** A bundle as the AppImage mounts it: `.enso.bundle`, `dist/<version>/`, `runtime/<jdk>/`. */
async function fakeBundle(root: string, launcher = 'launcher-1'): Promise<void> {
  const engineRoot = path.join(root, 'dist', '1.0')
  await fs.mkdir(path.join(engineRoot, 'bin'), { recursive: true })
  await fs.mkdir(path.join(engineRoot, 'component'), { recursive: true })
  await fs.mkdir(path.join(engineRoot, 'lib', 'Standard'), { recursive: true })
  await fs.mkdir(path.join(root, 'runtime', 'graalvm-x', 'bin'), { recursive: true })
  await fs.writeFile(path.join(root, '.enso.bundle'), '')
  await fs.writeFile(path.join(engineRoot, 'bin', 'enso'), launcher, { mode: 0o755 })
  await fs.writeFile(path.join(engineRoot, 'component', 'runtime.jar'), 'jar')
  await fs.writeFile(path.join(engineRoot, 'lib', 'Standard', 'Base.enso'), 'base')
  await fs.writeFile(path.join(root, 'runtime', 'graalvm-x', 'bin', 'java'), 'java', {
    mode: 0o755,
  })
  // A squashfs keeps the build's times; the copy must keep them too (the AOT cache checks them).
  const built = new Date('2026-01-02T03:04:05Z')
  await fs.utimes(path.join(engineRoot, 'component', 'runtime.jar'), built, built)
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

const engineDirectory = () => path.join(options.userData, 'engine')
const copiedLauncher = (version = '2026.2.0') =>
  path.join(engineDirectory(), version, 'dist', '1.0', 'bin', 'enso')

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'stable-engine-')))
  options = {
    userData: path.join(base, 'userData'),
    version: '2026.2.0',
    bundleRoot: path.join(base, 'mount-a', 'resources', 'enso'),
  }
  await fakeBundle(options.bundleRoot)
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('copies the bundle once, marker and times included, and returns its launcher', async () => {
  expect(await readyStableEngine(options)).toBeUndefined()
  const launcher = await stableEnginePath(options)
  expect(launcher).toBe(copiedLauncher())
  expect(await fs.readFile(launcher, 'utf8')).toBe('launcher-1')
  if (process.platform !== 'win32') {
    expect((await fs.stat(launcher)).mode & 0o111).not.toBe(0)
  }
  const copy = path.join(engineDirectory(), '2026.2.0')
  // Without the marker the launcher does not find the bundled runtime.
  expect(await exists(path.join(copy, '.enso.bundle'))).toBe(true)
  expect(await exists(path.join(copy, 'runtime', 'graalvm-x', 'bin', 'java'))).toBe(true)
  expect(await exists(path.join(copy, 'dist', '1.0', 'lib', 'Standard', 'Base.enso'))).toBe(true)
  const jar = path.join('dist', '1.0', 'component', 'runtime.jar')
  expect((await fs.stat(path.join(copy, jar))).mtimeMs).toBe(
    (await fs.stat(path.join(options.bundleRoot, jar))).mtimeMs,
  )
  expect(await readyStableEngine(options)).toBe(launcher)
})

test('a second call, from another mount of the same build, reuses the copy', async () => {
  await stableEnginePath(options)
  const sentinel = path.join(engineDirectory(), '2026.2.0', 'sentinel')
  await fs.writeFile(sentinel, '')
  // A remount: the same files at a new path, with the same times.
  const remount = path.join(base, 'mount-b', 'resources', 'enso')
  await fs.cp(options.bundleRoot, remount, { recursive: true, preserveTimestamps: true })
  const again = { ...options, bundleRoot: remount }
  expect(await readyStableEngine(again)).toBe(copiedLauncher())
  expect(await stableEnginePath(again)).toBe(copiedLauncher())
  expect(await exists(sentinel)).toBe(true)
})

test('a changed bundle with the same version (a dev build) is copied again', async () => {
  await stableEnginePath(options)
  const sentinel = path.join(engineDirectory(), '2026.2.0', 'sentinel')
  await fs.writeFile(sentinel, '')
  const rebuilt = path.join(base, 'mount-c', 'resources', 'enso')
  await fakeBundle(rebuilt, 'launcher-2-longer')
  const next = { ...options, bundleRoot: rebuilt }
  expect(await readyStableEngine(next)).toBeUndefined()
  const launcher = await stableEnginePath(next)
  expect(await fs.readFile(launcher, 'utf8')).toBe('launcher-2-longer')
  expect(await exists(sentinel)).toBe(false)
})

test('an interrupted copy (no marker) is redone, and its leftovers go', async () => {
  const partial = path.join(engineDirectory(), '2026.2.0')
  await fs.mkdir(path.join(partial, 'dist'), { recursive: true })
  const leftover = path.join(engineDirectory(), '.2026.2.0-abc123.tmp')
  await fs.mkdir(leftover, { recursive: true })
  expect(await readyStableEngine(options)).toBeUndefined()
  const launcher = await stableEnginePath(options)
  expect(await fs.readFile(launcher, 'utf8')).toBe('launcher-1')
  expect(await exists(leftover)).toBe(false)
})

test('other versions go, except the most recently used one', async () => {
  for (const [version, usedAt] of [
    ['2026.1.0', new Date('2026-03-01T00:00:00Z')],
    ['2025.9.0', new Date('2025-10-01T00:00:00Z')],
  ] as const) {
    await stableEnginePath({ ...options, version })
    const marker = path.join(engineDirectory(), version, '.complete')
    await fs.utimes(marker, usedAt, usedAt)
  }
  await stableEnginePath(options)
  expect((await fs.readdir(engineDirectory())).sort()).toEqual(['2026.1.0', '2026.2.0'])
})

test('a rebuilt launcher of the same size, with a new mtime, is copied again', async () => {
  await stableEnginePath(options)
  const launcher = path.join(options.bundleRoot, 'dist', '1.0', 'bin', 'enso')
  const later = new Date('2026-06-01T00:00:00Z')
  await fs.utimes(launcher, later, later)
  expect(await readyStableEngine(options)).toBeUndefined()
})

const GIB = 1024 ** 3

/** Hooks with plenty of space, no engine running and the real copy, counting copies. */
function hooks(overrides: Partial<StableEngineHooks> = {}): StableEngineHooks & { copies: number } {
  const counted = {
    copies: 0,
    freeBytes: async () => 100 * GIB,
    isInUse: async () => false,
    now: () => Date.now(),
    ...overrides,
  }
  const copy =
    overrides.copy ?? ((from: string, to: string) => fs.cp(from, to, { recursive: true }))
  return {
    ...counted,
    copy: async (from, to) => {
      counted.copies += 1
      await copy(from, to)
    },
    get copies() {
      return counted.copies
    },
  }
}

test('a failed copy leaves no temporary directory, and is not retried until a day has passed', async () => {
  let now = Date.parse('2026-06-01T00:00:00Z')
  const failing = hooks({
    now: () => now,
    copy: async (_from, to) => {
      await fs.mkdir(path.join(to, 'dist'), { recursive: true })
      throw new Error('ENOSPC: no space left on device')
    },
  })
  await expect(stableEnginePath(options, failing)).rejects.toThrow(/ENOSPC/)
  expect(await fs.readdir(engineDirectory())).toEqual(['.failed.json'])
  await expect(stableEnginePath(options, failing)).rejects.toThrow(/not retried/)
  expect(failing.copies).toBe(1)
  now += 25 * 60 * 60 * 1000
  const working = hooks({ now: () => now })
  expect(await stableEnginePath(options, working)).toBe(copiedLauncher())
  expect(working.copies).toBe(1)
  // A success forgets the failure.
  expect(await fs.readdir(engineDirectory())).toEqual(['2026.2.0'])
})

test('a failure of one build does not hold back a new build', async () => {
  const failing = hooks({
    copy: async () => {
      throw new Error('EIO')
    },
  })
  await expect(stableEnginePath(options, failing)).rejects.toThrow(/EIO/)
  const rebuilt = path.join(base, 'mount-d', 'resources', 'enso')
  await fakeBundle(rebuilt, 'launcher-2-longer')
  const working = hooks()
  await stableEnginePath({ ...options, bundleRoot: rebuilt }, working)
  expect(working.copies).toBe(1)
})

test('without room for the bundle plus 1 GiB, nothing is copied and the failure is recorded', async () => {
  const short = hooks({ freeBytes: async () => GIB })
  await expect(stableEnginePath(options, short)).rejects.toThrow(/free/)
  expect(short.copies).toBe(0)
  await expect(stableEnginePath(options, hooks())).rejects.toThrow(/not retried/)
})

test('when space is short, other copies go first, then the copy is made', async () => {
  await stableEnginePath({ ...options, version: '2026.1.0' })
  const other = path.join(engineDirectory(), '2026.1.0')
  const tight = hooks({
    freeBytes: async () =>
      (
        (await fs.access(other).then(
          () => true,
          () => false,
        ))
      ) ?
        GIB
      : 2 * GIB,
  })
  expect(await stableEnginePath(options, tight)).toBe(copiedLauncher())
  expect(await fs.readdir(engineDirectory())).toEqual(['2026.2.0'])
})

test('a copy whose engine is still running is not deleted', async () => {
  for (const version of ['2026.1.0', '2025.9.0']) {
    await stableEnginePath({ ...options, version })
  }
  const running = path.join(engineDirectory(), '2025.9.0')
  const old = new Date('2020-01-01T00:00:00Z')
  await fs.utimes(path.join(running, '.complete'), old, old)
  await stableEnginePath(options, hooks({ isInUse: async (directory) => directory === running }))
  expect((await fs.readdir(engineDirectory())).sort()).toEqual(['2025.9.0', '2026.1.0', '2026.2.0'])
})

test('a stale copy with a read-only directory is replaced', async () => {
  const stale = path.join(engineDirectory(), '2026.2.0', 'dist', 'locked')
  await fs.mkdir(stale, { recursive: true })
  await fs.writeFile(path.join(stale, 'file'), '')
  await fs.chmod(stale, 0o555)
  expect(await stableEnginePath(options)).toBe(copiedLauncher())
  expect(await fs.readFile(copiedLauncher(), 'utf8')).toBe('launcher-1')
})
