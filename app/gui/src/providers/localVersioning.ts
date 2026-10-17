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
import RepositoryPromptModal from '$/components/LocalVersioning/RepositoryPromptModal.vue'
import SaveVersionModal from '$/components/LocalVersioning/SaveVersionModal.vue'
import { useModals, type ModalsStore } from '$/providers/modals'
import type { FlushOutcome } from '$/providers/openedProjects/project/flush'
import { useText } from '$/providers/text'
import { useToasts, type ToastsStore } from '$/providers/toasts'
import { createPersistedStore, type PersistedStore } from '$/utils/persistedStore'
import { createGlobalState } from '@vueuse/core'
import { extractTypeAndPath, type Path, type ProjectId } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
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
  | 'rootPath'
  | 'versioningStatus'
  | 'enableVersioningIfInside'
  | 'initVersioning'
  | 'enableVersioning'
  | 'commitVersion'
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

/** What became of {@link LocalVersioningStore.offerRepository}. */
export type RepositoryOffer =
  /** The repository is enabled: versions are kept. */
  | 'ready'
  /** The user chose Not now or Don't ask again, earlier or now, or opted out. */
  | 'declined'
  /** No repository, and the project is outside the local root: none is offered. */
  | 'outsideRoot'
  | 'noGit'
  /** Not watched, no local backend, or quitting. */
  | 'unavailable'
  /** The user accepted, but creating or enabling the repository failed (a toast says why). */
  | 'failed'

const TIMED_OUT = Symbol('timed out')

/** Create the store. The app uses the global one, {@link useLocalVersioning}. */
export function createLocalVersioningStore(deps: LocalVersioningDependencies) {
  const pollIntervalMs = deps.pollIntervalMs ?? VERSIONING_POLL_INTERVAL_MS
  const requestTimeoutMs = deps.requestTimeoutMs ?? VERSIONING_REQUEST_TIMEOUT_MS
  const statuses = shallowReactive(new Map<ProjectId, VersioningStatus>())
  /** Projects whose status could not be read (failed or timed out): no status, not a stale one. */
  const unknown = shallowReactive(new Set<ProjectId>())
  /** Whether git was found, as last read for each project: kept while a read fails. */
  const gitFound = shallowReactive(new Map<ProjectId, boolean>())
  const watched = new Map<ProjectId, WatchedProject>()
  /**
   * The real request pending for each project, kept apart from the watch so that re-watching a
   * project (close and reopen) still waits for it. It never rejects.
   */
  const pending = new Map<ProjectId, Promise<void>>()
  /** Repositories already offered to `enableVersioningIfInside` this session. */
  const offeredToShim = new Set<string>()
  let quitting = false
  /** Folders answered "Not now" this session. */
  const notNowThisSession = new Set<string>()

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
      gitFound.set(projectId, status.git)
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
    gitFound.delete(projectId)
  }

  /** The last status read, or `undefined` while none is known (see {@link isStatusUnknown}). */
  function statusOf(projectId: ProjectId) {
    return statuses.get(projectId)
  }

  /** Whether the last read failed or timed out, so the project's status is not known. */
  function isStatusUnknown(projectId: ProjectId) {
    return unknown.has(projectId)
  }

  /**
   * Whether git was found, by the last read that succeeded; `false` before any did. Unlike
   * {@link statusOf}, it is kept while the status is unknown, so that UI shown only with git (the
   * save icon) does not flicker when one read fails.
   */
  function hasGit(projectId: ProjectId) {
    return gitFound.get(projectId) === true
  }

  function isVersioned(projectId: ProjectId) {
    return statuses.get(projectId)?.enabled === true
  }

  /**
   * A local path spelt one way: forward slashes, no trailing one (but the root's own), the drive
   * letter lowercase. Paths on a drive compare case-insensitively, see {@link pathKey}.
   */
  function normalizePath(path: string) {
    let result = path.replaceAll('\\', '/')
    if (result.length > 1 && result.endsWith('/') && !/^[a-zA-Z]:\/$/.test(result)) {
      result = result.replace(/\/+$/, '')
    }
    return result.replace(/^[a-zA-Z]:/, (drive) => drive.toLowerCase())
  }

  /** What two spellings of the same local path have in common. */
  function pathKey(path: string) {
    const normalized = normalizePath(path)
    return /^[a-z]:/.test(normalized) ? normalized.toLowerCase() : normalized
  }

  /** Whether `path` is `folder` or inside it; both are the GUI's own spellings of local paths. */
  function isAtOrUnder(path: string, folder: string) {
    const key = pathKey(path)
    const folderKey = pathKey(folder)
    return (
      key === folderKey || key.startsWith(folderKey.endsWith('/') ? folderKey : `${folderKey}/`)
    )
  }

  function includesPath(paths: readonly string[], folder: string) {
    return paths.some((path) => pathKey(path) === pathKey(folder))
  }

  /** The offers being made, so that a second request joins the first rather than asking again. */
  const offering = new Map<ProjectId, Promise<RepositoryOffer>>()

  async function askRepository(kind: 'create' | 'use', folder: string) {
    let dontAskAgain = false
    const answer = await deps.modals.ask(RepositoryPromptModal, {
      kind,
      folder,
      onDontAskAgain: () => {
        dontAskAgain = true
      },
    })
    return (
      answer === 'confirm' ? 'accept'
      : dontAskAgain ? 'dontAskAgain'
      : 'notNow'
    )
  }

  /**
   * Make sure the project's repository is enabled, asking once if need be: Create when there is
   * none (at the local root), Use for an existing one the provider could not enable silently.
   * Nothing is asked while quitting, or again after "Don't ask again"; "Not now" is remembered for
   * the session, but only a `'close'` honours it. A request made while another is being answered
   * for the same project gets that one's result.
   */
  function offerRepository(
    projectId: ProjectId,
    reason: 'close' | 'save',
  ): Promise<RepositoryOffer> {
    const existing = offering.get(projectId)
    if (existing != null) return existing
    const offer = makeOffer(projectId, reason).finally(() => {
      if (offering.get(projectId) === offer) offering.delete(projectId)
    })
    offering.set(projectId, offer)
    return offer
  }

  async function makeOffer(
    projectId: ProjectId,
    reason: 'close' | 'save',
  ): Promise<RepositoryOffer> {
    const project = watched.get(projectId)
    const backend = deps.localBackend()
    if (project == null || backend == null || quitting) return 'unavailable'
    // A known status that asks nothing is answered as it is, so that a close (or a save) does not
    // wait for a git round trip, or for two request timeouts on a wedged shim; polling keeps it
    // current. Anything else is read again first, since the answer decides what is asked.
    const known = statuses.get(projectId)
    const settled = known != null && (!known.git || known.enabled || known.optedOut)
    if (!settled) await refresh(projectId)
    const status = statuses.get(projectId)
    if (status == null) return 'unavailable'
    if (!status.git) return 'noGit'
    if (status.enabled) return 'ready'
    if (status.optedOut) return 'declined'
    const kind = status.repoRoot == null ? 'create' : 'use'
    const folder = status.repoRoot ?? backend.rootPath()
    // A saved local directory outside the root is versioned only if already in a repository.
    if (kind === 'create' && !isAtOrUnder(project.path, folder)) return 'outsideRoot'
    const declinedKey = kind === 'create' ? 'declinedRoots' : 'declinedRepositories'
    if (includesPath(deps.prompts.getState()[declinedKey], folder)) return 'declined'
    if (reason === 'close' && notNowThisSession.has(pathKey(folder))) return 'declined'
    switch (await askRepository(kind, folder)) {
      case 'notNow':
        notNowThisSession.add(pathKey(folder))
        return 'declined'
      case 'dontAskAgain': {
        // Read again: the state may have changed while the prompt was open.
        const declined = deps.prompts.getState()[declinedKey]
        if (!includesPath(declined, folder)) {
          deps.prompts.setState({ [declinedKey]: [...declined, normalizePath(folder)] })
        }
        return 'declined'
      }
      case 'accept':
        try {
          if (kind === 'create') await backend.initVersioning(folder)
          else await backend.enableVersioning(folder)
        } catch (error) {
          deps.toasts.show(
            `${deps.getText('versioningSetupError')}: ${getMessageOrToString(error)}`,
            { type: 'error' },
          )
          return 'failed'
        }
        await refresh(projectId)
        return statuses.get(projectId)?.enabled === true ? 'ready' : 'declined'
    }
  }

  /** The saves being made, so that a second request for the same project is ignored. */
  const saving = new Map<ProjectId, Promise<void>>()

  /**
   * Save a version: make sure a repository is in use, write the open modules, then commit with
   * `comment` as given (the shim saves an empty one as "Saved"). A declined write is a failure:
   * an error toast, and no commit. A save asked for while one is being made for the project is
   * that one: no second commit is started.
   */
  function save(projectId: ProjectId, comment = ''): Promise<void> {
    const existing = saving.get(projectId)
    if (existing != null) return existing
    const result = makeSave(projectId, comment).finally(() => {
      if (saving.get(projectId) === result) saving.delete(projectId)
    })
    saving.set(projectId, result)
    return result
  }

  async function makeSave(projectId: ProjectId, comment: string) {
    const project = watched.get(projectId)
    const backend = deps.localBackend()
    if (project == null || backend == null) return
    const offer = await offerRepository(projectId, 'save')
    if (offer !== 'ready') {
      // 'failed' has its own toast, and the rest need no word.
      if (offer === 'declined') {
        deps.toasts.show(deps.getText('versioningOffForFolder'), { type: 'info' })
      } else if (offer === 'outsideRoot') {
        deps.toasts.show(deps.getText('versioningNotForThisFolder'), { type: 'info' })
      }
      return
    }
    const blocked = statuses.get(projectId)?.blocked
    if (blocked != null) {
      deps.toasts.show(deps.getText('versioningBlocked', blocked), { type: 'error' })
      return
    }
    try {
      const written = await project.flush()
      if (written.kind === 'declined') {
        deps.toasts.show(`${deps.getText('saveVersionError')}: ${written.reason}`, {
          type: 'error',
        })
        return
      }
      const { id } = await backend.commitVersion(projectId, comment)
      if (id == null) {
        deps.toasts.show(deps.getText('versionNothingToSave'), { type: 'info' })
      } else {
        deps.toasts.show(
          deps.getText(written.kind === 'waited' ? 'versionSavedAfterWaiting' : 'versionSaved'),
          { type: 'success' },
        )
      }
    } catch (error) {
      deps.toasts.show(`${deps.getText('saveVersionError')}: ${getMessageOrToString(error)}`, {
        type: 'error',
      })
    } finally {
      await refresh(projectId)
    }
  }

  /** Open the "Save a version" dialog, whose Save saves with its comment. */
  function askToSave(projectId: ProjectId) {
    deps.modals.open(SaveVersionModal, {
      onSave: (comment: string) => save(projectId, comment),
    })
  }

  /** Off when blocked, or when an enabled repository has nothing to save. */
  function canSave(projectId: ProjectId) {
    const status = statuses.get(projectId)
    if (status == null || !status.git || status.blocked != null) return false
    return !status.enabled || status.repoRoot == null || status.changed
  }

  /** Tell the user that a project was closed, but its "Saved on close" version was not saved. */
  function showCloseWarning(title: string, warning: string) {
    deps.toasts.show(deps.getText('versionOnCloseWarning', title, warning), { type: 'warning' })
  }

  /** While quitting nothing is asked. */
  function setQuitting(value: boolean) {
    quitting = value
  }

  /** Forget every "Don't ask again" and "Not now". */
  function resetPrompts() {
    deps.prompts.setState({ declinedRoots: [], declinedRepositories: [] })
    notNowThisSession.clear()
  }

  return {
    watchProject,
    unwatchProject,
    refresh,
    statusOf,
    isStatusUnknown,
    hasGit,
    isVersioned,
    offerRepository,
    setQuitting,
    resetPrompts,
    save,
    askToSave,
    canSave,
    showCloseWarning,
  }
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
