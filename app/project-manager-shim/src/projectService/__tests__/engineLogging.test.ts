/** @file An opened project's engine gets the extra logging asked for, and only that. */
import type { EngineLoggingOptions } from 'enso-common/src/services/engineLogs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { EngineLaunch, Runner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { NATIVE_REMOVED_NOTICE } from '../nativeRequest.js'
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

const logLines = (service: ProjectService): string[] => {
  const channel = service.engineLogs.get(path.join(root, 'P'))
  return (channel?.subscribe({ event: () => {}, end: () => {} }).replay ?? []).flatMap((event) =>
    event.type === 'line' ? [event.text] : [],
  )
}

test('an open gets the JVM timeouts', async () => {
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  expect(launches.at(-1)).toMatchObject({
    timeouts: { startupMs: 120_000, terminateMs: 30_000 },
  })
})

test('the engine log no longer starts with a mode line', async () => {
  vi.stubEnv('ENSO_ENGINE_MODE', '')
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  expect(logLines(service).filter((text) => text.startsWith('Engine mode:'))).toEqual([])
})

test.each([
  ['ENSO_ENGINE_MODE=native', undefined, 'native'],
  ['package.yaml jvm: false', 'name: P\njvm: false\n', ''],
])('%s logs that the native engine was removed, once', async (_name, yaml, environment) => {
  vi.stubEnv('ENSO_ENGINE_MODE', environment)
  if (yaml != null) await fs.writeFile(path.join(root, 'P', 'package.yaml'), yaml)
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  await service.openProject(UUID('id-1'), Path(root))
  expect(logLines(service).filter((text) => text.includes('native engine was removed'))).toEqual([
    NATIVE_REMOVED_NOTICE,
  ])
})

test('jvm: true in package.yaml wins over ENSO_ENGINE_MODE=native, and logs nothing', async () => {
  vi.stubEnv('ENSO_ENGINE_MODE', 'native')
  await fs.writeFile(path.join(root, 'P', 'package.yaml'), 'name: P\njvm: true\n')
  const service = new ProjectService(fakeRunner(), [])
  await service.openProject(UUID('id-1'), Path(root))
  expect(logLines(service)).not.toContain(NATIVE_REMOVED_NOTICE)
})
