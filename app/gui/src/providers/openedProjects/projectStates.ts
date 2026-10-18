/** @file Project states definitions and a composable for transitions between them. */
import { backendMutationOptions as backendMutationOptionsFor } from '$/utils/backendQuery'
import { backendMutationOptions } from '@/composables/backend'
import { useAiAvailability } from '@/stores/aiAvailability'
import { assert, assertDefined } from '@/util/assert'
import * as vueQuery from '@tanstack/vue-query'
import {
  Backend,
  ProjectState as BackendProjectState,
  IS_OPENING,
  NetworkError,
  type Project as ProjectDetails,
  type ProjectId,
} from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { Err, Ok, rejectionToResult, type Result } from 'enso-common/src/utilities/data/result'
import {
  computed,
  effectScope,
  markRaw,
  onScopeDispose,
  watch,
  type EffectScope,
  type Ref,
} from 'vue'
import { useBackends } from '../backends'
import { useLocalVersioning } from '../localVersioning'
import { useText } from '../text'
import { createGraphStore, type GraphStore } from './graph'
import { createModuleStore, type ModuleStore } from './module'
import { createProjectStore, type ProjectStore } from './project'
import type { ProjectInfo, RunningProjectInfo } from './projectInfo'
import { createProjectNameStore, type ProjectNameStore } from './projectNames'
import { createSuggestionDbStore, type SuggestionDbStore } from './suggestionDatabase'
import { WidgetRegistry } from './widgetRegistry'

/** Project which is not opened by this app instance. */
export interface NotOpened {
  status: 'not-opened'
  info: ProjectInfo
}

/**
 * A project with opened state in the backend.
 */
export interface Opened {
  status: 'opened'
  info: RunningProjectInfo
  runningId: ProjectId
  scope: EffectScope
  details?: Ref<ProjectDetails>
}

/**
 * A project with all stores initialized.
 */
export interface Initialized {
  status: 'initialized'
  info: RunningProjectInfo
  runningId: ProjectId
  details: Ref<ProjectDetails>
  runDetails: Ref<ProjectDetails>
  name: Ref<string>
  scope: EffectScope
  store: ProjectStore
  projectNames: ProjectNameStore
  suggestionDb: SuggestionDbStore
  module: ModuleStore
  graph: GraphStore
  widgetRegistry: WidgetRegistry
}

/**
 * A project which was running when application closed, and should be now restored.
 *
 *
 */
export interface ToRestore {
  status: 'to-restore'
  info: RunningProjectInfo
}

/**
 * A project which was running when application closed, but cannot be restored, because it was
 * closed/released by backend in the meantime.
 */
export interface ClosedByBackend {
  status: 'closed-by-backend'
  info: RunningProjectInfo
  scope: EffectScope
  details: Ref<ProjectDetails>
}

/**
 *  A state of a project.
 *
 * The states covers entire possible lifespan of a project, may be discerned by `status` field.
 * The main, working state of opened project is {@link Initialized}; it contains all project stores.
 */
export type ProjectState = NotOpened | Opened | Initialized | ToRestore | ClosedByBackend

/**
 * A composable with project state transiting operations.
 *
 * The methods usually take an existing project state and returns a new state.
 */
export function useProjectStates() {
  const backends = useBackends()
  const text = useText()
  const queryClient = vueQuery.useQueryClient()
  const localVersioning = useLocalVersioning()
  const aiAvailability = useAiAvailability()

  const openLocalProject = vueQuery.useMutation(
    backendMutationOptions('openProject', backends.localBackend),
  )
  // The plain options (`$/utils/backendQuery`), not the Vue wrapper's `computed`: their key,
  // network mode and invalidations are kept, while the call returns the close commit's warning.
  const localCloseOptions = backendMutationOptionsFor(backends.localBackend, 'closeProject')
  const closeLocalProject = vueQuery.useMutation({
    ...(localCloseOptions.mutationKey != null && { mutationKey: localCloseOptions.mutationKey }),
    ...(localCloseOptions.networkMode != null && { networkMode: localCloseOptions.networkMode }),
    ...(localCloseOptions.meta != null && { meta: localCloseOptions.meta }),
    mutationFn: ([id, title]: readonly [ProjectId, string]) => {
      const localBackend = backends.localBackend
      if (!(localBackend instanceof LocalBackend))
        throw new Error('Cannot close local project: no local backend')
      return localBackend.closeProjectReportingVersioning(id, title)
    },
  })
  const renameProjectMut = renameProjectMutation(queryClient)

  const catchNetworkError = rejectionToResult(NetworkError)

  /** Open a project locally. */
  async function openProject(project: NotOpened): Promise<Result<Opened>> {
    if (!backends.localBackend) return Err('Cannot open local project: Local Backend missing.')
    const result = await catchNetworkError(
      openLocalProject.mutateAsync([project.info.id, { executeAsync: false }, project.info.title]),
    )
    if (!result.ok) return result
    return Ok({
      status: 'opened',
      info: project.info,
      runningId: project.info.id,
      scope: effectScope(),
    })
  }

  /** Initialize stores for an opened project. */
  async function initializeProject(project: Opened): Promise<Result<Initialized>> {
    const scope = project.scope
    const detailsResult =
      project.details ? Ok(project.details) : await getProjectDetails(project.info, scope)
    if (!detailsResult.ok) return detailsResult
    const details = detailsResult.value
    // A local project runs as itself: its running details are its details.
    const runDetails = details

    // Wait for project to be ready.
    await new Promise((resolve) => {
      if (runDetails.value.state.type === BackendProjectState.opened) resolve(undefined)
      scope.run(() => {
        const unwatch = watch(
          () => runDetails.value.state.type,
          (type) => {
            if (type === BackendProjectState.opened) {
              unwatch()
              resolve(undefined)
            }
          },
        )
      })
    })

    const runningId = project.info.id
    const projectNames = scope.run(() =>
      createProjectNameStore({
        projectNamespace: 'local',
        projectDisplayedName: () => details.value.name,
        projectInitialName: runDetails.value.packageName,
      }),
    )!

    const store = await scope.run(() => {
      const rpcUrl = runDetails.value.jsonAddress
      const ydocUrl = runDetails.value.ydocAddress
      assert(rpcUrl != null, text.getText('noJSONEndpointError'))
      assert(ydocUrl != null, "Could not get the address of the project's ydoc endpoint")
      return createProjectStore(
        {
          projectId: runningId,
          projectAssetId: project.info.id,
          engine: {
            rpcUrl,
            ydocUrl,
          },
        },
        projectNames,
      )
    })!

    const suggestionDb = scope.run(() => createSuggestionDbStore(store, projectNames))!
    const module = await scope.run(() => createModuleStore(store, projectNames, suggestionDb))!
    if (!module.ok) return module

    // Resolve the local Claude agent's availability before declaring the project initialized.
    // The Component Browser reads the cached value synchronously when opened, and a deferred
    // probe would race with the user clicking "new node" right after the editor mounts.
    await aiAvailability.promise

    return scope.run(() => {
      const graph = createGraphStore(store, suggestionDb, projectNames, module.value)
      const widgetRegistry = new WidgetRegistry(graph.db)
      const projectId = project.info.id
      localVersioning.watchProject(projectId, () => store.flushModules())
      onScopeDispose(() => localVersioning.unwatchProject(projectId))

      return Ok(
        markRaw({
          status: 'initialized' as const,
          info: project.info,
          runningId,
          name: computed(() => details.value.name),
          details,
          runDetails,
          store,
          projectNames,
          suggestionDb,
          module: module.value,
          graph,
          widgetRegistry,
          scope,
        } satisfies Initialized),
      )
    })!
  }

  /** Get details of opened project from the backend. */
  async function getProjectDetails(info: RunningProjectInfo, scope: EffectScope) {
    if (backends.localBackend == null)
      return Err('Cannot get details of local project: no local backend.')
    return Ok(
      await getProjectDetailsFromBackend(backends.localBackend, info.id, scope, queryClient),
    )
  }

  /**
   * Close opened project. A local one is first offered a repository (`localVersioning`), unless
   * `offer` is false (sign-out closes every project without asking). Neither the question nor the
   * close commit's warning can stop the close.
   */
  async function closeProject(
    project: Opened | Initialized,
    { offer = true }: { offer?: boolean } = {},
  ): Promise<Result<NotOpened>> {
    if (backends.localBackend == null) {
      project.scope.stop()
      return Err('Cannot close local project: no local backend')
    }
    // The question needs the project to be watched, and stopping the scope unwatches it.
    if (offer) {
      try {
        await localVersioning.offerRepository(project.info.id, 'close')
      } catch (error) {
        console.error('Could not offer a repository before closing the project:', error)
      }
    }
    project.scope.stop()
    const { versioningWarning } = await closeLocalProject.mutateAsync([
      project.info.id,
      project.info.title,
    ])
    if (versioningWarning != null) {
      try {
        localVersioning.showCloseWarning(project.info.title, versioningWarning)
      } catch (error) {
        console.error('Could not show the close commit warning:', error)
      }
    }
    return Ok({
      status: 'not-opened',
      info: project.info,
    })
  }

  /** Close project which has "opened" state in backend */
  function closeProjectInBackend(project: { id: ProjectId; title: string }) {
    closeLocalProject.mutate([project.id, project.title])
  }

  /** Rename project. It updates proper structures with a new name. */
  async function renameProject(
    project: Initialized,
    newName: string,
  ): Promise<Result<Initialized>> {
    const backend = backends.localBackend
    if (backend == null) {
      return Err('Failed to rename project: no Backend available')
    }
    const result = await catchNetworkError(
      renameProjectMut.mutateAsync({ project: project.info, newName, backend }),
    )
    if (!result.ok) return result
    void localVersioning.refresh(project.info.id)
    return Ok(markRaw({ ...project, info: { ...project.info, title: newName } }))
  }

  /** Restore project after app restart: a local project is opened outright. */
  async function restoreProject(project: ToRestore): Promise<Result<Opened | ClosedByBackend>> {
    return openProject({ status: 'not-opened', info: project.info })
  }

  /** Confirm a restored project reopening. */
  async function reopenProject(project: ClosedByBackend): Promise<Result<Opened>> {
    return openProject({ status: 'not-opened', info: project.info })
  }

  /** Discard the restored project. */
  async function discardProject(project: ToRestore | ClosedByBackend): Promise<Result<NotOpened>> {
    return Ok({ status: 'not-opened', info: project.info })
  }

  return {
    openProject,
    initializeProject,
    closeProject,
    closeProjectInBackend,
    renameProject,
    restoreProject,
    reopenProject,
    discardProject,
  }
}

/** Default interval for refetching project status when the project is opened. */
const OPENED_INTERVAL_MS = 30_000
/**
 * Interval when we open a project or when we want to sync the project status as soon as possible.
 */
const LOCAL_OPENING_INTERVAL_MS = 100

const DEFAULT_INTERVAL_MS = 120_000

const STATIC_PROJECT_STATES = new Set([BackendProjectState.opened, BackendProjectState.closed])
const CREATED_PROJECT_STATES = new Set([BackendProjectState.created, BackendProjectState.new])

async function getProjectDetailsFromBackend(
  backend: Backend,
  id: ProjectId,
  scope: EffectScope,
  queryClient: vueQuery.QueryClient,
) {
  const detailsQuery = scope.run(() =>
    vueQuery.useQuery(
      {
        queryKey: getProjectDetailsQueryKey(id),
        queryFn: () => backend.getProjectDetails(id),
        refetchIntervalInBackground: true,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        networkMode: 'always',
        meta: { persist: false },
        refetchInterval: ({ state }): number | false => {
          if (state.status === 'error' || !state.data) {
            return false
          }
          if (CREATED_PROJECT_STATES.has(state.data.state.type)) {
            return LOCAL_OPENING_INTERVAL_MS
          }
          if (STATIC_PROJECT_STATES.has(state.data.state.type)) {
            return OPENED_INTERVAL_MS
          }
          if (IS_OPENING[state.data.state.type]) {
            return LOCAL_OPENING_INTERVAL_MS
          }
          return DEFAULT_INTERVAL_MS
        },
      },
      queryClient,
    ),
  )
  assertDefined(detailsQuery)
  await detailsQuery.suspense()

  const details = computed<ProjectDetails>((old) => {
    const data = detailsQuery.data.value ?? old
    assertDefined(data)
    return data
  })

  return details
}

function getProjectDetailsQueryKey(id: ProjectId) {
  return ['project', id] as const
}

function renameProjectMutation(queryClient: vueQuery.QueryClient) {
  return vueQuery.useMutation(
    {
      mutationKey: ['renameProject'],
      mutationFn: ({
        project,
        backend,
        newName,
      }: {
        project: ProjectInfo
        backend: Backend
        newName: string
      }) => {
        const { id, title } = project

        return backend.updateProject(id, { projectName: newName }, title)
      },
      onMutate: async ({ project, newName }) => {
        const queryKey = getProjectDetailsQueryKey(project.id)
        await queryClient.cancelQueries({ queryKey })
        // Optimistically update the project name.
        queryClient.setQueryData<ProjectDetails>(queryKey, (data) => {
          if (data == null) return undefined
          return {
            ...data,
            name: newName,
          }
        })

        return { queryKey }
      },
      onError: (_err, _variables, context) => {
        if (context?.queryKey) {
          // Invalidate the optimistic response.
          return queryClient.invalidateQueries({ queryKey: context.queryKey })
        }
      },
      meta: {
        invalidates: [['listDirectory'], ['project'], ['getAssetDetails']],
        awaitInvalidates: true,
      },
    },
    queryClient,
  )
}
