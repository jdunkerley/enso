/** @file `findEnsoExecutable`'s order: `ENSO_ENGINE_PATH`, then the caller's engine, then the search. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { findEnsoExecutable } from '../ensoRunner.js'

let base: string

async function launcher(name: string): Promise<string> {
  const file = path.join(base, name, 'enso')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, '', { mode: 0o755 })
  return file
}

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'find-enso-'))
  vi.stubEnv('ENSO_ENGINE_PATH', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(base, { recursive: true, force: true })
})

test("the caller's engine (a Linux AppImage's copy) is used when it exists", async () => {
  const copy = await launcher('copy')
  expect(findEnsoExecutable(base, copy)).toBe(copy)
  expect(findEnsoExecutable(base, path.join(base, 'missing', 'enso'))).toBeUndefined()
})

test("ENSO_ENGINE_PATH, the user's own, wins over the caller's engine", async () => {
  const copy = await launcher('copy')
  const users = await launcher('users')
  vi.stubEnv('ENSO_ENGINE_PATH', users)
  expect(findEnsoExecutable(base, copy)).toBe(users)
})
