import type { OpenedProjectsStore } from '$/providers/openedProjects'
import { useProjectFiles } from '@/stores/projectFiles'
import { EnsoPath, ProjectId } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { toValue } from 'vue'
import type { ResourceDefinition } from './AsyncResource'
import type { ResourceContext } from './context'
import { parseResourceUrl } from './parse'

/**
 * Create a resource resolver function that will use provided backends for accessing resource data.
 *
 * Part of 'asyncResources' store.
 * @internal
 */
export function useAsyncResourceResolver(
  backends: {
    localBackend: Opt<LocalBackend>
  },
  openedProjects: OpenedProjectsStore,
) {
  function resolveResourceInContext(
    url: string,
    context: ResourceContext,
  ): Result<ResourceDefinition> {
    const parsedUrl = parseResourceUrl(url, context.basePathSegments)
    if (!parsedUrl.ok) return parsedUrl
    switch (parsedUrl.value.kind) {
      case 'ensoPath': {
        return Ok(resolveEnsoPathResource(parsedUrl.value.ensoPath))
      }
      case 'webUrl': {
        return Ok(resolveWebResource(parsedUrl.value.url))
      }
      case 'projectRelative': {
        {
          const project = toValue(context.project)
          if (project == null) return Err('Cannot resolve relative path outside of project')
          return Ok(resolveProjectResource(project, parsedUrl.value.relativePath))
        }
      }
    }
  }

  /** An `enso://` path names an Enso Cloud asset, and there is no cloud to fetch it from. */
  function resolveEnsoPathResource(path: EnsoPath): ResourceDefinition {
    return {
      cacheKey: `ensoPath-${path}`,
      async fetch() {
        return Err('Cannot fetch an Enso Cloud resource: the IDE is local only.')
      },
    }
  }

  function resolveWebResource(url: URL): ResourceDefinition {
    return {
      cacheKey: `web-${url.href}`,
      async fetch() {
        return Ok(url)
      },
    }
  }

  function resolveProjectResource(projectId: ProjectId, relativePath: string): ResourceDefinition {
    return {
      cacheKey: `projectRelative-${projectId}-${relativePath}`,
      // A resource this client uploads has its `uploading` field set to the upload's data promise
      // by `finishResourceUpload`. With one client there are no other clients' uploads to wait on.
      async fetch(abort) {
        const openedProject = openedProjects.get(projectId)
        if (openedProject?.nextTask?.process === 'opening') {
          await openedProjects.waitForProcess(openedProject)
        }
        const initializedProject =
          openedProject?.state.status === 'initialized' ? openedProject.state : undefined
        if (initializedProject) {
          // An opened project's files come from its language server.
          const rootId = await initializedProject.store.projectRootId
          if (rootId == null) return Err('Could not identify project root')
          if (abort.aborted) return Err(abort)

          const projectFiles = useProjectFiles(initializedProject.store)
          return projectFiles.readFileBinary({ rootId, segments: relativePath.split('/') }, abort)
        } else {
          // An unopened project: read the file through the local backend.
          const localBackend = backends.localBackend
          if (!localBackend) return Err('Cannot query local resource without local backend')
          const response = await localBackend.resolveProjectAssetData(projectId, relativePath)
          if (abort.aborted) return Err(abort)
          return Ok(await response.blob())
        }
      },
    }
  }

  return resolveResourceInContext
}
