import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDatalink, isAcceptableDatalinkPath, updateDatalink } from '../datalinks.js'
import { listEntriesForTest } from './listEntries.js'

describe('isAcceptableDatalinkPath', () => {
  test.each([
    'C:\\a\\x.datalink',
    'C:/a/x.datalink',
    '\\\\server\\share\\a.datalink',
    '//server/share/a.datalink',
  ])('accepts %s with Windows semantics', (p) =>
    expect(isAcceptableDatalinkPath(p, path.win32)).toBe(true),
  )

  test.each([
    'C:/a/../x.datalink',
    'C:\\a\\.\\x.datalink',
    'C:/a//x.datalink',
    '\\a\\x.datalink',
    'C:a\\x.datalink',
    'a\\x.datalink',
    'C:/a/x.json',
  ])('refuses %s with Windows semantics', (p) =>
    expect(isAcceptableDatalinkPath(p, path.win32)).toBe(false),
  )

  test.each(['/a/x.datalink', '/a b/c/x.datalink', '/a\\b.datalink'])('accepts %s on POSIX', (p) =>
    expect(isAcceptableDatalinkPath(p, path.posix)).toBe(true),
  )

  test.each(['/a/../x.datalink', '/a/./x.datalink', '/a//x.datalink', 'a/x.datalink', '/a/x.txt'])(
    'refuses %s on POSIX',
    (p) => expect(isAcceptableDatalinkPath(p, path.posix)).toBe(false),
  )
})

describe('symlinked datalinks', () => {
  let root: string
  let target: string
  let link: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'datalink-symlink-'))
    target = path.join(root, 'real.datalink')
    link = path.join(root, 'Link.datalink')
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function makeLink(): Promise<boolean> {
    await createDatalink(target, { type: 'S3' })
    try {
      await fs.symlink(target, link)
      return true
    } catch {
      return false // Creating symlinks needs a privilege some Windows accounts lack.
    }
  }

  test('update writes through the link and keeps it', async () => {
    if (!(await makeLink())) return
    await updateDatalink(link, { type: 'HTTP' })
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ type: 'HTTP' })
  })

  test('a symlinked .datalink lists as a datalink', async () => {
    if (!(await makeLink())) return
    const entries = await listEntriesForTest(root)
    expect(entries.find((e) => path.basename(e.path) === 'Link.datalink')?.type).toBe(
      'DatalinkEntry',
    )
  })
})
