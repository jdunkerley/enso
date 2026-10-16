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

/** The answers to the repository prompts that last beyond a session (Task 19). */
export interface RepositoryPromptsState {
  /** Local roots for which "Don't ask again for this folder" was chosen at "Create". */
  readonly declinedRoots: readonly string[]
  /** Existing repositories for which "Don't ask again" was chosen at "Use". */
  readonly declinedRepositories: readonly string[]
}

/** What the store works with; the app's are {@link useLocalVersioning}'s, tests pass their own. */
export interface LocalVersioningDependencies {
  readonly localBackend: () => LocalBackend | null
  readonly modals: ModalsStore
  readonly toasts: ToastsStore
  readonly getText: ReturnType<typeof useText>['getText']
  readonly prompts: PersistedStore<RepositoryPromptsState>
  readonly pollIntervalMs?: number
}

interface WatchedProject {
  readonly path: Path
  readonly flush: () => Promise<FlushOutcome>
  timer: ReturnType<typeof setTimeout> | undefined
  inFlight: Promise<void> | undefined
  /** A refresh was asked for while one was in flight. */
  again: boolean
  stopped: boolean
}

/** Create the store. The app uses the global one, {@link useLocalVersioning}. */
export function createLocalVersioningStore(deps: LocalVersioningDependencies) {
  const pollIntervalMs = deps.pollIntervalMs ?? VERSIONING_POLL_INTERVAL_MS
  const statuses = shallowReactive(new Map<ProjectId, VersioningStatus>())
  const watched = new Map<ProjectId, WatchedProject>()
  /** Repositories already offered to `enableVersioningIfInside` this session. */
  const offeredToShim = new Set<string>()

  async function readStatus(projectId: ProjectId, project: WatchedProject) {
    const backend = deps.localBackend()
    if (backend == null) return
    try {
      let status = await backend.versioningStatus(project.path)
      if (
        status.git &&
        status.repoRoot != null &&
        !status.enabled &&
        !status.optedOut &&
        !offeredToShim.has(status.repoRoot)
      ) {
        offeredToShim.add(status.repoRoot)
        const { enabled } = await backend.enableVersioningIfInside(
          status.repoRoot,
          backend.rootPath(),
        )
        if (enabled) status = await backend.versioningStatus(project.path)
      }
      if (!project.stopped) statuses.set(projectId, status)
    } catch (error) {
      console.warn(`Could not read the versioning status of '${project.path}':`, error)
    }
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
          await readStatus(projectId, project)
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
  }

  function statusOf(projectId: ProjectId) {
    return statuses.get(projectId)
  }

  function isVersioned(projectId: ProjectId) {
    return statuses.get(projectId)?.enabled === true
  }

  return { watchProject, unwatchProject, refresh, statusOf, isVersioned }
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
