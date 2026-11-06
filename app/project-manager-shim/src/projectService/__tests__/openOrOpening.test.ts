/**
 * @file `isProjectOpenOrOpening`: a project counts from the moment `openProject` starts on it until
 * it is closed, whatever its path's separators, so that nothing changes it on disk meanwhile.
 */
import { createDeferred } from 'enso-common/src/utilities/async'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import { serialised } from '../../localMetadata/jsonFile.js'
import { comparableProjectPath, EnsoRunner, type Runner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { Path, UUID } from '../types.js'

let root: string
let projectPath: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-opening-'))
  vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
  projectPath = await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('a project counts while it opens, and no longer once the open has failed', async () => {
  const engineStarted = createDeferred<void>()
  const finishOpen = createDeferred<never>()
  const runner: Runner = {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async () => {
      engineStarted.resolve()
      return finishOpen.promise
    },
    closeProject: async () => {},
    isProjectRunning: async () => false,
    hasRunningProjects: async () => false,
    renameProject: async () => {},
    registerShutdownHook: async () => {},
    version: async () => '0.0.0',
  }
  const service = new ProjectService(runner, [])
  expect(await service.isProjectOpenOrOpening(projectPath)).toBe(false)
  const open = service.openProject(UUID('id-1'), Path(root))
  await engineStarted.promise
  expect(await service.isProjectOpenOrOpening(projectPath)).toBe(true)
  expect(await service.isProjectOpenOrOpening(projectPath.replace(/\\/g, '/'))).toBe(true)
  finishOpen.reject(new Error('the engine did not start'))
  await expect(open).rejects.toThrow('the engine did not start')
  expect(await service.isProjectOpenOrOpening(projectPath)).toBe(false)
})

test("the runner's own answer is asked, and isProjectRunning without one", async () => {
  const running = new ProjectService(
    {
      isProjectRunning: async () => false,
      isProjectOpenOrOpening: async (p: string) => p.endsWith('P'),
    } as unknown as Runner,
    [],
  )
  expect(await running.isProjectOpenOrOpening(projectPath)).toBe(true)
  const legacy = new ProjectService({ isProjectRunning: async () => true } as unknown as Runner, [])
  expect(await legacy.isProjectOpenOrOpening(projectPath)).toBe(true)
})

test('EnsoRunner answers for loading and running projects, whatever the separators', async () => {
  const runner = new EnsoRunner(Path('enso'))
  const internals = runner as unknown as {
    loadingProjects: Map<Path, Promise<unknown>>
    runningProjects: Map<Path, unknown>
  }
  expect(await runner.isProjectOpenOrOpening(projectPath)).toBe(false)
  internals.loadingProjects.set(Path(projectPath), new Promise(() => {}))
  expect(await runner.isProjectOpenOrOpening(projectPath.replace(/\\/g, '/'))).toBe(true)
  internals.loadingProjects.clear()
  internals.runningProjects.set(Path(projectPath.replace(/\\/g, '/')), {})
  expect(await runner.isProjectOpenOrOpening(projectPath)).toBe(true)
})

test('comparableProjectPath ignores separators, and case on Windows', () => {
  expect(comparableProjectPath('/a/b/../P')).toBe(comparableProjectPath('/a/P'))
  if (process.platform === 'win32') {
    expect(comparableProjectPath('C:\\Projects\\P')).toBe(comparableProjectPath('c:/projects/p'))
  }
})

test('opening a sample waits for a change queued on Samples, counted as opening meanwhile', async () => {
  const samples = path.join(root, 'Samples')
  const sample = await createProject(path.join(samples, 'S'), 'id-2')
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  void serialised(samples, () => held)
  const opened: string[] = []
  const runner: Runner = {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async (projectPath) => {
      opened.push(projectPath)
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
  const service = new ProjectService(runner, [])
  const open = service.openProject(UUID('id-2'), Path(samples))
  await vi.waitFor(async () => expect(await service.isProjectOpenOrOpening(sample)).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(opened).toEqual([])
  release()
  await open
  expect(opened).toHaveLength(1)
})
