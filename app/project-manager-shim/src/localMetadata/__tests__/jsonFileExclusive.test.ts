import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const linkFails = vi.hoisted(() => ({ code: undefined as string | undefined }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: (...args: Parameters<typeof actual.link>) =>
      linkFails.code ?
        Promise.reject(Object.assign(new Error('link failed'), { code: linkFails.code }))
      : actual.link(...args),
  }
})
const { writeJsonExclusive } = await import('../jsonFile.js')

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'json-exclusive-'))
})
afterEach(async () => {
  linkFails.code = undefined
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('without hard links the write falls back to an exclusive open', async () => {
  linkFails.code = 'EPERM'
  const file = path.join(root, 'a.datalink')
  await writeJsonExclusive(file, { a: 1 })
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ a: 1 })
  expect(await fs.readdir(root)).toEqual(['a.datalink'])
})

test('the fallback still refuses an existing file and leaves it alone', async () => {
  linkFails.code = 'EPERM'
  const file = path.join(root, 'a.datalink')
  await fs.writeFile(file, 'mine')
  await expect(writeJsonExclusive(file, { a: 1 })).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await fs.readFile(file, 'utf8')).toBe('mine')
  expect(await fs.readdir(root)).toEqual(['a.datalink'])
})

test('EISDIR from the link (exFAT and FAT32 on Windows) also falls back', async () => {
  linkFails.code = 'EISDIR'
  const file = path.join(root, 'a.datalink')
  await writeJsonExclusive(file, { a: 1 })
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ a: 1 })
  expect(await fs.readdir(root)).toEqual(['a.datalink'])
})

test('the fallback refuses a directory at the target and leaves it alone', async () => {
  linkFails.code = 'EISDIR'
  const file = path.join(root, 'a.datalink')
  await fs.mkdir(file)
  await fs.writeFile(path.join(file, 'inner'), 'mine')
  await expect(writeJsonExclusive(file, { a: 1 })).rejects.toMatchObject({ code: 'EEXIST' })
  expect((await fs.stat(file)).isDirectory()).toBe(true)
  expect(await fs.readFile(path.join(file, 'inner'), 'utf8')).toBe('mine')
  expect((await fs.readdir(root)).sort()).toEqual(['a.datalink'])
})

test('a failed temporary write leaves no .tmp file', async () => {
  const file = path.join(root, 'missing', 'a.datalink')
  await expect(writeJsonExclusive(file, { a: 1 })).rejects.toThrow()
  expect(await fs.readdir(root)).toEqual([])
})
