/** @file The training lock: one holder at a time, and a dead holder's lock is taken over. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test } from 'vitest'
import { acquireTrainingLock, STALE_LOCK_MS } from '../lock.js'

test('one holder at a time; a dead holder is taken over', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect(await acquireTrainingLock(root)).toBeUndefined()
    await release!()
    const again = await acquireTrainingLock(root)
    expect(again).toBeDefined()
    await again!()
    await fs.writeFile(path.join(root, 'train.lock'), '999999')
    const takenOver = await acquireTrainingLock(root)
    expect(takenOver).toBeDefined()
    expect(await fs.readFile(path.join(root, 'train.lock'), 'utf8')).toMatch(
      new RegExp(`^${process.pid} [0-9a-f-]{36}$`),
    )
    await takenOver!()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('an unreadable lock is taken over', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await fs.writeFile(path.join(root, 'train.lock'), 'not a pid')
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a lock not touched for ten minutes is stale, even when its pid is alive (pid reuse)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    // A live pid (this one), as a reused pid would be.
    await fs.writeFile(file, String(process.pid))
    expect(await acquireTrainingLock(root)).toBeUndefined()
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
    await fs.utimes(file, old, old)
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('two takers of a dead lock: exactly one gets it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await fs.writeFile(path.join(root, 'train.lock'), '999999')
    const results = await Promise.all([acquireTrainingLock(root), acquireTrainingLock(root)])
    // The second taker in this process sees the first's live pid.
    expect(results.filter((r) => r != null)).toHaveLength(1)
    for (const release of results) await release?.()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

/** A lock left by a dead process, last touched long ago. */
async function deadLock(root: string): Promise<string> {
  const file = path.join(root, 'train.lock')
  await fs.writeFile(file, '999999 dead-token')
  const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
  await fs.utimes(file, old, old)
  return file
}

test('two takers of a stale lock interleaved: the later rename finds a fresh lock and gives up', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = await deadLock(root)
    let second: (() => Promise<void>) | undefined
    // A has inspected the stale lock; before A moves it, B takes it over completely.
    const first = await acquireTrainingLock(root, {
      beforeTakeover: async () => {
        second = await acquireTrainingLock(root)
      },
    })
    expect(second).toBeDefined()
    expect(first).toBeUndefined()
    // B's lock is in place (A put it back), and nothing was left aside.
    const held = await fs.readFile(file, 'utf8')
    expect(held).toMatch(new RegExp(`^${process.pid} `))
    expect((await fs.readdir(root)).sort()).toEqual(['train.lock'])
    await second!()
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("a holder whose lock was taken over does not release the new holder's lock", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    const first = await acquireTrainingLock(root)
    expect(first).toBeDefined()
    // The first holder stalled (a laptop asleep): its lock went stale and was taken over.
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
    await fs.utimes(file, old, old)
    const second = await acquireTrainingLock(root)
    expect(second).toBeDefined()
    const secondsLock = await fs.readFile(file, 'utf8')
    await first!()
    expect(await fs.readFile(file, 'utf8')).toBe(secondsLock)
    await second!()
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a takeover deletes locks moved aside long ago, and keeps recent ones', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    const oldAside = path.join(root, 'train.lock.stale-1-1')
    const newAside = path.join(root, 'train.lock.stale-2-2')
    await fs.writeFile(oldAside, '1 x')
    await fs.writeFile(newAside, '2 y')
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
    await fs.utimes(oldAside, old, old)
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect((await fs.readdir(root)).sort()).toEqual(['train.lock', 'train.lock.stale-2-2'])
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
