/** @file An opened project's engine gets the extra logging asked for, and only that. */
import type { EngineLoggingOptions } from 'enso-common/src/services/engineLogs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { EngineLaunch, Runner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { Path, UUID } from '../types.js'

let root: string
let engineArgs: (readonly string[] | undefined)[]
let launches: (EngineLaunch | undefined)[]

/** A runner that starts no engine and records the arguments each open would start one with. */
function fakeRunner(): Runner {
  return {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async (_path, _id, extraArgs, _env, _sink, launch) => {
      engineArgs.push(extraArgs)
      launches.push(launch)
      return {
        jsonSocket: { host: '127.0.0.1', port: 1 },
        ydocSocket: { host: '127.0.0.1', port: 2 },
      }
    },
    closeProject: async () => {},
    isProjectRunning: async () => false,
    hasRunningProjects: async () => false,
    renameProject: async () => {},
    registerShutdownHook: async () => {},
    version: async () => '0.0.0',
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-engine-logging-'))
  vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
  engineArgs = []
  launches = []
  await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function openWith(extraArgs: readonly string[], options?: EngineLoggingOptions) {
  const service = new ProjectService(fakeRunner(), extraArgs)
  await service.openProject(UUID('id-1'), Path(root), options)
  return engineArgs.at(-1)
}

test('no logging options: no extra arguments', async () => {
  expect(await openWith([])).toBeUndefined()
  expect(await openWith([], { sqlQueries: false, performanceTimings: false })).toBeUndefined()
})

test('SQL queries turn the SQL logger up to info', async () => {
  expect(await openWith([], { sqlQueries: true })).toEqual([
    '--vm.D',
    'Standard.Database.Connection.Logger.level=info',
  ])
})

test('performance timings turn only the progress logger up to debug', async () => {
  expect(await openWith([], { performanceTimings: true })).toEqual([
    '--vm.D',
    'Standard.Base.Logging.Progress.Logger.level=debug',
  ])
})

test("the service's own engine arguments come first", async () => {
  expect(
    await openWith(['--log-level', 'info'], { sqlQueries: true, performanceTimings: true }),
  ).toEqual([
    '--log-level',
    'info',
    '--vm.D',
    'Standard.Database.Connection.Logger.level=info',
    '--vm.D',
    'Standard.Base.Logging.Progress.Logger.level=debug',
  ])
  expect(await openWith(['--log-level', 'info'])).toEqual(['--log-level', 'info'])
})

test('the open resolves the mode: package.yaml first', async () => {
  await fs.writeFile(path.join(root, 'P', 'package.yaml'), 'name: P\njvm: true\n')
  const service = new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    option: 'native',
  })
  await service.openProject(UUID('id-1'), Path(root))
  expect(launches.at(-1)).toMatchObject({
    mode: { mode: 'jvm', source: 'package.yaml' },
    timeouts: { startupMs: 120_000, terminateMs: 30_000, ydocWaitMs: 30_000 },
  })
})

test('the open takes the option when package.yaml says nothing', async () => {
  const service = new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    option: 'jvm',
  })
  await service.openProject(UUID('id-1'), Path(root))
  expect(launches.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'option' })
})

test('with no settings the open is the JVM, from the default', async () => {
  vi.stubEnv('ENSO_ENGINE_MODE', '')
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  expect(launches.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'default' })
})

test('ENSO_ENGINE_MODE is the environment source', async () => {
  vi.stubEnv('ENSO_ENGINE_MODE', 'jvm')
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  expect(launches.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'environment' })
})

test('the run resolves the mode too', async () => {
  const seen: (EngineLaunch | undefined)[] = []
  const runner: Runner = {
    ...fakeRunner(),
    runProject: async (_path, _env, launch) => {
      seen.push(launch)
      return 0
    },
  }
  const service = new ProjectService(runner, [], console, undefined, undefined, undefined, {
    option: 'jvm',
  })
  await service.runProject(UUID('id-1'), Path(root))
  expect(seen.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'option' })
})

test('the engine log starts with the mode', async () => {
  const service = new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    environment: 'jvm',
  })
  await service.openProject(UUID('id-1'), Path(root))
  const channel = service.engineLogs.get(path.join(root, 'P'))
  const lines = (channel?.subscribe({ event: () => {}, end: () => {} }).replay ?? []).flatMap(
    (event) => (event.type === 'line' ? [event.text] : []),
  )
  expect(lines[0]).toBe('Engine mode: jvm (ENSO_ENGINE_MODE)')
})

test('re-opening an open project writes no second mode line', async () => {
  const service = new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    environment: 'jvm',
  })
  await service.openProject(UUID('id-1'), Path(root))
  await service.openProject(UUID('id-1'), Path(root))
  const replay = service.engineLogs
    .get(path.join(root, 'P'))
    ?.subscribe({ event: () => {}, end: () => {} }).replay
  const modeLines = (replay ?? []).filter(
    (event) => event.type === 'line' && event.text.startsWith('Engine mode:'),
  )
  expect(modeLines).toHaveLength(1)
})
