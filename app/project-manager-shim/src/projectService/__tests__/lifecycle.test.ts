import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import type { ProjectLifecycleListener } from '../../localMetadata/index.js'
import { createVersioning } from '../../localVersioning/__tests__/testRepo.js'
import { VERSIONING_TIMEOUT_MS, type LocalVersioning } from '../../localVersioning/index.js'
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
    // As the real runner does: run the hooks on close.
    closeProject: async () => {
      const pending = hooks
      hooks = []
      for (const hook of pending) await hook()
    },
    isProjectRunning: async () => running,
    hasRunningProjects: async () => running,
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

describe('versioning on close', () => {
  const git = (cwd: string, ...args: string[]) =>
    runCommand('git', args, { cwd }).then(({ stdout }) => stdout.trim())
  let versioning: LocalVersioning
  let saved: [string, string | undefined][]

  beforeEach(async () => {
    // Hide the developer's git configuration, and give commits an identity.
    const config = path.join(root, 'gitconfig')
    await fs.writeFile(config, '[user]\n\tname = Tester\n\temail = tester@example.com\n')
    saved = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].map((n) => [n, process.env[n]])
    process.env.GIT_CONFIG_GLOBAL = config
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    versioning = createVersioning(path.join(root, 'userData'))
    service = new ProjectService(fakeRunner(), [], console, listener, versioning)
  })

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  /** Open and close `id`, as the GUI does. */
  async function openThenClose(id: string, svc = service) {
    running = true
    await svc.openProject(UUID(id), Path(root))
    return svc.closeProject(UUID(id), Path(root))
  }

  test('closing a project in a repository commits only that project', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'A'), 'id-1')
    await createProject(path.join(root, 'B'), 'id-2')
    await openThenClose('id-1')
    expect(await git(root, 'log', '-1', '--format=%s')).toBe('Saved on close')
    const files = await git(root, 'show', '--name-only', '--format=')
    expect(files).toContain('A/package.yaml')
    expect(files).not.toContain('B/')
  })

  test('closing a project outside a repository succeeds and creates none', async () => {
    await createProject(path.join(root, 'A'), 'id-1')
    const result = await openThenClose('id-1')
    expect(result.versioningWarning).toBeUndefined()
    await expect(fs.access(path.join(root, '.git'))).rejects.toThrow()
  })

  test('closing a project in a repository that is not enabled commits nothing, without a warning', async () => {
    await git(root, 'init')
    await createProject(path.join(root, 'A'), 'id-1')
    const logger = { ...console, error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
    const svc = new ProjectService(fakeRunner(), [], logger as Console, listener, versioning)
    const result = await openThenClose('id-1', svc)
    expect(result.versioningWarning).toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
    await versioning.enable(root)
    await createProject(path.join(root, 'B'), 'id-2')
    await openThenClose('id-2', svc)
    expect(await git(root, 'log', '-1', '--format=%s')).toBe('Saved on close')
  })

  test('renaming a project in a repository that is not enabled commits nothing', async () => {
    await git(root, 'init')
    await createProject(path.join(root, 'Old'), 'id-1')
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    await expect(git(root, 'rev-parse', 'HEAD')).rejects.toThrow()
  })

  test('a failing commit is logged and reported on the close result', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'A'), 'id-1')
    vi.spyOn(versioning, 'commitIfEnabled').mockRejectedValue(new Error('index is locked'))
    const logger = { ...console, error: vi.fn(), debug: vi.fn(), info: vi.fn() } as Console
    const svc = new ProjectService(fakeRunner(), [], logger, listener, versioning)
    const result = await openThenClose('id-1', svc)
    expect(result.versioningWarning).toBe('index is locked')
    expect(logger.error).toHaveBeenCalled()
  })

  test('renaming an open project, then closing it, commits the removal and the new files', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'Old'), 'id-1')
    await versioning.commit([path.join(root, 'Old')], 'Before')
    running = true
    await service.openProject(UUID('id-1'), Path(root))
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    await service.closeProject(UUID('id-1'), Path(root))
    const files = await git(root, 'show', '--name-status', '--format=%s', 'HEAD')
    expect(files).toContain('Renamed Old to New')
    expect(files).toContain('Old/package.yaml')
    expect(files).toContain('New/package.yaml')
    expect(await git(root, 'status', '--porcelain', '--', 'Old', 'New')).toBe('')
  })

  test('renaming a closed project commits the move as "Renamed X to Y"', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'Old'), 'id-1')
    await versioning.commit([path.join(root, 'Old')], 'Before')
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    expect(await git(root, 'log', '-1', '--format=%s')).toBe('Renamed Old to New')
    expect(await git(root, 'log', '-1', '--format=%(trailers:key=Enso-Moved-From,valueonly)')).toBe(
      'Old',
    )
  })

  /** Resolves once a timer is pending (with fake timers), so the timeout has started. */
  async function waitForTimer() {
    const deadline = Date.now() + 3_000
    while (vi.getTimerCount() === 0 && Date.now() < deadline)
      await new Promise((resolve) => setImmediate(resolve))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  }

  test('finding the repository counts towards the timeout of the close', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'A'), 'id-1')
    running = true
    await service.openProject(UUID('id-1'), Path(root))
    // The commit itself is real; only the lookup before it never finishes.
    const spy = vi.spyOn(versioning, 'repositoryOf').mockReturnValue(new Promise(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const closing = service.closeProject(UUID('id-1'), Path(root))
      await waitForTimer()
      await vi.advanceTimersByTimeAsync(VERSIONING_TIMEOUT_MS + 1)
      expect(await closing).toEqual({ versioningWarning: 'Saving a version timed out.' })
    } finally {
      vi.useRealTimers()
      spy.mockRestore()
    }
  })

  test('renaming an open project gives up on a stuck move commit after the timeout', async () => {
    await versioning.init(root)
    await createProject(path.join(root, 'Old'), 'id-1')
    running = true
    await service.openProject(UUID('id-1'), Path(root))
    await service.renameProject(UUID('id-1'), 'New', Path(root))
    const spy = vi.spyOn(versioning, 'repositoryOf').mockReturnValue(new Promise(() => {}))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const closing = service.closeProject(UUID('id-1'), Path(root))
      await waitForTimer()
      await vi.advanceTimersByTimeAsync(VERSIONING_TIMEOUT_MS + 1)
      await waitForTimer()
      await vi.advanceTimersByTimeAsync(VERSIONING_TIMEOUT_MS + 1)
      expect(await closing).toEqual({ versioningWarning: 'Saving a version timed out.' })
      expect(listener.projectMoved).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      spy.mockRestore()
    }
  })

  test('a commit that never finishes times out, and the close still resolves', async () => {
    await createProject(path.join(root, 'A'), 'id-1')
    vi.spyOn(versioning, 'repositoryOf').mockResolvedValue(root)
    vi.spyOn(versioning, 'commitIfEnabled').mockReturnValue(new Promise(() => {}))
    running = true
    await service.openProject(UUID('id-1'), Path(root))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const closing = service.closeProject(UUID('id-1'), Path(root))
      // The close reads the filesystem before it starts waiting on the commit.
      await waitForTimer()
      await vi.advanceTimersByTimeAsync(VERSIONING_TIMEOUT_MS + 1)
      expect(await closing).toEqual({ versioningWarning: 'Saving a version timed out.' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('extra environment', () => {
  test('is passed to the engine that runs a project', async () => {
    await createProject(path.join(root, 'P'), 'id-1')
    const runProject = vi.fn(async () => 0)
    const extra = new ProjectService(
      { ...fakeRunner(), runProject },
      [],
      console,
      undefined,
      undefined,
      () => [['ENSO_SECRETS_KEY', 'abc']],
    )
    await extra.runProject(UUID('id-1'), Path(root))
    expect(runProject).toHaveBeenCalledOnce()
    const env = (runProject.mock.calls[0] as unknown as [string, [string, string][]])[1]
    expect(env).toContainEqual(['ENSO_SECRETS_KEY', 'abc'])
    expect(env.map(([name]) => name)).toContain('ENSO_LOCAL_PROJECT_ID')
  })
})
