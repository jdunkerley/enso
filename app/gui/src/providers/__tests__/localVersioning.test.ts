/**
 * @file The local versioning provider: each open local project's status, polled every 5 s
 * without overlapping requests; the silent enabling of a repository inside the root; the
 * repository prompts; saving.
 */
import { createModalsStore } from '$/providers/modals'
import { useText } from '$/providers/text'
import { createToastsStore } from '$/providers/toasts'
import { createPersistedStore } from '$/utils/persistedStore'
import { Path, type ProjectId } from 'enso-common/src/services/Backend'
import { newProjectId, type LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createLocalVersioningStore,
  VERSIONING_POLL_INTERVAL_MS,
  type RepositoryPromptsState,
} from '../localVersioning'
import type { FlushOutcome } from '../openedProjects/project/flush'

const ROOT = Path('/root')
const PROJECT_PATH = Path('/root/P')
const PROJECT: ProjectId = newProjectId(PROJECT_PATH)
const FLUSHED = async (): Promise<FlushOutcome> => ({ kind: 'flushed' })

function status(extra: Partial<VersioningStatus> = {}): VersioningStatus {
  return {
    git: true,
    repoRoot: ROOT,
    changed: false,
    lastVersion: null,
    blocked: null,
    enabled: true,
    optedOut: false,
    ...extra,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function setup(backendOverrides: Record<string, unknown> = {}) {
  const backend = {
    rootPath: () => ROOT,
    versioningStatus: vi.fn(async (_path: Path) => status()),
    enableVersioningIfInside: vi.fn(async () => ({ enabled: false })),
    initVersioning: vi.fn(async () => ({ repoRoot: ROOT })),
    enableVersioning: vi.fn(async () => {}),
    commitVersion: vi.fn(async () => ({ id: 'a'.repeat(40) as string | null })),
    ...backendOverrides,
  }
  const modals = createModalsStore()
  const toasts = createToastsStore()
  const prompts = createPersistedStore<RepositoryPromptsState>(
    () => ({ declinedRoots: [], declinedRepositories: [] }),
    { name: 'test-local-versioning-prompts', version: 1 },
  )
  const store = createLocalVersioningStore({
    // A stub with only what the store calls; not a third-party API.
    localBackend: () => backend as unknown as LocalBackend,
    modals,
    toasts,
    getText: useText().getText,
    prompts,
  })
  return { backend, modals, toasts, prompts, store }
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('polling', () => {
  beforeEach(() => vi.useFakeTimers())

  test('reads the status at once, then every 5 s while the project is watched', async () => {
    const { backend, store } = setup()
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.versioningStatus).toHaveBeenCalledTimes(1)
    expect(backend.versioningStatus).toHaveBeenCalledWith(PROJECT_PATH)
    expect(store.statusOf(PROJECT)).toEqual(status())
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(backend.versioningStatus).toHaveBeenCalledTimes(2)
    store.unwatchProject(PROJECT)
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS)
    expect(backend.versioningStatus).toHaveBeenCalledTimes(2)
    expect(store.statusOf(PROJECT)).toBeUndefined()
  })

  test('never issues a request while one is pending; refreshes asked meanwhile run once after', async () => {
    const first = deferred<VersioningStatus>()
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(status({ changed: true }))
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    const a = store.refresh(PROJECT)
    const b = store.refresh(PROJECT)
    await vi.advanceTimersByTimeAsync(4 * VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(1)
    first.resolve(status())
    await a
    await b
    expect(versioningStatus).toHaveBeenCalledTimes(2)
    expect(store.statusOf(PROJECT)?.changed).toBe(true)
  })

  test('a poll waits 5 s after the previous answer, not after the previous question', async () => {
    const slow = deferred<VersioningStatus>()
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status())
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(status())
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(2)
    slow.resolve(status())
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(3)
  })

  test('a failed status keeps the previous one, and polling goes on', async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status({ changed: true }))
      .mockRejectedValueOnce(new Error('shim down'))
      .mockResolvedValue(status())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(store.statusOf(PROJECT)?.changed).toBe(true)
    expect(warn).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(store.statusOf(PROJECT)?.changed).toBe(false)
  })
})

describe('a repository that is not enabled', () => {
  beforeEach(() => vi.useFakeTimers())

  test('is offered to the shim once per session, and read again when enabled', async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status({ enabled: false }))
      .mockResolvedValue(status())
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: true }))
    const { store } = setup({ versioningStatus, enableVersioningIfInside })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(enableVersioningIfInside).toHaveBeenCalledWith(ROOT, ROOT)
    expect(store.isVersioned(PROJECT)).toBe(true)
  })

  test('outside the root it stays disabled, and is offered only once', async () => {
    const versioningStatus = vi.fn(async () => status({ repoRoot: Path('/'), enabled: false }))
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: false }))
    const { store } = setup({ versioningStatus, enableVersioningIfInside })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS)
    expect(enableVersioningIfInside).toHaveBeenCalledTimes(1)
    expect(store.isVersioned(PROJECT)).toBe(false)
  })

  test('one the user turned off is not offered at all', async () => {
    const versioningStatus = vi.fn(async () => status({ enabled: false, optedOut: true }))
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: false }))
    const { store } = setup({ versioningStatus, enableVersioningIfInside })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(enableVersioningIfInside).not.toHaveBeenCalled()
  })
})
