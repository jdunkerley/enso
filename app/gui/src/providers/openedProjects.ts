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
import { shallowReactive } from 'vue'
import type { ProjectInfo, RunningProjectInfo } from './openedProjects/projectInfo'
import { useProjectStates, type ProjectState } from './openedProjects/projectStates'

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
        projectStates.closeProjectInBackend(backendProject.asset)
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
    opening: (state: ProjectState) => {
      switch (state.status) {
        case 'not-opened':
          return projectStates.openProject(state)
        case 'opened':
          return projectStates.initializeProject(state)
        case 'initialized':
          break
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
        case 'opened':
        case 'initialized':
          return projectStates.closeProject(state, {
            offer: !closingWithoutOffer.has(state.info.id),
          })
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

  // Before the app unloads, the projects' stores are cleaned up, but the projects are not closed:
  // the project manager's processes are killed anyway.
  window.addEventListener('beforeunload', () => {
    for (const project of projects.values()) {
      if (project.state.status === 'initialized') {
        project.state.scope.stop()
      }
    }
  })

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
  }
}

/**
 * A store containing states of all projects opened by this app instance.
 */
export const useOpenedProjects = createGlobalState(createOpenedProjectsStore)
