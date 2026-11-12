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
/** The `waitMs` of every bounded stop. */
let waits: number[]
let opens: (EngineLaunch | undefined)[]
let inUse: boolean
let availableAgain: number
let closing: ReturnType<typeof createDeferred<void>>
let secretsKey: string
let openFails: boolean
/** When set, `hasProjectsInUse` answers what it saw when asked, once this resolves. */
let inUseAnswer: Promise<void> | undefined
let inUseAsked: ReturnType<typeof createDeferred<void>>

function fakeRunner(): Runner {
  return {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async (_path, _id, _args, _env, _sink, launch) => {
      opens.push(launch)
      if (openFails) throw new Error('the engine did not start')
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
    hasProjectsInUse: async () => {
      const seen = inUse
      inUseAsked.resolve()
      await inUseAnswer
      return seen
    },
    renameProject: async () => {},
    registerShutdownHook: async () => {},
    version: async () => '0.0.0',
    startSpare: (request) => void starts.push(request),
    stopSpare: async (reason, options) => {
      stops.push(reason)
      if (options?.waitMs != null) waits.push(options.waitMs)
    },
    spareAvailableAgain: () => void (availableAgain += 1),
  }
}

/** The service's own logging, without the debug lines of every open and close. */
const quiet: Console = { ...console, debug: () => {} }

function service(engine: EngineSettings = {}, extraArgs: string[] = []) {
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

/** The parts of `JvmAotCache` the service uses: no options and no training, unless overridden. */
function fakeAot(
  overrides: Partial<Pick<JvmAotCache, 'isTraining' | 'jvmOptions' | 'openStarted'>>,
) {
  return {
    isTraining: () => false,
    jvmOptions: async () => [],
    openStarted: () => {},
    openAnswered: () => {},
    checkUseLog: async () => {},
    ...overrides,
  } as JvmAotCache
}

/** AOT options that wait for `release`; `reached` resolves at the first call. */
function heldOptions() {
  const release = createDeferred<readonly string[]>()
  const reached = createDeferred<void>()
  const jvmOptions = () => {
    reached.resolve()
    return release.promise
  }
  return { release, reached, jvmOptions }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'spare-service-'))
  vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
  vi.stubEnv('ENSO_SPARE_ENGINE', '')
  starts = []
  stops = []
  waits = []
  opens = []
  inUse = false
  availableAgain = 0
  closing = createDeferred<void>()
  secretsKey = 'key-a'
  openFails = false
  inUseAnswer = undefined
  inUseAsked = createDeferred<void>()
  await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  closing.resolve()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('no spare until the GUI reports the setting; then one', async () => {
  const s = service()
  expect(starts).toEqual([])
  await s.setSpareEngine(true)
  expect(starts).toHaveLength(1)
  expect(starts[0]!.extraEnv).toEqual([['ENSO_SECRETS_KEY', 'key-a']])
})

test('no spare with the setting off, ENSO_SPARE_ENGINE=0, or profiling', async () => {
  await service().setSpareEngine(false)
  vi.stubEnv('ENSO_SPARE_ENGINE', '0')
  await service().setSpareEngine(true)
  vi.stubEnv('ENSO_SPARE_ENGINE', '')
  await service({}, ['--profiling-path', 'profiling.npss']).setSpareEngine(true)
  expect(starts).toEqual([])
  expect(stops).toEqual(['the setting is off', 'ENSO_SPARE_ENGINE=0', 'profiling is on'])
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

test("an open carries the spare's key", async () => {
  const s = service()
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[0]!.spareKey).toBe(starts[0]!.key)
  closing.resolve()
  await s.closeProject(UUID('id-1'), Path(root))
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
  const s = service({ spareAfterCloseMs: 100 })
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  const close = s.closeProject(UUID('id-1'), Path(root))
  // The old engine is still stopping (`closing` unresolved): the delay starts the spare.
  await vi.waitFor(() => expect(starts).toHaveLength(2), { timeout: 2000 })
  expect(availableAgain).toBe(1)
  closing.resolve()
  await close

  const slow = service({ spareAfterCloseMs: 60_000 })
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
  // A first launch whose cache is training.
  const jvmAot = fakeAot({ isTraining: () => training })
  const s = service({ jvmAot })
  await s.setSpareEngine(true)
  expect(starts).toEqual([])
  expect(stops).toEqual(['the AOT cache is training'])
  training = false
  // What Electron's `onTrainingEnded` does.
  await s.refreshSpare()
  expect(starts).toHaveLength(1)
})

test('a refresh that runs while an open has not reached the runner starts no spare', async () => {
  let duringOpen: Promise<void> | undefined
  const s = service({
    jvmAot: fakeAot({ openStarted: () => (duringOpen = s.refreshSpare()) }),
  })
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  await duringOpen
  // Only the spare before the open: the refresh met the open and left the spare to it.
  expect(starts).toHaveLength(1)
  expect(stops).toEqual([])
})

test('an open that starts during a refresh, after its checks, still means no spare', async () => {
  const options = heldOptions()
  const s = service({ jvmAot: fakeAot({ jvmOptions: options.jvmOptions }) })
  const refresh = s.setSpareEngine(true)
  // The refresh is past its settings checks, waiting for the AOT options.
  await options.reached.promise
  // The open waits for them too, before it reaches the runner.
  const open = s.openProject(UUID('id-1'), Path(root))
  options.release.resolve([])
  await refresh
  await open
  expect(starts).toEqual([])
  expect(opens).toHaveLength(1)
})

test('an open that starts and finishes while a refresh asks what is in use means no spare', async () => {
  const answer = createDeferred<void>()
  inUseAnswer = answer.promise
  const s = service()
  const refresh = s.setSpareEngine(true)
  // The runner has seen nothing in use; its answer is still on the way.
  await inUseAsked.promise
  inUseAnswer = undefined
  await s.openProject(UUID('id-1'), Path(root))
  answer.resolve()
  await refresh
  expect(starts).toEqual([])
})

test('a failed open is followed by a spare', async () => {
  const s = service()
  openFails = true
  await expect(s.openProject(UUID('id-1'), Path(root))).rejects.toThrow('the engine did not start')
  // The setting arrives after the failure: the failure's own refresh found no setting.
  expect(starts).toEqual([])
  await s.setSpareEngine(true)
  starts.length = 0
  await expect(s.openProject(UUID('id-1'), Path(root))).rejects.toThrow('the engine did not start')
  await vi.waitFor(() => expect(starts).toHaveLength(1))
})

test('a project reopened during the gate after a close: no spare, and a failed spare is not retried', async () => {
  // The gate's delay is longer than the test: it ends when the old engine has stopped.
  const s = service({ spareAfterCloseMs: 60_000 })
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  const close = s.closeProject(UUID('id-1'), Path(root))
  await s.openProject(UUID('id-1'), Path(root))
  closing.resolve()
  await close
  await vi.waitFor(() => expect(stops).toEqual(['a project is open']))
  expect(starts).toHaveLength(1)
  expect(availableAgain).toBe(0)
})

test('a quit while a refresh is in flight or queued starts nothing', async () => {
  const options = heldOptions()
  const s = service({ jvmAot: fakeAot({ jvmOptions: options.jvmOptions }) })
  const inFlight = s.setSpareEngine(true)
  // In flight: past its settings checks, waiting for the AOT options.
  await options.reached.promise
  const queued = s.refreshSpare()
  const quit = s.stopSpareEngine()
  options.release.resolve([])
  await Promise.all([inFlight, queued, quit])
  expect(starts).toEqual([])
  expect(stops).toEqual(['quitting', 'quitting', 'quitting'])
})

test('a close while the AOT cache is still wanted starts no spare; the refresh after training does', async () => {
  let training = true
  const s = service({ jvmAot: fakeAot({ isTraining: () => training }) })
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  closing.resolve()
  await s.closeProject(UUID('id-1'), Path(root))
  await vi.waitFor(() =>
    expect(stops).toEqual(['the AOT cache is training', 'the AOT cache is training']),
  )
  expect(starts).toEqual([])
  training = false
  await s.refreshSpare()
  expect(starts).toHaveLength(1)
})

test('a training that begins while a refresh waits for the AOT options means no spare', async () => {
  const options = heldOptions()
  let training = false
  const s = service({
    jvmAot: fakeAot({ isTraining: () => training, jvmOptions: options.jvmOptions }),
  })
  const refresh = s.setSpareEngine(true)
  // Past its settings checks, waiting for the AOT options, when `JvmAotCache.start()` runs.
  await options.reached.promise
  training = true
  options.release.resolve([])
  await refresh
  expect(starts).toEqual([])
  expect(stops).toEqual(['the AOT cache is training'])
})

test('a quit with a wait stops the spare, then waits for it with that bound', async () => {
  const s = service()
  await s.setSpareEngine(true)
  await s.stopSpareEngine({ waitMs: 5000 })
  expect(stops).toEqual(['quitting', 'quitting'])
  expect(waits).toEqual([5000])
  await s.refreshSpare()
  expect(starts).toHaveLength(1)
})

test('an open tells the runner why no spare runs, and nothing when spares are off', async () => {
  let training = true
  const s = service({ jvmAot: fakeAot({ isTraining: () => training }) })
  await s.setSpareEngine(false)
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[0]?.spareIdleReason).toBeNull()
  closing.resolve()
  await s.closeProject(UUID('id-1'), Path(root))
  await s.setSpareEngine(true)
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[1]?.spareIdleReason).toBe('the AOT cache is training')
  await s.closeProject(UUID('id-1'), Path(root))
  training = false
  await s.refreshSpare()
  expect(starts).toHaveLength(1)
  await s.openProject(UUID('id-1'), Path(root))
  expect(opens[2]?.spareIdleReason).toBeUndefined()
})
