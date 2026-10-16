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
import { newProjectId } from 'enso-common/src/services/LocalBackend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createLocalVersioningStore,
  VERSIONING_POLL_INTERVAL_MS,
  VERSIONING_REQUEST_TIMEOUT_MS,
  type LocalVersioningBackend,
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

function setup(backendOverrides: Partial<LocalVersioningBackend> = {}) {
  const backend: LocalVersioningBackend = {
    rootPath: () => ROOT,
    versioningStatus: vi.fn(async (_path: Path) => status()),
    enableVersioningIfInside: vi.fn(async () => ({ enabled: false })),
    initVersioning: vi.fn(async (root: Path) => ({ repoRoot: root })),
    enableVersioning: vi.fn(async () => {}),
    ...backendOverrides,
  }
  const modals = createModalsStore()
  const toasts = createToastsStore()
  const prompts = createPersistedStore<RepositoryPromptsState>(
    () => ({ declinedRoots: [], declinedRepositories: [] }),
    { name: 'test-local-versioning-prompts', version: 1 },
  )
  const store = createLocalVersioningStore({
    localBackend: () => backend,
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
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS)
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

  test('a failed status is unknown, not the previous one; it is logged once per streak', async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(status({ changed: true }))
      .mockRejectedValueOnce(new Error('shim down'))
      .mockRejectedValueOnce(new Error('shim down'))
      .mockResolvedValue(status())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.statusOf(PROJECT)?.changed).toBe(true)
    expect(store.isStatusUnknown(PROJECT)).toBe(false)
    await vi.advanceTimersByTimeAsync(2 * VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(3)
    expect(store.statusOf(PROJECT)).toBeUndefined()
    expect(store.isStatusUnknown(PROJECT)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(store.statusOf(PROJECT)?.changed).toBe(false)
    expect(store.isStatusUnknown(PROJECT)).toBe(false)
  })

  test('re-watching a project with a request pending waits for it', async () => {
    const first = deferred<VersioningStatus>()
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(status())
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    store.unwatchProject(PROJECT)
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(versioningStatus).toHaveBeenCalledTimes(1)
    first.resolve(status())
    await vi.advanceTimersByTimeAsync(0)
    expect(versioningStatus).toHaveBeenCalledTimes(2)
    expect(store.statusOf(PROJECT)).toEqual(status())
  })

  test('a request that never settles: status unknown after the timeout, no new request', async () => {
    const hung = deferred<VersioningStatus>()
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockReturnValueOnce(hung.promise)
      .mockResolvedValue(status({ changed: true }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    const awaited = store.refresh(PROJECT)
    let released = false
    void awaited.then(() => (released = true))
    await vi.advanceTimersByTimeAsync(VERSIONING_REQUEST_TIMEOUT_MS - 1)
    expect(released).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(released).toBe(true)
    expect(store.isStatusUnknown(PROJECT)).toBe(true)
    expect(store.statusOf(PROJECT)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(5 * VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(1)
    hung.resolve(status())
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(2)
    expect(store.isStatusUnknown(PROJECT)).toBe(false)
    expect(store.statusOf(PROJECT)?.changed).toBe(true)
  })

  test('two projects are polled independently', async () => {
    const other: ProjectId = newProjectId(Path('/root/Q'))
    const { backend, store } = setup()
    store.watchProject(PROJECT, FLUSHED)
    store.watchProject(other, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(backend.versioningStatus).toHaveBeenCalledTimes(2)
    store.unwatchProject(PROJECT)
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(backend.versioningStatus).toHaveBeenCalledTimes(3)
    expect(backend.versioningStatus).toHaveBeenLastCalledWith(Path('/root/Q'))
    expect(store.statusOf(other)).toEqual(status())
    expect(store.statusOf(PROJECT)).toBeUndefined()
  })

  test('unwatching during a request writes nothing and starts no timer', async () => {
    const first = deferred<VersioningStatus>()
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(status())
    const { store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    store.unwatchProject(PROJECT)
    first.resolve(status())
    await vi.advanceTimersByTimeAsync(3 * VERSIONING_POLL_INTERVAL_MS)
    expect(versioningStatus).toHaveBeenCalledTimes(1)
    expect(store.statusOf(PROJECT)).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
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

  test('a failed offer is made again on the next read', async () => {
    const versioningStatus = vi.fn(async () => status({ enabled: false }))
    const enableVersioningIfInside = vi
      .fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue({ enabled: false })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { store } = setup({ versioningStatus, enableVersioningIfInside })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(VERSIONING_POLL_INTERVAL_MS)
    expect(enableVersioningIfInside).toHaveBeenCalledTimes(2)
  })

  test('not a git repository: nothing is offered', async () => {
    const versioningStatus = vi.fn(async () =>
      status({ git: false, repoRoot: null, enabled: false }),
    )
    const enableVersioningIfInside = vi.fn(async () => ({ enabled: false }))
    const { store } = setup({ versioningStatus, enableVersioningIfInside })
    store.watchProject(PROJECT, FLUSHED)
    await vi.advanceTimersByTimeAsync(0)
    expect(enableVersioningIfInside).not.toHaveBeenCalled()
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

/** Answer the repository prompt on top of the stack, and take it off, as the host would. */
async function answerPrompt(
  modals: ReturnType<typeof createModalsStore>,
  answer: 'accept' | 'notNow' | 'dontAskAgain',
) {
  await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1))
  const entry = modals.stack.value[0]!
  const props = entry.props as {
    onConfirm: () => Promise<void>
    onCancel: () => Promise<void>
    onDontAskAgain: () => void
  }
  if (answer === 'accept') await props.onConfirm()
  else {
    if (answer === 'dontAskAgain') props.onDontAskAgain()
    await props.onCancel()
  }
  modals.close(entry.key)
}

describe('offerRepository', () => {
  const noRepository = () => status({ repoRoot: null, enabled: false, changed: true })

  test('Create makes a repository at the root; the project is then versioned', async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValue(status({ changed: true }))
    const { backend, modals, store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    const offered = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'accept')
    await expect(offered).resolves.toBe('ready')
    expect(backend.initVersioning).toHaveBeenCalledWith(ROOT)
    expect(modals.stack.value).toHaveLength(0)
  })

  test('Not now: a close does not ask again this session, a save does', async () => {
    const { modals, store } = setup({ versioningStatus: vi.fn(async () => noRepository()) })
    store.watchProject(PROJECT, FLUSHED)
    const first = store.offerRepository(PROJECT, 'close')
    await answerPrompt(modals, 'notNow')
    await expect(first).resolves.toBe('declined')
    await expect(store.offerRepository(PROJECT, 'close')).resolves.toBe('declined')
    expect(modals.stack.value).toHaveLength(0)
    const save = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'notNow')
    await expect(save).resolves.toBe('declined')
  })

  test("Don't ask again is remembered per root, until reset", async () => {
    const { modals, prompts, store } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
    })
    store.watchProject(PROJECT, FLUSHED)
    const first = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'dontAskAgain')
    await expect(first).resolves.toBe('declined')
    expect(prompts.getState().declinedRoots).toEqual([ROOT])
    await expect(store.offerRepository(PROJECT, 'save')).resolves.toBe('declined')
    expect(modals.stack.value).toHaveLength(0)
    store.resetPrompts()
    expect(prompts.getState()).toEqual({ declinedRoots: [], declinedRepositories: [] })
    void store.offerRepository(PROJECT, 'save')
    await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1))
  })

  test('Use enables an existing repository outside the root', async () => {
    const outside = status({ repoRoot: Path('/'), enabled: false })
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(outside)
      .mockResolvedValueOnce(outside)
      .mockResolvedValue(status({ repoRoot: Path('/') }))
    const { backend, modals, store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    const offered = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'accept')
    await expect(offered).resolves.toBe('ready')
    expect(backend.enableVersioning).toHaveBeenCalledWith('/')
  })

  test('a repository the user turned off is not offered', async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () => status({ enabled: false, optedOut: true })),
    })
    store.watchProject(PROJECT, FLUSHED)
    await expect(store.offerRepository(PROJECT, 'save')).resolves.toBe('declined')
    expect(modals.stack.value).toHaveLength(0)
  })

  test('nothing is asked while quitting', async () => {
    const { modals, store } = setup({ versioningStatus: vi.fn(async () => noRepository()) })
    store.watchProject(PROJECT, FLUSHED)
    store.setQuitting(true)
    await expect(store.offerRepository(PROJECT, 'close')).resolves.toBe('unavailable')
    expect(modals.stack.value).toHaveLength(0)
  })

  test('nothing is asked for a project outside the root with no repository', async () => {
    const { modals, store } = setup({ versioningStatus: vi.fn(async () => noRepository()) })
    const elsewhere = newProjectId(Path('/elsewhere/Q'))
    store.watchProject(elsewhere, FLUSHED)
    await expect(store.offerRepository(elsewhere, 'save')).resolves.toBe('outsideRoot')
    expect(modals.stack.value).toHaveLength(0)
  })

  test('nothing is asked without git', async () => {
    const { modals, store } = setup({
      versioningStatus: vi.fn(async () => status({ git: false, repoRoot: null, enabled: false })),
    })
    store.watchProject(PROJECT, FLUSHED)
    await expect(store.offerRepository(PROJECT, 'save')).resolves.toBe('noGit')
    expect(modals.stack.value).toHaveLength(0)
  })

  test('an enabled repository needs no question', async () => {
    const { modals, store } = setup()
    store.watchProject(PROJECT, FLUSHED)
    await expect(store.offerRepository(PROJECT, 'save')).resolves.toBe('ready')
    expect(modals.stack.value).toHaveLength(0)
  })

  test('concurrent offers share one prompt, one init and one result', async () => {
    const versioningStatus = vi
      .fn<(path: Path) => Promise<VersioningStatus>>()
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValueOnce(noRepository())
      .mockResolvedValue(status({ changed: true }))
    const { backend, modals, store } = setup({ versioningStatus })
    store.watchProject(PROJECT, FLUSHED)
    const a = store.offerRepository(PROJECT, 'save')
    const b = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'accept')
    await expect(a).resolves.toBe('ready')
    await expect(b).resolves.toBe('ready')
    expect(backend.initVersioning).toHaveBeenCalledOnce()
    expect(modals.stack.value).toHaveLength(0)
  })

  test.each([
    ['backslashes', String.raw`C:\Users\x\enso`, 'C:/Users/x/enso/P'],
    ['a trailing separator', 'C:/Users/x/enso/', 'C:/Users/x/enso/P'],
    ['another drive-letter case', 'c:/Users/x/enso', 'C:/Users/x/enso/P'],
  ])('a root spelt with %s still contains its projects', async (_name, root, projectPath) => {
    const project = newProjectId(Path(projectPath))
    const { modals, store } = setup({
      rootPath: () => Path(root),
      versioningStatus: vi.fn(async () => noRepository()),
    })
    store.watchProject(project, FLUSHED)
    void store.offerRepository(project, 'save')
    await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1))
  })

  test("Don't ask again is keyed by the normalised root, without duplicates", async () => {
    const { modals, prompts, store } = setup({
      rootPath: () => Path('C:\\Users\\x\\enso\\'),
      versioningStatus: vi.fn(async () => noRepository()),
    })
    const project = newProjectId(Path('C:/Users/x/enso/P'))
    store.watchProject(project, FLUSHED)
    const first = store.offerRepository(project, 'save')
    await answerPrompt(modals, 'dontAskAgain')
    await first
    expect(prompts.getState().declinedRoots).toEqual(['c:/Users/x/enso'])
    prompts.setState({ declinedRoots: [] })
    store.resetPrompts()
    const second = store.offerRepository(project, 'save')
    await vi.waitFor(() => expect(modals.stack.value).toHaveLength(1))
    prompts.setState({ declinedRoots: ['c:/Users/x/enso'] })
    await answerPrompt(modals, 'dontAskAgain')
    await second
    expect(prompts.getState().declinedRoots).toEqual(['c:/Users/x/enso'])
  })

  test('a setup failure is reported as failed, with a toast', async () => {
    const { modals, store, toasts } = setup({
      versioningStatus: vi.fn(async () => noRepository()),
      initVersioning: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const show = vi.spyOn(toasts, 'show')
    store.watchProject(PROJECT, FLUSHED)
    const offered = store.offerRepository(PROJECT, 'save')
    await answerPrompt(modals, 'accept')
    await expect(offered).resolves.toBe('failed')
    expect(show).toHaveBeenCalled()
  })
})
