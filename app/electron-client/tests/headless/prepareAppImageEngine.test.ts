/** @file `prepareAppImageEngine` drops an inherited engine copy path from the environment. */
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const userData = path.join(path.sep, 'home', 'user', '.config', 'enso')

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    getVersion: () => '2026.1.0',
  },
  net: {},
  utilityProcess: {},
}))

const { prepareAppImageEngine } = await import('@/projectService')

const electron = {} as Parameters<typeof prepareAppImageEngine>[0]

let saved: string | undefined
beforeEach(() => {
  saved = process.env.ENSO_ENGINE_PATH
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, 'ENSO_ENGINE_PATH')
  else Reflect.set(process.env, 'ENSO_ENGINE_PATH', saved)
  vi.restoreAllMocks()
})

test("an ENSO_ENGINE_PATH inside the IDE's engine copies is dropped (review of #612, N3)", async () => {
  // Passed on by an earlier IDE's relaunch after an in-app update.
  Reflect.set(
    process.env,
    'ENSO_ENGINE_PATH',
    path.join(userData, 'engine', '2025.9.0', 'dist', 'bin', 'enso'),
  )
  await prepareAppImageEngine(electron, false)
  expect(process.env.ENSO_ENGINE_PATH).toBeUndefined()
})

test("a user's ENSO_ENGINE_PATH is kept", async () => {
  const users = path.join(path.sep, 'opt', 'enso', 'bin', 'enso')
  Reflect.set(process.env, 'ENSO_ENGINE_PATH', users)
  await prepareAppImageEngine(electron, false)
  expect(process.env.ENSO_ENGINE_PATH).toBe(users)
})
