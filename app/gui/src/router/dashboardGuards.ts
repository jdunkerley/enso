import { useAuth } from '$/providers/auth'
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
} from 'enso-common/src/services/Backend'
import { newDirectoryId, type LocalBackend } from 'enso-common/src/services/LocalBackend'
import { platform, Platform } from 'enso-common/src/utilities/detect'
import { getFileName } from 'enso-common/src/utilities/file'
import type { NavigationGuardReturn, RouteLocation } from 'vue-router'

export const SAMPLES_DIRECTORY = 'Samples'
export const LOCAL_WELCOME_PROJECT_RELATIVE_PATH = `${SAMPLES_DIRECTORY}/Getting_Started`

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

/** Get path of the project to auto-open on application launch. */
export async function welcomeProjectPath(
  cliStartupProject: string | undefined,
  { localBackend }: { localBackend: BackendAPI<LocalBackend> | null },
): Promise<string | undefined> {
  if (cliStartupProject?.startsWith('file:')) return undefined
  // If not file url, we expect this parameter to be a project name
  if (cliStartupProject) return `${localBackend?.rootPath()}/${cliStartupProject}`
  if (await shouldOpenWelcomeProject(localBackend)) {
    return `${localBackend?.rootPath()}/${LOCAL_WELCOME_PROJECT_RELATIVE_PATH}`
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
  const auth = useAuth()

  // Always set: the local session. PR 3 makes it non-null.
  if (auth.session == null) return

  const pathFromOptions =
    config.params.startup.project && backends.localBackend ?
      await uploadProjectArchive(config.params.startup.project, backends.localBackend)
    : undefined

  const initialPath =
    pathFromOptions ?? (await welcomeProjectPath(config.params.startup.project, backends))

  return initialPath ? { name: 'ensoPath', params: { path: initialPath.split('/') } } : true
}

async function shouldOpenWelcomeProject(localBackend: Pick<LocalBackend, 'listDirectory'> | null) {
  const navigatedInDrive =
    window.localStorage.getItem('enso-category-id') ||
    window.localStorage.getItem('enso-current-directory-id')
  if (navigatedInDrive) return false

  const homeDirQuery = {
    parentId: null,
    filterBy: null,
    labels: null,
    sortExpression: null,
    sortDirection: null,
    from: null,
    pageSize: null,
    recentProjects: false,
  }
  const onError = (err: unknown) => {
    console.error('Cannot read user home directory; will skip launching Welcome Project', err)
    return null
  }
  const localHome =
    localBackend == null ?
      { assets: [] }
    : await localBackend.listDirectory(homeDirQuery).catch(onError)
  if (localHome == null) return false
  return !localHome.assets.some((asset) => {
    return asset.type != AssetType.directory || asset.title != SAMPLES_DIRECTORY
  })
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
