import { LabelName, Path, UUID, type LChColor } from 'enso-common/src/services/Backend'
import type * as http from 'node:http'
import type { LocalMetadata } from '../localMetadata/index.js'
import { ProjectService, type CloudParams } from '../projectService/index.js'
import { bodyJson, bodyJsonOrEmpty } from './http.js'
import { toJSONRPCError, toJSONRPCResult } from './jsonrpc.js'

const HTTP_STATUS_OK = 200

/** Check if this is a project service request */
export function isProjectServiceRequest(requestPath: string): boolean {
  return requestPath.startsWith('/api/project-service/')
}

/** The routes served by {@link LocalMetadata}, with the handler for each request body. */
const LOCAL_METADATA_ROUTES: Readonly<
  Record<string, (store: LocalMetadata, body: Record<string, unknown>) => Promise<unknown>>
> = {
  'labels/list': (store) => store.listLabels(),
  'labels/create': (store, body) =>
    store.createLabel(LabelName(requireString(body, 'value')), requireColor(body, 'color')),
  'labels/delete': async (store, body) => {
    await store.deleteLabel(requireString(body, 'id'))
    return null
  },
  'project/set-labels': async (store, body) => {
    await store.setProjectLabels(requireString(body, 'path'), requireStringArray(body, 'labels'))
    return null
  },
  'recent/list': (store) => store.listRecent(),
  'recent/record': async (store, body) => {
    await store.recordRecent(requireString(body, 'path'))
    return null
  },
  'recent/forget': async (store, body) => {
    await store.forgetRecent(requireString(body, 'path'))
    return null
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string') throw new Error(`'${key}' must be a string.`)
  return value
}

function requireStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`'${key}' must be an array of strings.`)
  }
  return value
}

function requireColor(body: Record<string, unknown>, key: string): LChColor {
  const value = body[key]
  if (isRecord(value)) {
    const { lightness, chroma, hue, alpha } = value
    if (
      typeof lightness === 'number' &&
      typeof chroma === 'number' &&
      typeof hue === 'number' &&
      (alpha == null || typeof alpha === 'number')
    ) {
      return { lightness, chroma, hue, ...(alpha != null ? { alpha } : {}) }
    }
  }
  throw new Error(`'${key}' must be an LCh colour.`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Answer a {@link LOCAL_METADATA_ROUTES} request. */
async function handleLocalMetadataRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  name: string,
  handle: (store: LocalMetadata, body: Record<string, unknown>) => Promise<unknown>,
  localMetadata: LocalMetadata | undefined,
  headers: Record<string, string>,
): Promise<void> {
  try {
    if (localMetadata == null) {
      throw new Error('Local metadata is not available in this host.')
    }
    const body = await bodyJsonOrEmpty(request)
    if (!isRecord(body)) {
      throw new Error('The request body must be a JSON object.')
    }
    const result = await handle(localMetadata, body)
    response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(result))
  } catch (error) {
    console.error(error)
    response
      .writeHead(HTTP_STATUS_OK, headers)
      .end(toJSONRPCError(`${name} failed: ${errorMessage(error)}`))
  }
}

/**
 * Handle project service requests.
 *
 * The label and Recent routes are served by `localMetadata`; without it they answer with an
 * error.
 */
export async function handleProjectServiceRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestPath: string,
  getProjectService: () => Promise<ProjectService>,
  headers: Record<string, string>,
  localMetadata?: LocalMetadata,
): Promise<void> {
  const localMetadataRouteName = requestPath.replace(/^\/api\/project-service\//, '')
  const localMetadataRoute =
    request.method === 'POST' && Object.hasOwn(LOCAL_METADATA_ROUTES, localMetadataRouteName) ?
      LOCAL_METADATA_ROUTES[localMetadataRouteName]
    : undefined
  if (localMetadataRoute != null) {
    return handleLocalMetadataRequest(
      request,
      response,
      localMetadataRouteName,
      localMetadataRoute,
      localMetadata,
      headers,
    )
  }
  switch (`${request.method} ${requestPath}`) {
    case 'POST /api/project-service/project/create': {
      interface ResponseBody {
        readonly name: string
        readonly projectsDirectory: Path
      }
      bodyJson<ResponseBody>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.createProject(body.name, body.projectsDirectory)
        })
        .then((result) => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(result))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/create failed', err))
        })
      break
    }
    case 'POST /api/project-service/project/open': {
      interface Body {
        readonly projectId: UUID
        readonly projectsDirectory: Path
        readonly cloud?: CloudParams
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.openProject(body.projectId, body.projectsDirectory, body.cloud)
        })
        .then((result) => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(result))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/open failed', err))
        })
      break
    }
    case 'POST /api/project-service/project/close': {
      interface Body {
        readonly projectId: UUID
        readonly projectsDirectory: Path
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.closeProject(body.projectId, body.projectsDirectory)
        })
        .then(() => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(null))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/close failed', err))
        })
      break
    }
    case 'POST /api/project-service/project/delete': {
      interface Body {
        readonly projectId: UUID
        readonly projectsDirectory: Path
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.deleteProject(body.projectId, body.projectsDirectory)
        })
        .then(() => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(null))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/delete failed', err))
        })
      break
    }
    case 'POST /api/project-service/project/duplicate': {
      interface Body {
        readonly projectId: UUID
        readonly projectsDirectory: Path
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.duplicateProject(body.projectId, body.projectsDirectory)
        })
        .then((result) => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(result))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/duplicate failed', err))
        })
      break
    }
    case 'POST /api/project-service/project/rename': {
      interface Body {
        readonly projectId: UUID
        readonly name: string
        readonly projectsDirectory: Path
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.renameProject(body.projectId, body.name, body.projectsDirectory)
        })
        .then(() => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(null))
        })
        .catch((err) => {
          console.error(err)
          response
            .writeHead(HTTP_STATUS_OK, headers)
            .end(toJSONRPCError('project/rename failed', err))
        })
      break
    }
    default: {
      const message = `Unknown project service request ${requestPath}`
      console.error(message)
      response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCError(message))
    }
  }
}
