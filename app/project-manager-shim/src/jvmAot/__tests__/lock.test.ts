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
    expect((await fs.readFile(path.join(root, 'train.lock'), 'utf8')).trim()).toBe(
      String(process.pid),
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
