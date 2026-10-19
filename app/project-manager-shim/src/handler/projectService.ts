import { LabelName, Path, UUID, type LChColor } from 'enso-common/src/services/Backend'
import type * as http from 'node:http'
import * as datalinkFiles from '../datalinks.js'
import type { LocalMetadata } from '../localMetadata/index.js'
import type { LocalSecrets } from '../localSecrets/index.js'
import type { LocalVersioning } from '../localVersioning/index.js'
import { ProjectService } from '../projectService/index.js'
import { bodyJson, bodyJsonOrEmpty } from './http.js'
import { toJSONRPCError, toJSONRPCResult } from './jsonrpc.js'

const HTTP_STATUS_OK = 200

/** Check if this is a project service request */
export function isProjectServiceRequest(requestPath: string): boolean {
  return requestPath.startsWith('/api/project-service/')
}

/** A route's handler: it gets the store that serves the route, and the request body. */
type RouteHandler<Store> = (store: Store, body: Record<string, unknown>) => Promise<unknown>

/** The routes served by {@link LocalMetadata}, with the handler for each request body. */
const LOCAL_METADATA_ROUTES: Readonly<Record<string, RouteHandler<LocalMetadata>>> = {
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

/** What the {@link LOCAL_VERSIONING_ROUTES} handlers use. */
interface VersioningContext {
  readonly versioning: LocalVersioning
  readonly getProjectService: () => Promise<ProjectService>
}

/** The routes served by {@link LocalVersioning}. */
const LOCAL_VERSIONING_ROUTES: Readonly<Record<string, RouteHandler<VersioningContext>>> = {
  'versioning/status': ({ versioning }, body) => versioning.status(requireString(body, 'path')),
  'versioning/init': ({ versioning }, body) => versioning.init(requireString(body, 'rootPath')),
  'versioning/enable': async ({ versioning }, body) => {
    await versioning.enable(requireString(body, 'repoRoot'))
    return null
  },
  'versioning/disable': async ({ versioning }, body) => {
    await versioning.disable(requireString(body, 'repoRoot'))
    return null
  },
  'versioning/enable-if-inside': ({ versioning }, body) =>
    versioning.enableIfInside(requireString(body, 'repoRoot'), requireString(body, 'rootPath')),
  'versioning/commit': ({ versioning }, body) => {
    const message = requireString(body, 'message')
    // An empty message is a save without a comment.
    return versioning.commit(
      [requireString(body, 'path')],
      message.trim() === '' ? 'Saved' : message,
    )
  },
  'versioning/log': async ({ versioning }, body) => ({
    versions: await versioning.log(requireString(body, 'path')),
  }),
  'versioning/file-at': ({ versioning }, body) =>
    versioning.fileAt(
      requireString(body, 'path'),
      requireString(body, 'id'),
      requireString(body, 'relativePath'),
    ),
  'versioning/restore': async ({ versioning, getProjectService }, body) => {
    const projectPath = requireString(body, 'path')
    const id = requireString(body, 'id')
    const projectService = await getProjectService()
    if (await projectService.isProjectRunning(Path(projectPath))) {
      throw new Error('The project is running. Close it before restoring a version.')
    }
    return versioning.restore(projectPath, id)
  },
  'versioning/duplicate-at': async ({ versioning, getProjectService }, body) => {
    const projectPath = requireString(body, 'path')
    const id = requireString(body, 'id')
    const title = requireString(body, 'title')
    const parentPath = requireString(body, 'parentPath')
    const projectService = await getProjectService()
    return projectService.duplicateProjectInto(title, Path(parentPath), (targetPath) =>
      versioning.exportAt(projectPath, id, targetPath),
    )
  },
  'versioning/set-comment': async ({ versioning }, body) => {
    await versioning.setComment(
      requireString(body, 'path'),
      requireString(body, 'id'),
      requireString(body, 'comment'),
    )
    return null
  },
}

/** What the {@link LOCAL_SECRETS_ROUTES} handlers use. */
interface SecretsContext {
  readonly store: LocalSecrets
  /** Whether the key comes from `ENSO_SECRETS_KEY`, so the app cannot rotate it. */
  readonly keyFromEnvironment: boolean
}

/**
 * The routes served by {@link LocalSecrets}. None returns a secret value: the app writes values
 * and never reads them back.
 */
const LOCAL_SECRETS_ROUTES: Readonly<Record<string, RouteHandler<SecretsContext>>> = {
  'secrets/list': ({ store }) => store.list(),
  'secrets/create': async ({ store }, body) => {
    await store.create(requireString(body, 'name'), requireString(body, 'value'))
    return null
  },
  'secrets/update': async ({ store }, body) => {
    await store.update(requireString(body, 'name'), requireString(body, 'value'))
    return null
  },
  'secrets/delete': async ({ store }, body) => {
    await store.delete(requireString(body, 'name'))
    return null
  },
  'secrets/status': async ({ store, keyFromEnvironment }) => ({
    ...(await store.status()),
    keyFromEnvironment,
  }),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

/** The `datalink/` routes. Their "store" is the module itself, which needs no host state. */
const DATALINK_ROUTES: Readonly<Record<string, RouteHandler<typeof datalinkFiles>>> = {
  'datalink/read': (files, body) => files.readDatalink(requireString(body, 'path')),
  'datalink/create': async (files, body) => {
    await files.createDatalink(requireString(body, 'path'), requireValue(body, 'value'))
    return null
  },
  'datalink/update': async (files, body) => {
    await files.updateDatalink(requireString(body, 'path'), requireValue(body, 'value'))
    return null
  },
  'datalink/delete': async (files, body) => {
    await files.deleteDatalink(requireString(body, 'path'))
    return null
  },
}

function requireValue(body: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(body, key)) throw new Error(`'${key}' is required.`)
  return body[key]
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

/** Answer a request for one of the routes served by `store`. */
async function handleStoreRequest<Store>(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  name: string,
  handle: RouteHandler<Store>,
  store: Store | undefined,
  unavailableMessage: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    if (store == null) {
      throw new Error(unavailableMessage)
    }
    const body = await bodyJsonOrEmpty(request)
    if (!isRecord(body)) {
      throw new Error('The request body must be a JSON object.')
    }
    const result = await handle(store, body)
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
 * The label and Recent routes are served by `localMetadata`, the `versioning/` routes by
 * `localVersioning`, the `secrets/` routes by `localSecrets` (`keyFromEnvironment` says where its key
 * comes from), and the `datalink/` routes by `datalinks.ts`; without their store they answer with an error.
 */
export async function handleProjectServiceRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  requestPath: string,
  getProjectService: () => Promise<ProjectService>,
  headers: Record<string, string>,
  localMetadata?: LocalMetadata,
  localVersioning?: LocalVersioning,
  localSecrets?: LocalSecrets,
  keyFromEnvironment = false,
): Promise<void> {
  const routeName = requestPath.replace(/^\/api\/project-service\//, '')
  if (request.method === 'POST') {
    if (Object.hasOwn(LOCAL_METADATA_ROUTES, routeName)) {
      return handleStoreRequest(
        request,
        response,
        routeName,
        LOCAL_METADATA_ROUTES[routeName]!,
        localMetadata,
        'Local metadata is not available in this host.',
        headers,
      )
    }
    if (Object.hasOwn(LOCAL_VERSIONING_ROUTES, routeName)) {
      return handleStoreRequest(
        request,
        response,
        routeName,
        (store, body) =>
          LOCAL_VERSIONING_ROUTES[routeName]!({ versioning: store, getProjectService }, body),
        localVersioning,
        'Local versioning is not available in this host.',
        headers,
      )
    }
    if (Object.hasOwn(LOCAL_SECRETS_ROUTES, routeName)) {
      return handleStoreRequest(
        request,
        response,
        routeName,
        (store, body) => LOCAL_SECRETS_ROUTES[routeName]!({ store, keyFromEnvironment }, body),
        localSecrets,
        'Local secrets are not available in this host.',
        headers,
      )
    }
    if (Object.hasOwn(DATALINK_ROUTES, routeName)) {
      return handleStoreRequest(
        request,
        response,
        routeName,
        DATALINK_ROUTES[routeName]!,
        datalinkFiles,
        'Datalinks are not available in this host.',
        headers,
      )
    }
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
      }
      bodyJson<Body>(request)
        .then(async (body) => {
          const projectService = await getProjectService()
          return projectService.openProject(body.projectId, body.projectsDirectory)
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
        .then((closed) => {
          response.writeHead(HTTP_STATUS_OK, headers).end(toJSONRPCResult(closed))
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
