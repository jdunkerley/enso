import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { ProjectLifecycleListener } from '../../localMetadata/index.js'
import type { Runner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { Path, UUID } from '../types.js'

// Delete instead of filling the real system trash.
vi.mock('trash', () => ({
  default: async (target: string) => {
    await fs.rm(target, { recursive: true, force: true })
  },
}))

let root: string
let hooks: (() => Promise<void>)[]
let running: boolean
let listener: { [K in keyof ProjectLifecycleListener]: ReturnType<typeof vi.fn> }
let service: ProjectService

/** A runner that starts no engine; `running` decides whether a project counts as open. */
function fakeRunner(): Runner {
  return {
    runProject: async () => 0,
    createProject: async () => {},
    openProject: async () => ({
      jsonSocket: { host: '127.0.0.1', port: 1 },
      ydocSocket: { host: '127.0.0.1', port: 2 },
    }),
    closeProject: async () => {},
    isProjectRunning: async () => running,
    renameProject: async () => {},
    registerShutdownHook: async (_path, _type, hook) => {
      hooks.push(hook)
    },
    version: async () => '0.0.0',
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-lifecycle-'))
  hooks = []
  running = false
  listener = { projectMoved: vi.fn(async () => {}), projectDeleted: vi.fn(async () => {}) }
  service = new ProjectService(fakeRunner(), [], console, listener)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('ProjectService lifecycle notifications', () => {
  test('renaming a closed project reports the new directory', async () => {
    await createProject(path.join(root, 'Old'), 'id-1')
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    expect(listener.projectMoved).toHaveBeenCalledExactlyOnceWith('id-1', path.join(root, 'New'))
  })

  test('renaming an open project reports the directory once it is renamed', async () => {
    running = true
    await createProject(path.join(root, 'Old'), 'id-1')
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    expect(listener.projectMoved).not.toHaveBeenCalled()
    for (const hook of hooks) await hook()
    expect(listener.projectMoved).toHaveBeenCalledExactlyOnceWith('id-1', path.join(root, 'New'))
  })

  test('deleting a project reports it', async () => {
    const dir = await createProject(path.join(root, 'P'), 'id-1')
    await service.deleteProject(UUID('id-1'), Path(root))
    expect(listener.projectDeleted).toHaveBeenCalledExactlyOnceWith('id-1')
    await expect(fs.access(dir)).rejects.toThrow()
  })

  test('a failing listener does not fail the operation', async () => {
    listener.projectMoved.mockRejectedValue(new Error('boom'))
    await createProject(path.join(root, 'Old'), 'id-1')
    await expect(service.renameProject(UUID('id-1'), 'New', Path(root))).resolves.toBeUndefined()
  })
})
