import { useBackends } from '$/providers/backends'
import { useConfig } from '$/providers/config'
import { routeFromTab, useContainerData, type Tab } from '$/providers/container'
import { backendQueryOptions } from '@/composables/backend'
import { useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  Backend,
  EnsoPath,
  extractTypeFromId,
  isProjectId,
  Path,
  ProjectId,
  type AssetDetailsResponse,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { newDirectoryId, type LocalBackend } from 'enso-common/src/services/LocalBackend'
import { platform, Platform } from 'enso-common/src/utilities/detect'
import { getFileName } from 'enso-common/src/utilities/file'
import type { NavigationGuardReturn, RouteLocation } from 'vue-router'

export const SAMPLES_DIRECTORY = 'Samples'
/** The bundled sample a fresh install opens, in `Samples`. */
export const WELCOME_PROJECT_NAME = 'Getting_Started'
/**
 * The project a fresh install opens: the bundled `Getting_Started` sample
 * (`app/electron-client/samples`), which the Electron app installs into `Samples` before it
 * loads the dashboard.
 */
export const LOCAL_WELCOME_PROJECT_RELATIVE_PATH = `${SAMPLES_DIRECTORY}/${WELCOME_PROJECT_NAME}`
/**
 * Set in `localStorage` when the welcome project is opened, so that it opens once: closing it and
 * starting again lands on the Drive, even before the user has a project of their own.
 */
export const WELCOME_PROJECT_OPENED_KEY = 'enso-welcome-project-opened'

type BackendAPI<B extends Backend> = Pick<B, 'rootPath' | 'listDirectory'>

/** Redirect from "ensoPath" route to proper asset's tab for this route. */
export async function redirectFromPath(to: RouteLocation) {
  if (to.params.path == null) return false
  const { localBackend } = useBackends()

  const path = EnsoPath(to.params.path instanceof Array ? to.params.path.join('/') : to.params.path)
  if (!path) return false

  if (localBackend == null) return false
  const resolvedPath = await localBackend.resolveEnsoPath(path).catch(() => null)
  const typedAsset = resolvedPath && extractTypeFromId(resolvedPath.id)
  switch (typedAsset?.type) {
    case AssetType.project:
      return { name: 'project', params: { id: typedAsset.id } }
    default:
      return { name: 'dashboard' }
  }
}

/** Redirect from "default" route to some opened tab (if any). */
export async function maybeRedirectToTab(to: RouteLocation) {
  if (to.name !== 'dashboard') return
  const containerData = useContainerData()
  const tab = containerData.nextTab
  if (tab != null) return routeFromTab(tab, to)
}

/**
 * Get path of the project to auto-open on application launch: the one named on the command line,
 * else, on a fresh install, the welcome project (once; see `WELCOME_PROJECT_OPENED_KEY`).
 * @param openWelcomeProject - `false` when the `--no-welcome-project` flag was given.
 */
export async function welcomeProjectPath(
  cliStartupProject: string | undefined,
  { localBackend }: { localBackend: BackendAPI<LocalBackend> | null },
  openWelcomeProject = true,
): Promise<string | undefined> {
  if (cliStartupProject?.startsWith('file:')) return undefined
  // If not file url, we expect this parameter to be a project name
  if (cliStartupProject) return `${localBackend?.rootPath()}/${cliStartupProject}`
  if (
    openWelcomeProject &&
    localBackend != null &&
    (await shouldOpenWelcomeProject(localBackend))
  ) {
    window.localStorage.setItem(WELCOME_PROJECT_OPENED_KEY, 'true')
    return `${localBackend.rootPath()}/${LOCAL_WELCOME_PROJECT_RELATIVE_PATH}`
  }
  return undefined
}

/**
 * A navigation guard for Dashboard page, which handles possible redirection to initial project
 * if any should be opened.
 *
 * It may be a project specified in CLI arguments or the Welcome project on fresh installs.
 */
export async function maybeRedirectToProject(to: RouteLocation): Promise<NavigationGuardReturn> {
  // Do not look for project if we already redirecting from somewhere to avoid redirect loop.
  if (to.name !== 'dashboard' || to.redirectedFrom != null) return
  const backends = useBackends()
  const config = useConfig()

  const pathFromOptions =
    config.params.startup.project && backends.localBackend ?
      await uploadProjectArchive(config.params.startup.project, backends.localBackend)
    : undefined

  const initialPath =
    pathFromOptions ??
    (await welcomeProjectPath(
      config.params.startup.project,
      backends,
      config.params.startup.welcomeProject,
    ))

  return initialPath ? { name: 'ensoPath', params: { path: initialPath.split('/') } } : true
}

/**
 * Whether this is a fresh install: the welcome project was never opened, the Drive was never
 * browsed, the projects folder holds nothing but `Samples`, and `Samples` holds the welcome
 * project. A `Samples` folder installed by a build without it (samples are copied only when
 * `Samples` is missing) is not enough.
 */
async function shouldOpenWelcomeProject(localBackend: Pick<LocalBackend, 'listDirectory'>) {
  if (window.localStorage.getItem(WELCOME_PROJECT_OPENED_KEY)) return false
  const navigatedInDrive =
    window.localStorage.getItem('enso-category-id') ||
    window.localStorage.getItem('enso-current-directory-id')
  if (navigatedInDrive) return false

  const onError = (err: unknown) => {
    console.error('Cannot read user home directory; will skip launching Welcome Project', err)
    return null
  }
  const list = (parentId: DirectoryId | null) =>
    localBackend
      .listDirectory({
        parentId,
        filterBy: null,
        labels: null,
        sortExpression: null,
        sortDirection: null,
        from: null,
        pageSize: null,
        recentProjects: false,
      })
      .catch(onError)
  const localHome = await list(null)
  const [samples, ...others] = localHome?.assets ?? []
  if (
    samples == null ||
    others.length > 0 ||
    samples.type !== AssetType.directory ||
    samples.title !== SAMPLES_DIRECTORY
  ) {
    return false
  }
  const inSamples = await list(samples.id)
  return (
    inSamples?.assets.some(
      (asset) => asset.type === AssetType.project && asset.title === WELCOME_PROJECT_NAME,
    ) ?? false
  )
}

async function uploadProjectArchive(
  url: string,
  localBackend: Pick<LocalBackend, 'uploadFileStart' | 'uploadFileEnd' | 'rootPath'>,
) {
  const filePath = fileURLToPath(url)
  if (filePath == null) return
  const projectName = getFileName(filePath)
  const parentDirectoryId = newDirectoryId(localBackend.rootPath())
  const metadata = await localBackend.uploadFileStart(
    {
      parentDirectoryId,
      fileName: projectName,
      fileId: null,
      filePath: Path(filePath),
    },
    null,
  )
  const endMetadata = await localBackend.uploadFileEnd({
    ...metadata,
  })
  if (endMetadata.project == null) {
    return
  }
  return endMetadata.project.ensoPath
}

/** Extract proper path from `file://` URL. */
function fileURLToPath(url: string): string | null {
  if (URL.canParse(url)) {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') {
      return decodeURIComponent(
        platform() === Platform.windows ?
          // On Windows, we must remove leading `/` from URL.
          parsed.pathname.slice(1)
        : parsed.pathname,
      )
    } else {
      return null
    }
  } else {
    return null
  }
}

/** If routing to a view assigned to some tab, open this tab. */
export async function openTab(to: RouteLocation) {
  switch (to.name) {
    case 'project': {
      const container = useContainerData()
      if (typeof to.params.id !== 'string' || !isProjectId(to.params.id)) return false
      const id = to.params.id
      const tab: Tab = { type: 'project', id }
      if (container.isTabOpened(tab)) {
        break
      }
      const { localBackend: backend } = useBackends()
      const queryClient = useQueryClient()

      if (backend == null) return false

      const options = backendQueryOptions('getAssetDetails', [id, undefined], backend)
      const assetResponse: AssetDetailsResponse<ProjectId> = await queryClient.fetchQuery(options)
      if (!assetResponse) return false

      container.openProjectLocally(assetResponse, backend.type, false)
      break
    }
    case 'settings': {
      const container = useContainerData()
      container.openSettingsTab(false)
    }
  }
}
