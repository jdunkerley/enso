import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { findNewSessionLog, listActiveLogsSync } from '../sessionFiles.js'

const OLDER = 'enso-language-server-2026-10-20-09-00-00'
const NEWER = 'enso-language-server-2026-10-20-10-00-00'
const NEWEST = 'enso-language-server-2026-10-20-11-00-00'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-log-sessions-'))
})

afterEach(async () => {
  await fs.rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})

async function touch(name: string) {
  await fs.writeFile(path.join(dir, name), '')
}

describe('listActiveLogsSync', () => {
  test('lists the active session logs only', async () => {
    await touch(`${OLDER}.log`)
    await touch(`${OLDER}.0.log.gz`)
    await touch('notes.txt')
    await touch('enso.log')
    expect(listActiveLogsSync(dir)).toEqual([`${OLDER}.log`])
  })

  test('is empty for a directory that does not exist', () => {
    expect(listActiveLogsSync(path.join(dir, 'missing'))).toEqual([])
  })
})

describe('findNewSessionLog', () => {
  test('finds the newest active log that was not listed before', async () => {
    await touch(`${OLDER}.log`)
    await touch(`${NEWEST}.log`)
    await touch(`${NEWER}.log`)
    await touch(`${NEWEST}.1.log.gz`)
    expect(await findNewSessionLog(dir, new Set([`${OLDER}.log`]))).toBe(
      path.join(dir, `${NEWEST}.log`),
    )
  })

  test('is undefined while there is no new log, or no directory', async () => {
    await touch(`${OLDER}.log`)
    expect(await findNewSessionLog(dir, new Set([`${OLDER}.log`]))).toBeUndefined()
    expect(await findNewSessionLog(path.join(dir, 'missing'), new Set())).toBeUndefined()
  })
})
