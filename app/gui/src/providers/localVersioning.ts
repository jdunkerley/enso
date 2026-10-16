/**
 * @file Versioning of the open local projects with git, through the shim's `versioning/*` routes
 * (`LocalBackend`): each project's status, read when it opens and then every 5 s while it stays
 * open; saving a version; and offering a repository when none is in use. See the design,
 * `docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`.
 *
 * Polling is this store's own loop, not vue-query: a project never has two status requests in
 * flight (an invalidation would cancel one and start another, while the shim still runs the first).
 * A refresh asked for while one is pending runs once, right after it.
 *
 * `projectStates.ts` tells the store when a local project is initialized and when it stops
 * (`watchProject`, `unwatchProject`); the store does not read the opened projects itself.
 */
import { useModals, type ModalsStore } from '$/providers/modals'
import type { FlushOutcome } from '$/providers/openedProjects/project/flush'
import { useText } from '$/providers/text'
import { useToasts, type ToastsStore } from '$/providers/toasts'
import { createPersistedStore, type PersistedStore } from '$/utils/persistedStore'
import { createGlobalState } from '@vueuse/core'
import { extractTypeAndPath, type Path, type ProjectId } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { shallowReactive } from 'vue'
import { useBackends } from './backends'

/** How often an open project's status is read, counted from the previous answer. */
export const VERSIONING_POLL_INTERVAL_MS = 5_000

/**
 * How long a status request is waited for. A git operation that timed out in the shim can hold a
 * repository busy, so a request may take very long; past this the status is reported unknown, but
 * no new request is issued until the pending one settles.
 */
export const VERSIONING_REQUEST_TIMEOUT_MS = 20_000

/** The answers to the repository prompts that last beyond a session (Task 19). */
export interface RepositoryPromptsState {
  /** Local roots for which "Don't ask again for this folder" was chosen at "Create". */
  readonly declinedRoots: readonly string[]
  /** Existing repositories for which "Don't ask again" was chosen at "Use". */
  readonly declinedRepositories: readonly string[]
}

/** The part of {@link LocalBackend} the store calls (tests stub just this). */
export type LocalVersioningBackend = Pick<
  LocalBackend,
  'rootPath' | 'versioningStatus' | 'enableVersioningIfInside'
>

/** What the store works with; the app's are {@link useLocalVersioning}'s, tests pass their own. */
export interface LocalVersioningDependencies {
  readonly localBackend: () => LocalVersioningBackend | null
  readonly modals: ModalsStore
  readonly toasts: ToastsStore
  readonly getText: ReturnType<typeof useText>['getText']
  readonly prompts: PersistedStore<RepositoryPromptsState>
  readonly pollIntervalMs?: number
  readonly requestTimeoutMs?: number
}

interface WatchedProject {
  readonly path: Path
  readonly flush: () => Promise<FlushOutcome>
  timer: ReturnType<typeof setTimeout> | undefined
  inFlight: Promise<void> | undefined
  /** A refresh was asked for while one was in flight. */
  again: boolean
  stopped: boolean
  /** The last read failed or timed out, and the failure was already logged. */
  failing: boolean
}

const TIMED_OUT = Symbol('timed out')

/** Create the store. The app uses the global one, {@link useLocalVersioning}. */
export function createLocalVersioningStore(deps: LocalVersioningDependencies) {
  const pollIntervalMs = deps.pollIntervalMs ?? VERSIONING_POLL_INTERVAL_MS
  const requestTimeoutMs = deps.requestTimeoutMs ?? VERSIONING_REQUEST_TIMEOUT_MS
  const statuses = shallowReactive(new Map<ProjectId, VersioningStatus>())
  /** Projects whose status could not be read (failed or timed out): no status, not a stale one. */
  const unknown = shallowReactive(new Set<ProjectId>())
  const watched = new Map<ProjectId, WatchedProject>()
  /**
   * The real request pending for each project, kept apart from the watch so that re-watching a
   * project (close and reopen) still waits for it. It never rejects.
   */
  const pending = new Map<ProjectId, Promise<void>>()
  /** Repositories already offered to `enableVersioningIfInside` this session. */
  const offeredToShim = new Set<string>()

  /** Wait for `promise`, at most {@link requestTimeoutMs}. */
  async function withTimeout(promise: Promise<void>): Promise<void | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), requestTimeoutMs)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  function markUnknown(projectId: ProjectId, project: WatchedProject, reason: unknown) {
    if (project.stopped) return
    statuses.delete(projectId)
    unknown.add(projectId)
    if (!project.failing) {
      project.failing = true
      console.warn(`Could not read the versioning status of '${project.path}':`, reason)
    }
  }

  /** The real request: read (and maybe enable) and store the result. Never rejects. */
  async function fetchAndStore(projectId: ProjectId, project: WatchedProject): Promise<void> {
    const backend = deps.localBackend()
    if (backend == null) return
    let offered: string | undefined
    try {
      let status = await backend.versioningStatus(project.path)
      if (
        status.git &&
        status.repoRoot != null &&
        !status.enabled &&
        !status.optedOut &&
        !offeredToShim.has(status.repoRoot)
      ) {
        offered = status.repoRoot
        offeredToShim.add(offered)
        const { enabled } = await backend.enableVersioningIfInside(
          status.repoRoot,
          backend.rootPath(),
        )
        if (enabled) status = await backend.versioningStatus(project.path)
      }
      if (project.stopped) return
      project.failing = false
      unknown.delete(projectId)
      statuses.set(projectId, status)
    } catch (error) {
      // A transient failure must not suppress the offer for the session.
      if (offered != null) offeredToShim.delete(offered)
      markUnknown(projectId, project, error)
    }
  }

  /** One read: wait out an earlier pending request, then issue ours, waiting for it a while. */
  async function readOnce(projectId: ProjectId, project: WatchedProject): Promise<boolean> {
    const earlier = pending.get(projectId)
    if (earlier != null) {
      if ((await withTimeout(earlier)) === TIMED_OUT) {
        markUnknown(projectId, project, new Error('the previous status request is still pending'))
        return false
      }
      if (project.stopped) return false
    }
    const real = fetchAndStore(projectId, project)
    pending.set(projectId, real)
    void real.finally(() => {
      if (pending.get(projectId) === real) pending.delete(projectId)
    })
    if ((await withTimeout(real)) === TIMED_OUT) {
      markUnknown(projectId, project, new Error('the status request timed out'))
      return false
    }
    return true
  }

  function refresh(projectId: ProjectId): Promise<void> {
    const project = watched.get(projectId)
    if (project == null) return Promise.resolve()
    if (project.inFlight != null) {
      project.again = true
      return project.inFlight
    }
    clearTimeout(project.timer)
    project.timer = undefined
    project.inFlight = (async () => {
      try {
        do {
          project.again = false
          // After a timeout the coalesced re-run is left to the next poll, which waits for the
          // pending request: refresh() awaiters are released instead of kept waiting on it.
          if (!(await readOnce(projectId, project))) break
        } while (project.again && !project.stopped)
      } finally {
        project.inFlight = undefined
        if (!project.stopped) {
          project.timer = setTimeout(() => void refresh(projectId), pollIntervalMs)
        }
      }
    })()
    return project.inFlight
  }

  function watchProject(projectId: ProjectId, flush: () => Promise<FlushOutcome>) {
    unwatchProject(projectId)
    watched.set(projectId, {
      path: extractTypeAndPath(projectId).path,
      flush,
      timer: undefined,
      inFlight: undefined,
      again: false,
      stopped: false,
      failing: false,
    })
    void refresh(projectId)
  }

  function unwatchProject(projectId: ProjectId) {
    const project = watched.get(projectId)
    if (project == null) return
    project.stopped = true
    clearTimeout(project.timer)
    watched.delete(projectId)
    statuses.delete(projectId)
    unknown.delete(projectId)
  }

  /** The last status read, or `undefined` while none is known (see {@link isStatusUnknown}). */
  function statusOf(projectId: ProjectId) {
    return statuses.get(projectId)
  }

  /** Whether the last read failed or timed out, so the project's status is not known. */
  function isStatusUnknown(projectId: ProjectId) {
    return unknown.has(projectId)
  }

  function isVersioned(projectId: ProjectId) {
    return statuses.get(projectId)?.enabled === true
  }

  return { watchProject, unwatchProject, refresh, statusOf, isStatusUnknown, isVersioned }
}

/** The store's type. */
export type LocalVersioningStore = ReturnType<typeof createLocalVersioningStore>

/** The app's local versioning store. */
export const useLocalVersioning = createGlobalState(() => {
  const backends = useBackends()
  return createLocalVersioningStore({
    localBackend: () => {
      const backend = backends.localBackend
      return backend instanceof LocalBackend ? backend : null
    },
    modals: useModals(),
    toasts: useToasts(),
    getText: useText().getText,
    prompts: createPersistedStore<RepositoryPromptsState>(
      () => ({ declinedRoots: [], declinedRepositories: [] }),
      { name: 'enso-local-versioning-prompts', version: 1 },
    ),
  })
})
