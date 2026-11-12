/** @file The training lock: one holder at a time, and a dead holder's lock is taken over. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test, vi } from 'vitest'
import { acquireTrainingLock, STALE_LOCK_MS, STALE_TAKEOVER_MS } from '../lock.js'

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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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

test('a taker that finds a takeover under way gives up, and the lock is never missing (#603)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = await deadLock(root)
    let second: (() => Promise<void>) | undefined = undefined
    let lockDuringTakeover: string | undefined
    // A has taken the takeover file and inspected the stale lock; B (and C) try now.
    const first = await acquireTrainingLock(root, {
      beforeTakeover: async () => {
        second = await acquireTrainingLock(root)
        lockDuringTakeover = await fs.readFile(file, 'utf8')
        expect(await acquireTrainingLock(root)).toBeUndefined()
      },
    })
    expect(second).toBeUndefined()
    expect(first).toBeDefined()
    // The stale lock was still in place while A worked; nothing was moved aside.
    expect(lockDuringTakeover).toBe('999999 dead-token')
    expect(await fs.readFile(file, 'utf8')).toMatch(new RegExp(`^${process.pid} `))
    expect((await fs.readdir(root)).sort()).toEqual(['train.lock'])
    await first!()
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a takeover file left by a dead taker does not block takeovers (#603)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    await fs.writeFile(path.join(root, 'train.lock.takeover'), '999999 crashed-taker')
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect((await fs.readdir(root)).sort()).toEqual(['train.lock'])
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a live takeover file, recently touched, makes a taker give up (#603)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    const takeover = path.join(root, 'train.lock.takeover')
    await fs.writeFile(takeover, `${process.pid} another-taker`)
    expect(await acquireTrainingLock(root)).toBeUndefined()
    // Neither file was touched.
    expect(await fs.readFile(path.join(root, 'train.lock'), 'utf8')).toBe('999999 dead-token')
    expect(await fs.readFile(takeover, 'utf8')).toBe(`${process.pid} another-taker`)
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test("a release while its stale lock is being taken over leaves the taker's lock (#603)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    const first = await acquireTrainingLock(root)
    expect(first).toBeDefined()
    // The first holder stalled; its lock went stale, and a taker is part-way through.
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
    await fs.utimes(file, old, old)
    let releasing: Promise<void> | undefined
    const second = await acquireTrainingLock(root, {
      beforeTakeover: async () => {
        // The first holder wakes up and releases, between the taker's check and its act.
        releasing = first!()
        await new Promise((resolve) => setTimeout(resolve, 50))
      },
    })
    await releasing
    expect(second).toBeDefined()
    expect(await fs.readFile(file, 'utf8')).toMatch(new RegExp(`^${process.pid} `))
    await second!()
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a takeover file still being written is held, not stale (review of #603, M1)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    // Created by the exclusive open, its content not written yet.
    const takeover = path.join(root, 'train.lock.takeover')
    await fs.writeFile(takeover, '')
    expect(await acquireTrainingLock(root)).toBeUndefined()
    expect(await fs.readFile(takeover, 'utf8')).toBe('')
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a file is linked into place complete, and created anyway where links are refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect(await fs.readdir(root)).toEqual(['train.lock'])
    await release!()
    const refuse = async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    }
    await deadLock(root)
    const fallback = await acquireTrainingLock(root, { link: refuse })
    expect(fallback).toBeDefined()
    expect(await fs.readFile(path.join(root, 'train.lock'), 'utf8')).toMatch(
      new RegExp(`^${process.pid} `),
    )
    expect(await fs.readdir(root)).toEqual(['train.lock'])
    await fallback!()
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a takeover file older than 30 s is stale even when its pid is alive (review of #603, M2)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    const takeover = path.join(root, 'train.lock.takeover')
    // A crashed taker's pid, reused by a live process (this one).
    await fs.writeFile(takeover, `${process.pid} crashed-taker`)
    expect(await acquireTrainingLock(root)).toBeUndefined()
    // A minute: long past a takeover's few milliseconds, far short of the lock's ten minutes.
    expect(STALE_TAKEOVER_MS).toBeLessThan(60_000)
    const old = new Date(Date.now() - 60_000)
    await fs.utimes(takeover, old, old)
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect(await fs.readdir(root)).toEqual(['train.lock'])
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a release that cannot get the takeover file gives up and leaves its lock (M3)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    const release = await acquireTrainingLock(root, { releaseAttempts: 2 })
    expect(release).toBeDefined()
    const ours = await fs.readFile(file, 'utf8')
    await fs.writeFile(path.join(root, 'train.lock.takeover'), `${process.pid} another-taker`)
    await release!()
    // Not deleted without the takeover file: that would be the check-then-act of #603.
    expect(await fs.readFile(file, 'utf8')).toBe(ours)
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a heartbeat skips while the takeover file is held, and touches the lock after (M3)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    const takeover = path.join(root, 'train.lock.takeover')
    const release = await acquireTrainingLock(root, { heartbeatMs: 20 })
    expect(release).toBeDefined()
    const old = new Date(Date.now() - 60_000)
    await fs.utimes(file, old, old)
    await fs.writeFile(takeover, `${process.pid} another-taker`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect((await fs.stat(file)).mtimeMs).toBe(old.getTime())
    await fs.rm(takeover)
    await vi.waitFor(async () =>
      expect((await fs.stat(file)).mtimeMs).toBeGreaterThan(old.getTime()),
    )
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test("no takeover lands between a release's token check and its delete (#603 item 2)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const file = path.join(root, 'train.lock')
    let taker: (() => Promise<void>) | undefined | 'not run' = 'not run'
    const release = await acquireTrainingLock(root, {
      beforeReleaseAct: async () => {
        // The holder has checked that the lock is its own, and stalled: its lock went stale, and
        // a taker tries now. Unserialised, the taker would replace the lock and the holder's
        // `rm` would then delete the taker's.
        const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
        await fs.utimes(file, old, old)
        taker = await acquireTrainingLock(root)
      },
    })
    expect(release).toBeDefined()
    await release!()
    expect(taker).toBeUndefined()
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('a lock and a takeover file are linked into place, never created in place', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    const linked: { target: string; whole: boolean; absent: boolean }[] = []
    const link = async (existing: string, target: string) => {
      const content = await fs.readFile(existing, 'utf8')
      const absent = await fs.access(target).then(
        () => false,
        () => true,
      )
      linked.push({ target: path.basename(target), whole: /^\d+ \S+$/.test(content), absent })
      await fs.link(existing, target)
    }
    const release = await acquireTrainingLock(root, { link })
    expect(release).toBeDefined()
    // Complete when it appears, and the name was free: a plain `wx` create would never call this.
    expect(linked).toEqual([{ target: 'train.lock', whole: true, absent: true }])
    await release!()
    // The release takes the takeover file, linked the same way.
    expect(linked.map((entry) => entry.target)).toEqual(['train.lock', 'train.lock.takeover'])
    expect(linked.every((entry) => entry.whole && entry.absent)).toBe(true)
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('where links are refused, an empty takeover file replaced while it was judged stale is not removed (review of #610, N2b)', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    const takeover = path.join(root, 'train.lock.takeover')
    // A crashed taker's: empty, and older than the 5 s of a write in progress.
    await fs.writeFile(takeover, '')
    const old = new Date(Date.now() - 20_000)
    await fs.utimes(takeover, old, old)
    const refuse = async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    }
    const result = await acquireTrainingLock(root, {
      link: refuse,
      // Another taker, in the same moment, replaces it with its own, empty for a moment.
      beforeStaleTakeoverRemoval: async () => {
        await fs.rm(takeover)
        await fs.writeFile(takeover, '')
      },
    })
    expect(result).toBeUndefined()
    expect(await fs.readFile(takeover, 'utf8')).toBe('')
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test("a takeover deletes only the lock's own old files, not other files with .new- in the name (review of #610, N4)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-lock-'))
  try {
    await deadLock(root)
    const ours = path.join(root, 'train.lock.new-1-x')
    const other = path.join(root, 'cache.new-1-x')
    await fs.writeFile(ours, '1 x')
    await fs.writeFile(other, 'data')
    const old = new Date(Date.now() - STALE_LOCK_MS - 60_000)
    await fs.utimes(ours, old, old)
    await fs.utimes(other, old, old)
    const release = await acquireTrainingLock(root)
    expect(release).toBeDefined()
    expect((await fs.readdir(root)).sort()).toEqual(['cache.new-1-x', 'train.lock'])
    await release!()
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
