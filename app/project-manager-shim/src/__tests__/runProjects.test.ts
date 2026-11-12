/** @file A headless `--run` takes the command line's engine mode. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProject } from '../localMetadata/__tests__/testUtils.js'
import type { EngineLaunch, Runner } from '../projectService/ensoRunner.js'
import { Path, UUID } from '../projectService/types.js'
import { runLocalProjectByPath, runLocalProjectByUuid } from '../runProjects.js'
import { findLiveRunMarker } from '../samples/runMarker.js'

let root: string
let launches: (EngineLaunch | undefined)[]

/** A runner that starts no engine and records the launch of each run. */
function fakeRunner(): Runner {
  return {
    runProject: async (_path, _env, launch) => {
      launches.push(launch)
      return 0
    },
    createProject: async () => {},
    openProject: async () => {
      throw new Error('not expected')
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-projects-'))
  vi.stubEnv('ENSO_ENGINE_MODE', '')
  launches = []
  await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('the run takes --engine-mode', async () => {
  await runLocalProjectByUuid(UUID('id-1'), Path(root), { option: 'jvm' }, fakeRunner())
  expect(launches.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'option' })
})

test('without the option the run is the JVM, from the default', async () => {
  await runLocalProjectByUuid(UUID('id-1'), Path(root), undefined, fakeRunner())
  expect(launches.at(-1)?.mode).toEqual({ mode: 'jvm', source: 'default' })
})

test('a run by path marks the project as running while it runs', async () => {
  const project = path.join(root, 'P')
  const markedDuringRun: boolean[] = []
  const runner: Runner = {
    ...fakeRunner(),
    runProject: async () => {
      markedDuringRun.push((await findLiveRunMarker(project)) != null)
      return 0
    },
  }
  expect(await runLocalProjectByPath(Path(project), undefined, runner)).toBe(0)
  expect(markedDuringRun).toEqual([true])
  expect((await findLiveRunMarker(project)) != null).toBe(false)
})
