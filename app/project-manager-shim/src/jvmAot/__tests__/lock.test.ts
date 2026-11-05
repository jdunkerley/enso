/** @file The training lock: one holder at a time, and a dead holder's lock is taken over. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { expect, test } from 'vitest'
import { acquireTrainingLock } from '../lock.js'

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
