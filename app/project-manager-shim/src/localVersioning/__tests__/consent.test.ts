import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { VERSIONING_FILE_NAME, VersioningConsent } from '../consent.js'

let dir: string
let warn: ReturnType<typeof vi.fn>

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enso-consent-test-'))
  warn = vi.fn()
  await fs.mkdir(path.join(dir, 'repo'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const store = () =>
  new VersioningConsent({ userDataDirectory: path.join(dir, 'userData'), logger: { warn } })
const file = () => path.join(dir, 'userData', VERSIONING_FILE_NAME)

describe('VersioningConsent', () => {
  test('nothing is enabled at first', async () => {
    expect(await store().isEnabled(path.join(dir, 'repo'))).toBe(false)
  })

  test('enable, persist, disable', async () => {
    const repo = path.join(dir, 'repo')
    await store().enable(repo)
    await store().enable(repo)
    expect(await store().isEnabled(repo)).toBe(true)
    const json = JSON.parse(await fs.readFile(file(), 'utf8'))
    expect(json.version).toBe(1)
    expect(json.enabledRepositories).toHaveLength(1)
    await store().disable(repo)
    expect(await store().isEnabled(repo)).toBe(false)
    await store().disable(repo)
  })

  test('other repositories are unaffected', async () => {
    await fs.mkdir(path.join(dir, 'other'))
    await store().enable(path.join(dir, 'repo'))
    expect(await store().isEnabled(path.join(dir, 'other'))).toBe(false)
  })

  test('a different spelling of the same path matches', async () => {
    const repo = path.join(dir, 'repo')
    await store().enable(path.join(repo, '..', 'repo'))
    expect(await store().isEnabled(repo)).toBe(true)
    if (process.platform === 'win32') expect(await store().isEnabled(repo.toUpperCase())).toBe(true)
  })

  test.skipIf(process.platform === 'win32')('a link to the repository matches', async () => {
    await fs.symlink(path.join(dir, 'repo'), path.join(dir, 'link'))
    await store().enable(path.join(dir, 'link'))
    expect(await store().isEnabled(path.join(dir, 'repo'))).toBe(true)
  })

  test('concurrent enables are all kept', async () => {
    const repos = await Promise.all(
      ['a', 'b', 'c', 'd'].map(async (name) => {
        await fs.mkdir(path.join(dir, name))
        return path.join(dir, name)
      }),
    )
    await Promise.all(repos.map((repo) => store().enable(repo)))
    for (const repo of repos) expect(await store().isEnabled(repo)).toBe(true)
  })

  test('a corrupt file is moved aside and read as empty', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), '{ not json')
    expect(await store().isEnabled(path.join(dir, 'repo'))).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect((await fs.readdir(path.dirname(file()))).some((n) => n.includes('.corrupt-'))).toBe(true)
  })

  test('a file of the wrong shape is moved aside', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), JSON.stringify({ version: 1, enabledRepositories: [1] }))
    expect(await store().isEnabled(path.join(dir, 'repo'))).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  test('a newer file is moved aside', async () => {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), JSON.stringify({ version: 2, enabledRepositories: [] }))
    expect(await store().isEnabled(path.join(dir, 'repo'))).toBe(false)
    expect((await fs.readdir(path.dirname(file()))).some((n) => n.includes('.newer-'))).toBe(true)
  })
})
