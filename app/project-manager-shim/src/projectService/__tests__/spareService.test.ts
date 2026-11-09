/** @file When the service wants a spare engine, with a runner that records what it is asked. */
import { createDeferred } from 'enso-common/src/utilities/async'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { JvmAotCache } from '../../jvmAot/index.js'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { EngineLaunch, Runner, SpareRequest } from '../ensoRunner.js'
import { ProjectService, type EngineSettings } from '../index.js'
import { Path, UUID } from '../types.js'

let root: string
let starts: SpareRequest[]
let stops: string[]
let opens: (EngineLaunch | undefined)[]
let inUse: boolean
let availableAgain: number
let closing: ReturnType<typeof createDeferred<void>>
let secretsKey: string

function fakeRunner(): Runner {
  return {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async (_path, _id, _args, _env, _sink, launch) => {
      opens.push(launch)
      inUse = true
      return {
        jsonSocket: { host: '127.0.0.1', port: 1 },
        ydocSocket: { host: '127.0.0.1', port: 2 },
      }
    },
    closeProject: async () => {
      inUse = false
      await closing.promise
    },
    isProjectRunning: async () => false,
    hasRunningProjects: async () => inUse,
    hasProjectsInUse: async () => inUse,
    renameProject: async () => {},
    registerShutdownHook: async () => {},
    version: async () => '0.0.0',
    startSpare: (request) => void starts.push(request),
    stopSpare: async (reason) => void stops.push(reason),
    spareAvailableAgain: () => void (availableAgain += 1),
  }
}

/** The service's own logging, without the debug lines of every open and close. */
const quiet: Console = { ...console, debug: () => {} }

function service(engine: EngineSettings = { option: 'jvm' }, extraArgs: string[] = []) {
  return new ProjectService(
    fakeRunner(),
    extraArgs,
    quiet,
    undefined,
    undefined,
    () => [['ENSO_SECRETS_KEY', secretsKey]],
    engine,
  )
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'spare-service-'))
  vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
  vi.stubEnv('ENSO_SPARE_ENGINE', '')
  vi.stubEnv('ENSO_YDOC_HOST', '')
  vi.stubEnv('ENSO_ENGINE_MODE', '')
  starts = []
  stops = []
  opens = []
  inUse = false
  availableAgain = 0
  closing = createDeferred<void>()
  secretsKey = 'key-a'
  await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  closing.resolve()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('no spare until the GUI reports the setting; then one, and the answer names the engine', async () => {
  const s = service()
  expect(starts).toEqual([])
  expect(await s.setSpareEngine(true)).toEqual({ engineMode: 'jvm' })
  expect(starts).toHaveLength(1)
  expect(starts[0]!.launch.mode.mode).toBe('jvm')
  expect(starts[0]!.extraEnv).toEqual([['ENSO_SECRETS_KEY', 'key-a']])
})

test('no spare with the native engine, the setting off, ENSO_SPARE_ENGINE=0, the engine ydoc host, or profiling', async () => {
  expect(await service({}).setSpareEngine(true)).toEqual({ engineMode: 'native' })
  await service().setSpareEngine(false)
  vi.stubEnv('ENSO_SPARE_ENGINE', '0')
  await service().setSpareEngine(true)
  vi.stubEnv('ENSO_SPARE_ENGINE', '')
  vi.stubEnv('ENSO_YDOC_HOST', 'engine')
  await service().setSpareEngine(true)
  vi.stubEnv('ENSO_YDOC_HOST', '')
  await service({ option: 'jvm' }, ['--profiling-path', 'profiling.npss']).setSpareEngine(true)
  expect(starts).toEqual([])
  expect(stops).toEqual([
    'the engine is native',
    'the setting is off',
    'ENSO_SPARE_ENGINE=0',
    'ENSO_YDOC_HOST=engine',
    'profiling is on',
  ])
})

test('turning the setting off stops the spare, and on starts one again', async () => {
  const s = service()
  await s.setSpareEngine(true)
  await s.setSpareEngine(false)
  await s.setSpareEngine(true)
  expect(starts).toHaveLength(2)
  expect(stops).toEqual(['the setting is off'])
})

test('a changed input gives a new key, so the spare is replaced', async () => {
  const s = service()
  await s.setSpareEngine(true)
  secretsKey = 'key-b'
  await s.refreshSpare()
  expect(starts).toHaveLength(2)
  expect(starts[1]!.key).not.toBe(starts[0]!.key)
})

test("a JVM open carries the spare's key; a native one stops the spare", async () => {
  const s = service()
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[0]!.spareKey).toBe(starts[0]!.key)
  closing.resolve()
  await s.closeProject(UUID('id-1'), Path(root))
  const native = service({ option: 'native' })
  await native.openProject(UUID('id-1'), Path(root))
  expect(opens[1]!.spareKey).toBeUndefined()
  expect(stops).toContain('a project with the native engine is opening')
})

test("an open's own engine logging leaves its key alone; a setting changed since the spare does not", async () => {
  const s = service()
  await s.setSpareEngine(true)
  // Per-open arguments travel in the spare's line, so they are not part of the key.
  await s.openProject(UUID('id-1'), Path(root), { sqlQueries: true, performanceTimings: true })
  expect(opens[0]!.spareKey).toBe(starts[0]!.key)
  closing.resolve()
  await s.closeProject(UUID('id-1'), Path(root))
  // An open after a change no refresh has seen yet: the runner then finds the spare's key differs.
  const spareKey = starts.at(-1)!.key
  secretsKey = 'key-b'
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[1]!.spareKey).not.toBe(spareKey)
})

test('after a close the next spare waits for the old engine or the delay, whichever is first', async () => {
  const s = service({ option: 'jvm', spareAfterCloseMs: 100 })
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  const close = s.closeProject(UUID('id-1'), Path(root))
  // The old engine is still stopping (`closing` unresolved): the delay starts the spare.
  await vi.waitFor(() => expect(starts).toHaveLength(2), { timeout: 2000 })
  expect(availableAgain).toBe(1)
  closing.resolve()
  await close

  const slow = service({ option: 'jvm', spareAfterCloseMs: 60_000 })
  closing = createDeferred<void>()
  await slow.setSpareEngine(true)
  await slow.openProject(UUID('id-1'), Path(root))
  const slowClose = slow.closeProject(UUID('id-1'), Path(root))
  closing.resolve()
  await slowClose
  // The old engine exited long before the delay: the spare starts at once.
  await vi.waitFor(() => expect(starts).toHaveLength(4), { timeout: 2000 })
})

test('quitting stops the spare and starts no other', async () => {
  const s = service()
  await s.setSpareEngine(true)
  await s.stopSpareEngine()
  await s.setSpareEngine(true)
  expect(starts).toHaveLength(1)
  expect(stops).toEqual(['quitting', 'quitting'])
})

test('no spare while the AOT cache trains; the refresh after it starts one', async () => {
  let training = true
  // The parts of `JvmAotCache` the service uses, for a first launch whose cache is training.
  const jvmAot = {
    isTraining: () => training,
    jvmOptions: async () => [] as readonly string[],
    openStarted: () => {},
    openAnswered: () => {},
    checkUseLog: async () => {},
  } as JvmAotCache
  const s = service({ option: 'jvm', jvmAot })
  await s.setSpareEngine(true)
  expect(starts).toEqual([])
  expect(stops).toEqual(['the AOT cache is training'])
  training = false
  // What Electron's `onTrainingEnded` does.
  await s.refreshSpare()
  expect(starts).toHaveLength(1)
})
