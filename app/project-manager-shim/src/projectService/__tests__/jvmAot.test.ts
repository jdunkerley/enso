/** @file `ProjectService` and the AOT cache: opens stop its training, JVM engines get its options. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { JvmAotCache } from '../../jvmAot/index.js'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { EngineLaunch, Runner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { Path, UUID } from '../types.js'

const OPTIONS = ['-XX:AOTCache=/c/enso.aot', '-Xlog:aot=warning,cds=warning:file="/c/use.log"']

let root: string
let events: string[]
let launches: (EngineLaunch | undefined)[]
let failOpen: boolean

/** A cache that records what the service asks of it, and always has a cache. */
class RecordingCache extends JvmAotCache {
  constructor() {
    super({
      rootDirectory: root,
      appVersion: '1',
      ensoExecutable: 'enso',
    })
  }
  override openStarted(): void {
    events.push('openStarted')
  }
  override openAnswered(): void {
    events.push('openAnswered')
  }
  override async jvmOptions(): Promise<readonly string[]> {
    return OPTIONS
  }
  override async checkUseLog(): Promise<void> {
    events.push('checkUseLog')
  }
}

function fakeRunner(): Runner {
  return {
    runProject: async (_path, _env, launch) => {
      launches.push(launch)
      return 0
    },
    createProject: async () => {},
    openProject: async (_path, _id, _args, _env, _sink, launch) => {
      events.push('engine')
      launches.push(launch)
      if (failOpen) throw new Error('no engine')
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

function service(): ProjectService {
  return new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    jvmAot: new RecordingCache(),
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-jvm-aot-'))
  vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
  events = []
  launches = []
  failOpen = false
  await createProject(path.join(root, 'P'), 'id-1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('an open stops the training, gets the cache options, then checks the use log', async () => {
  await service().openProject(UUID('id-1'), Path(root))
  expect(launches[0]?.jvmOptions).toEqual(OPTIONS)
  await vi.waitFor(() =>
    expect(events).toEqual(['openStarted', 'engine', 'openAnswered', 'checkUseLog']),
  )
})

test('a failed open is answered too', async () => {
  failOpen = true
  await expect(service().openProject(UUID('id-1'), Path(root))).rejects.toThrow('no engine')
  await vi.waitFor(() =>
    expect(events).toEqual(['openStarted', 'engine', 'openAnswered', 'checkUseLog']),
  )
})

test('a run gets the cache options', async () => {
  await service().runProject(UUID('id-1'), Path(root))
  expect(launches[0]?.jvmOptions).toEqual(OPTIONS)
})

test('an open observer (the AppImage engine copy waits for one) hears every open, a failed one too', async () => {
  const heard: string[] = []
  const observed = new ProjectService(fakeRunner(), [], console, undefined, undefined, undefined, {
    openObserver: {
      openStarted: () => heard.push('started'),
      openAnswered: () => heard.push('answered'),
    },
  })
  await observed.openProject(UUID('id-1'), Path(root))
  failOpen = true
  await expect(observed.openProject(UUID('id-1'), Path(root))).rejects.toThrow('no engine')
  expect(heard).toEqual(['started', 'answered', 'started', 'answered'])
})
