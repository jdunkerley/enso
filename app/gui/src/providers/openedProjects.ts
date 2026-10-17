import { assert } from '@/util/assert'
import { createGlobalState } from '@vueuse/core'
import {
  IS_OPENING as BACKEND_IS_OPENING,
  IS_OPENING_OR_OPENED as BACKEND_IS_OPENING_OR_OPENED,
  BackendType,
  ProjectId,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { Err, Ok, type Result, type ResultError } from 'enso-common/src/utilities/data/result'
import { isOnElectron } from 'enso-common/src/utilities/detect'
import { ref, shallowReactive } from 'vue'
import { useLocalVersioning } from './localVersioning'
import type { ProjectInfo, RunningProjectInfo } from './openedProjects/projectInfo'
import {
  useProjectStates,
  type HybridLocallyClosed,
  type Initialized,
  type ProjectState,
} from './openedProjects/projectStates'
import { closeEachWithin } from './openedProjects/quit'

/** A reason given to AbortController when opening, restoring or closing process is being aborted. */
const PROCESS_ABORTED = 'aborted'

/** A type of process */
export type Process = 'opening' | 'closing' | 'restoring'

/** A project opened by this app instance. */
export interface Project {
  /** Project state. See {@link ProjectState} for all possible project states. */
  state: ProjectState
  /** A opening, closing or restoring step which is currently performed on given state. */
  nextTask:
    | {
        abort: AbortController
        process: Process
        promise: Promise<Result<ProjectState>>
      }
    | undefined
  /** Error of the last unsuccessful step of opening, closing or restoring. */
  error: ResultError | Error | undefined
}

/**
 * A type for Opened Project Store.
 */
export type OpenedProjectsStore = ReturnType<typeof useOpenedProjects>

/**
 * Constructor of Opened Project Store.
 */
export function createOpenedProjectsStore() {
  const projects = shallowReactive(new Map<ProjectId, Project>())

  const projectStates = useProjectStates()
  const localVersioning = useLocalVersioning()
  /** Whether the unsynced hybrid projects are being uploaded as the app exits. */
  const closingOnAppExit = ref(false)
  /** Whether the versioned local projects are being closed (saving a version) as the app exits. */
  const savingVersionsOnAppExit = ref(false)
  const projectReadyCallbacks: ((project: Project) => void)[] = []

  /** Open project. */
  function openProject(info: ProjectInfo) {
    const project =
      projects.get(info.id) ??
      shallowReactive({
        state: {
          status: 'not-opened' as const,
          info,
        },
        nextTask: undefined,
        error: undefined,
      })
    if (project.state.status === 'not-opened') {
      project.state.info = info
    }
    projects.set(info.id, project)
    performProcess(project, 'opening')
    return project
  }

  /**
   * Restore a project which was running on app close.
   *
   * The project may be opened or put in "closed by backend" state.
   *
   * In case of hybrid projects, the local version is assumed to be already downloaded.
   */
  function restoreProject(info: RunningProjectInfo) {
    const existing = projects.get(info.id)
    if (
      existing == null ||
      (existing?.nextTask == null && existing?.state.status === 'not-opened')
    ) {
      const project = shallowReactive({
        state: { status: 'to-restore' as const, info },
        nextTask: undefined,
        error: undefined,
      })
      projects.set(info.id, project)
      performProcess(project, 'restoring')
    } else {
      performProcess(existing, 'restoring')
    }
  }

  /**
   * Close given project. If `backendProject` is provided, the project will be closed even if not
   * running by current app instance.
   */
  function closeProject(
    id: ProjectId,
    backendProject?: { asset: ProjectAsset; backendType: BackendType },
    { offer = true }: { offer?: boolean } = {},
  ) {
    const project = projects.get(id)
    if (project == null) {
      if (backendProject == null) {
        console.warn('Cannot close project: project not opened')
      } else {
        projectStates.closeProjectInBackend(backendProject.asset, backendProject.backendType)
      }

      return
    }
    if (!offer) closingWithoutOffer.add(id)
    void performProcess(project, 'closing').finally(() => closingWithoutOffer.delete(id))
  }

  /** Projects being closed without the repository question (see {@link closeAllProjects}). */
  const closingWithoutOffer = new Set<ProjectId>()

  /** Close all projects run by this app instance. */
  function closeAllProjects() {
    for (const id of projects.keys()) closeProject(id, undefined, { offer: false })
  }

  /** Rename a running project. */
  async function renameProject(id: ProjectId, newName: string) {
    const project = projects.get(id)
    if (project?.state.status !== 'initialized') return Err('Cannot rename non-running project')
    const renamed = await projectStates.renameProject(project.state, newName)
    if (!renamed.ok) return renamed
    return Ok()
  }

  /** Perform a process across mulitple project states until finished or errored. */
  async function performProcess(project: Project, process: Process) {
    const abort = new AbortController()
    if (project.nextTask != null) {
      if (project.nextTask.process === process) {
        return
      } else {
        project.nextTask.abort.abort(PROCESS_ABORTED)
        project.nextTask = undefined
      }
    }
    DEV: assert(project.nextTask == null)
    try {
      do {
        if (project.nextTask != null) {
          const result: Result<ProjectState> = await project.nextTask.promise
          abort.signal.throwIfAborted()
          if (result.ok) {
            project.state = result.value
            if (project.state.status === 'initialized') {
              for (const cb of projectReadyCallbacks) {
                cb(project)
              }
            }
          } else {
            project.error = result.error
            project.nextTask = undefined
            break
          }
        }
        project.error = undefined
        const promise = PROCESS_STEPS[process](project.state, abort.signal)
        project.nextTask = promise ? { abort, promise, process } : undefined
      } while (project.nextTask != null)
    } catch (err) {
      if (err === PROCESS_ABORTED) {
        console.log(`${process} process aborted.`)
      } else {
        console.error(`${process} process interrupted by error.`, { cause: err })
        project.error = Error(`${process} process interrupted by error.`, { cause: err })
        project.nextTask = undefined
      }
    }
  }

  const PROCESS_STEPS: {
    [K in Process]: (
      state: ProjectState,
      abort: AbortSignal,
    ) => Promise<Result<ProjectState>> | undefined
  } = {
    opening: (state: ProjectState, abort: AbortSignal) => {
      switch (state.status) {
        case 'not-opened':
          return projectStates.openProject(state)
        case 'hybrid-opened':
          return projectStates.downloadHybridProject(state)
        case 'hybrid-downloaded':
          return projectStates.openLocalVersionOfHybridProject(state, abort)
        case 'opened':
          return projectStates.initializeProject(state)
        case 'initialized':
          break
        case 'hybrid-closed':
        case 'hybrid-uploaded':
          return projectStates.reopenLocalVersionOfHybridProject(state)
        case 'to-restore':
          return projectStates.restoreProject(state)
        case 'closed-by-backend':
          return projectStates.reopenProject(state)
      }
    },
    closing: (state: ProjectState) => {
      switch (state.status) {
        case 'not-opened':
          break
        case 'hybrid-opened':
          return projectStates.closeHybridProject(state)
        case 'hybrid-downloaded':
          return projectStates.closeHybridProject(state)
        case 'opened':
        case 'initialized':
          return projectStates.closeProject(state, {
            offer: !closingWithoutOffer.has(state.info.id),
          })
        case 'hybrid-closed':
          return projectStates.uploadHybridProjectOnClose(state)
        case 'hybrid-uploaded':
          return projectStates.closeHybridProject(state)
        case 'to-restore':
        case 'closed-by-backend':
          return projectStates.discardProject(state)
      }
    },
    restoring: (state: ProjectState, abort: AbortSignal) => {
      if (state.status !== 'closed-by-backend') return PROCESS_STEPS.opening(state, abort)
    },
  }

  /** Wait for the current project's process finish (including failure). */
  async function waitForProcess(project: Project) {
    while (project.nextTask != null) {
      await project.nextTask.promise.catch((err) =>
        console.log('Waited-for process resulted in error', err),
      )
    }
  }

  /** Get data of project with given id. */
  function get(id: ProjectId): Project | undefined {
    return projects.get(id)
  }

  /** List all projects opened by current app instance. */
  function listProjects() {
    return projects.values()
  }

  /** Check if given asset is in process of opening, either by us or in backend only. */
  function isProjectOpening(asset: ProjectAsset) {
    const openedByMe = projects.get(asset.id)
    if (openedByMe != null) {
      return openedByMe.nextTask?.process === 'opening'
    } else {
      return BACKEND_IS_OPENING[asset.projectState.type]
    }
  }

  /** Check if given asset is opened, either by us or in backend only. */
  function isProjectOpened(asset: ProjectAsset) {
    const openedByMe = projects.get(asset.id)
    if (openedByMe != null && openedByMe.state.status !== 'not-opened') {
      return openedByMe.nextTask == null && openedByMe.state.status === 'initialized'
    } else {
      return (
        !BACKEND_IS_OPENING[asset.projectState.type] &&
        BACKEND_IS_OPENING_OR_OPENED[asset.projectState.type]
      )
    }
  }

  /** Check if given asset is in process of closing, either by us or in backend only. */
  function isProjectClosing(id: ProjectId) {
    return projects.get(id)?.nextTask?.process === 'closing'
  }

  /** Whether {@link finishBeforeQuit} is under way. */
  let finishingBeforeQuit = false
  /**
   * Projects the quit has already tried to close. One that failed or ran out of time is not tried
   * again, so the `beforeunload` from `window.close()` does not hold the quit a second time.
   */
  const closedOnQuit = new Set<ProjectId>()

  // On quit: upload the unsynced hybrid projects (they are not removed from the local backend, but
  // synchronized with remote in case someone else opens it meanwhile), and close every open local
  // project whose versions are kept, so that each saves its "Saved on close" version. Then close
  // the window. `preventDefault` must be called synchronously, so the work runs afterwards.
  window.addEventListener('beforeunload', (event) => {
    // A second quit while the first is finishing (which only happens on Electron) waits for it.
    if (finishingBeforeQuit) {
      event.preventDefault()
      return
    }
    const hybridsToUpload = [...projects.values()].filter(
      (proj): proj is Project & { state: Initialized | HybridLocallyClosed } =>
        (proj.state.status === 'initialized' || proj.state.status === 'hybrid-closed') &&
        proj.state.info.mode === 'hybrid' &&
        !proj.state.info.synced,
    )
    // A project is closed unless it is known not to keep versions: one whose status could not be
    // read, or has not been read yet, is closed too, since the shim commits only where the user
    // has agreed to versions. Browsers hold nothing for local projects (dev servers only).
    const versionedToClose =
      isOnElectron() ?
        [...projects.values()].filter(
          (proj) =>
            proj.state.status === 'initialized' &&
            proj.state.info.mode === 'local' &&
            !closedOnQuit.has(proj.state.info.id) &&
            localVersioning.statusOf(proj.state.info.id)?.enabled !== false,
        )
      : []
    if (hybridsToUpload.length === 0 && versionedToClose.length === 0) {
      // Do the project cleanup, but do not close projects entirely.
      // Local projects's PM process will be killed anyway, and
      // Cloud projects should be kept opened.
      for (const project of projects.values()) {
        if (project.state.status === 'initialized') project.state.scope.stop()
      }
      return
    }
    // Do not prevent default in browsers.
    // In "real" browsers users will be unable to run hybrid projects anyway, but in dev
    // servers the "data loss" messages are annoying.
    if (!isOnElectron()) return
    event.preventDefault()
    void finishBeforeQuit(hybridsToUpload, versionedToClose)
  })

  /**
   * Upload the hybrid projects and close the versioned local ones, all at once, behind the exit
   * dialog; then close the window, unless a hybrid project is in error. No repository is offered
   * meanwhile: the closes pass `offer: false`, and {@link localVersioning} is told the app quits.
   */
  async function finishBeforeQuit(
    hybridsToUpload: readonly (Project & { state: Initialized | HybridLocallyClosed })[],
    versionedToClose: readonly Project[],
  ) {
    finishingBeforeQuit = true
    closingOnAppExit.value = hybridsToUpload.length > 0
    savingVersionsOnAppExit.value = versionedToClose.length > 0
    localVersioning.setQuitting(true)
    for (const project of versionedToClose) closedOnQuit.add(project.state.info.id)
    try {
      const [hybridErrors] = await Promise.all([
        // Uploads have no time limit, deliberately: one would quit before unsynced changes reach
        // the Cloud.
        Promise.all(
          hybridsToUpload.map(async (project) => {
            assert(project.state.info.mode === 'hybrid')
            await projectStates
              .uploadHybridProject(project.state.info)
              .catch((error: unknown) =>
                console.error('Could not sync a hybrid project on quit:', error),
              )
            return project
          }),
        ).then((uploaded) => uploaded.filter((proj) => proj.error != null)),
        closeEachWithin(versionedToClose, (project) => {
          closeProject(project.state.info.id, undefined, { offer: false })
          return waitForProcess(project)
        }),
      ])
      closingOnAppExit.value = false
      savingVersionsOnAppExit.value = false
      finishingBeforeQuit = false
      if (hybridErrors.length === 0) window.close()
      // The window stays open, but the versioned local projects have already closed.
      else stayOpen()
    } catch (error) {
      console.error('Could not finish before quitting:', error)
      closingOnAppExit.value = false
      savingVersionsOnAppExit.value = false
      finishingBeforeQuit = false
      stayOpen()
    }
  }

  /** The app is not quitting after all: the next quit tries every project again. */
  function stayOpen() {
    closedOnQuit.clear()
    localVersioning.setQuitting(false)
  }

  return {
    openProject,
    closeProject,
    closeAllProjects,
    renameProject,
    restoreProject,
    get,
    listProjects,
    isProjectOpening,
    isProjectOpened,
    isProjectClosing,
    waitForProcess,
    closingOnAppExit,
    savingVersionsOnAppExit,
  }
}

/**
 * A store containing states of all projects opened by this app instance.
 */
export const useOpenedProjects = createGlobalState(createOpenedProjectsStore)
