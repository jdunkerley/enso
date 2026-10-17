import { capitalizeFirst } from '$/utils/data/string'
import * as backend from 'enso-common/src/services/Backend'
import {
  Path,
  ProjectName,
  UUID,
  type Attributes,
  type CloseProjectParams,
  type CreateProject,
  type CreateProjectParams,
  type DatalinkEntry,
  type DirectoryEntry,
  type DuplicatedProject,
  type FileEntry,
  type FileSystemEntry,
  type JSONRPCResponse,
  type OpenProject,
  type OpenProjectParams,
  type ProjectEntry,
  type ProjectMetadata,
  type ProjectState,
  type RecentProjectEntry,
} from 'enso-common/src/services/ProjectManager/types'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { unsafeMutable } from 'enso-common/src/utilities/data/object'
import { getDirectoryAndName } from 'enso-common/src/utilities/file'
import { test } from 'integration-test/base'
import { uuidv4 } from 'lib0/random.js'
import { readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, WebSocketRoute } from 'playwright'
import { YjsChannel } from 'ydoc-channel'
import { WSSharedDoc, YjsConnection, type YjsSocket } from 'ydoc-server'
import { toJSONRPCError, toJSONRPCResult } from './jsonRpc'
import {
  createMockVersioning,
  registerVersioningRoutes,
  type VersioningMockContext,
} from './localVersioning'
import {
  clearPreprocessorOverrides,
  mockDataHandler,
  mockLSHandler,
  mockYdocProvider,
  updateVisualizationData,
} from './lsHandler'
import { HISTORY_ROUTES } from './versioning/historyRoutes'
import { SAVE_ROUTES } from './versioning/saveRoutes'

function array<T>(): Readonly<T>[] {
  return []
}

/** The content type `filesystem-read-path` answers with for the file at `path`. */
function mimeTypeFor(path: string) {
  return path.endsWith('.png') ? 'image/png' : 'text/plain'
}

// The mocked filesystem is POSIX-style whatever the host is: join its paths with `posix.join`, not
// the host's `join`, which would write backslashes into them on Windows.
const ROOT_PARENT_PATH = Path('/home/user/enso')
const ROOT_PATH = Path('/home/user/enso/enso-projects')
const DOWNLOAD_PATH = Path('/home/user/enso/Downloads')
/** The sources `addProjectSources` copies into a mocked project. */
const MOCK_PROJECT_DIR = fileURLToPath(new URL('./project', import.meta.url))
/** The shim's cap on the Recent list (`RECENT_LIMIT` in `localMetadata`). */
const RECENT_LIMIT = 20

const languageServerJsonAddress = { host: '127.0.0.1', port: 1235 }
const languageServerYdocAddress = { host: '127.0.0.1', port: 1233 }

const INITIAL_CALLS_OBJECT = {
  getRootDirectory: array<object>(),
  getDownloadDirectory: array<object>(),
  downloadProject: array<{ projectId: backend.ProjectId }>(),
  getFileContent: array<{ path: string }>(),
  listProjectSessions: array<{ localProjectKey: string }>(),
  createProject: array<CreateProjectParams>(),
  openProject: array<OpenProjectParams>(),
  closeProject: array<CloseProjectParams>(),
  duplicateProject: array<{ projectId: string }>(),
  moveFile: array<{ from: string; to: string }>(),
  deletePath: array<{ path: string }>(),
}

const READONLY_INITIAL_CALLS_OBJECT: TrackedCallsInternal = INITIAL_CALLS_OBJECT

export { READONLY_INITIAL_CALLS_OBJECT as INITIAL_LOCAL_CALLS_OBJECT }

type TrackedCallsInternal = {
  [K in keyof typeof INITIAL_CALLS_OBJECT]: Readonly<(typeof INITIAL_CALLS_OBJECT)[K]>
}

export interface LocalTrackedCalls extends TrackedCallsInternal {}

type DirectoryEntryWithData = {
  type: 'DirectoryEntry'
  entry: DirectoryEntry
  children: FileSystemEntryWithData[]
}

type ProjectEntryWithData = {
  type: 'ProjectEntry'
  entry: ProjectEntry
  metadata: {
    projectName: ProjectName
    projectNormalizedName: string
  }
}

type FileEntryWithData = { type: 'FileEntry'; entry: FileEntry; content: string | Buffer }

type DatalinkEntryWithData = { type: 'DatalinkEntry'; entry: DatalinkEntry; content: string }

type FileSystemEntryWithData =
  DatalinkEntryWithData | DirectoryEntryWithData | ProjectEntryWithData | FileEntryWithData

/** The return type of {@link mockLocalApi}. */
export interface MockLocalApi extends Awaited<ReturnType<typeof mockLocalApi>> {}

/** Add route handlers for the mock API to a page. */
export async function mockLocalApi(page: Page) {
  // Drop any preprocessor overrides set by an earlier test in the same
  // worker. Widget configurations are intentionally *not* reset here because
  // some test describes rely on their own `beforeEach` hook to
  // `clearMockWidgetConfigurations()` before the fixture runs; resetting to
  // the initial set here would undo that.
  clearPreprocessorOverrides()

  const fileSystem = new Map<string, FileSystemEntryWithData>()
  const openProjects = new Map<UUID, ProjectState>()
  /** The Recent list, newest first, as the shim's `recent.json` keeps it. */
  let recentProjects: RecentProjectEntry[] = []
  /** The sessions every local project reports, as the engine's log files would list them. */
  const projectSessions: { projectSessionId: string; createdAt: string }[] = []

  const callsObjects = new Set<typeof INITIAL_CALLS_OBJECT>()

  function trackCalls() {
    const calls = structuredClone(INITIAL_CALLS_OBJECT)
    callsObjects.add(calls)
    return calls
  }

  function pushToKey<Object extends Record<keyof Object, unknown[]>, Key extends keyof Object>(
    object: Object,
    key: Key,
    item: Object[Key][number],
  ) {
    object[key].push(item)
  }

  function called<Key extends keyof typeof INITIAL_CALLS_OBJECT>(
    key: Key,
    args: (typeof INITIAL_CALLS_OBJECT)[Key][number],
  ) {
    for (const callsObject of callsObjects) {
      pushToKey(callsObject, key, args)
    }
  }

  const createAttributes = (attributes: Partial<Attributes> | undefined = {}): Attributes => ({
    creationTime: toRfc3339(new Date()),
    lastAccessTime: toRfc3339(new Date()),
    lastModifiedTime: toRfc3339(new Date()),
    byteSize: 0,
    ...attributes,
  })

  type DirectoryEntryOptions = {
    path: Path
    attributes?: Partial<Attributes>
  }

  const createDirectoryEntry = ({ path, attributes }: DirectoryEntryOptions): DirectoryEntry => ({
    type: 'DirectoryEntry',
    path,
    attributes: createAttributes(attributes),
  })

  const createDirectory = (options: DirectoryEntryOptions): DirectoryEntryWithData => {
    const entry = createDirectoryEntry(options)
    return { type: 'DirectoryEntry', entry, children: [] }
  }

  const addEntry = <E extends FileSystemEntryWithData>(path: Path, entry: E) => {
    fileSystem.set(path, entry)
    const { directoryPath } = getDirectoryAndName(path)
    const parentEntry = fileSystem.get(directoryPath)
    if (parentEntry?.type === 'DirectoryEntry') {
      parentEntry.children.push(entry)
    }
    return entry
  }

  const removeEntry = (path: Path) => {
    const entry = fileSystem.get(path)
    if (!entry) {
      return
    }
    fileSystem.delete(path)
    const { directoryPath } = getDirectoryAndName(path)
    const parentEntry = fileSystem.get(directoryPath)
    if (parentEntry?.type !== 'DirectoryEntry') {
      return
    }
    const index = parentEntry.children.findIndex((child) => child.entry.path === path)
    if (index !== -1) {
      parentEntry.children.splice(index, 1)
    }
    return entry
  }

  const moveEntry = (source: Path, destination: Path) => {
    if (!fileSystem.has(source) || fileSystem.has(destination)) {
      return
    }
    const entry = removeEntry(source)
    if (!entry) {
      return
    }
    unsafeMutable(entry.entry).path = destination
    addEntry(destination, entry)
    return entry
  }

  const addDirectory = (options: DirectoryEntryOptions) => {
    addEntry(options.path, createDirectory(options))
  }

  type ProjectEntryOptions = {
    path?: Path
    metadata: ProjectMetadata
    attributes?: Partial<Attributes>
  }

  const createProject = (options: ProjectEntryOptions): ProjectEntryWithData => {
    const normalizedName = options.metadata.name
      .split(' ')
      .filter((n) => n.length)
      .map((part) => capitalizeFirst(part))
      .join('_')
    return {
      type: 'ProjectEntry',
      entry: {
        type: 'ProjectEntry',
        path: options.path ?? Path(`${ROOT_PATH}/${normalizedName}`),
        metadata: options.metadata,
        attributes: createAttributes(options.attributes),
      },
      metadata: {
        projectName: ProjectName(options.metadata.name),
        projectNormalizedName: normalizedName,
      },
    }
  }

  const addProject = (options: ProjectEntryOptions) => {
    const project = createProject(options)
    return addEntry(project.entry.path, project)
  }

  /** The mocked git versioning (`mock/localVersioning.ts`). */
  const versioning = createMockVersioning()
  const versioningContext: VersioningMockContext = {
    state: versioning,
    rootPath: ROOT_PATH,
    addProject: (options) => {
      addProject(options)
    },
  }

  type FileEntryOptions = {
    path: Path
    attributes?: Partial<Attributes>
    content?: string | Buffer
  }

  const createFileEntry = ({ path, attributes }: FileEntryOptions): FileEntry => ({
    type: 'FileEntry',
    path,
    attributes: createAttributes(attributes),
  })

  const createFile = (options: FileEntryOptions): FileEntryWithData => {
    const { content = '' } = options
    const entry = createFileEntry(options)
    return { type: 'FileEntry', entry, content }
  }

  /** `raw` replaces the serialised `value`, to make a datalink that is not valid JSON. */
  const addDatalink = ({ path, value, raw }: { path: Path; value: unknown; raw?: string }) => {
    const entry: DatalinkEntry = {
      type: 'DatalinkEntry',
      path,
      attributes: createAttributes(),
    }
    return addEntry(path, {
      type: 'DatalinkEntry',
      entry,
      content: raw ?? JSON.stringify(value, null, 2),
    })
  }

  /** The parsed content of the datalink at `path`; `undefined` when there is none. */
  const datalinkValue = (path: string): unknown => {
    const entry = fileSystem.get(path)
    return entry?.type === 'DatalinkEntry' ? JSON.parse(entry.content) : undefined
  }

  const addFile = (options: FileEntryOptions) => {
    addEntry(options.path, createFile(options))
  }

  /** Add a folder (under the root unless `parent` is given), by title. */
  const addRootDirectory = (
    title: string,
    options: { parent?: Path; attributes?: Partial<Attributes> } = {},
  ) => {
    const path = Path(posix.join(options.parent ?? ROOT_PATH, title))
    addDirectory({ path, ...(options.attributes ? { attributes: options.attributes } : {}) })
    return path
  }

  /** Add a file (under the root unless `parent` is given), by title. */
  const addRootFile = (
    title: string,
    options: { parent?: Path; content?: string; attributes?: Partial<Attributes> } = {},
  ) => {
    const path = Path(posix.join(options.parent ?? ROOT_PATH, title))
    addFile({
      path,
      content: options.content ?? '',
      ...(options.attributes ? { attributes: options.attributes } : {}),
    })
    return path
  }

  /** Add a project under the root, by title; returns its directory. */
  const addRootProject = (title: string, options: { attributes?: Partial<Attributes> } = {}) =>
    addProject({
      metadata: {
        id: UUID(uuidv4()),
        name: title,
        namespace: 'local',
        created: toRfc3339(new Date()),
      },
      ...(options.attributes ? { attributes: options.attributes } : {}),
    }).entry.path

  /** Give `projectPath` the sources in `mock/project/` (docs with "Project Goal", and an image). */
  const addProjectSources = (projectPath: Path) => {
    for (const relative of ['src/Main.enso', 'src/ea.png']) {
      addFile({
        path: Path(posix.join(projectPath, relative)),
        content: readFileSync(posix.join(MOCK_PROJECT_DIR, relative)),
      })
    }
  }

  addDirectory({ path: ROOT_PARENT_PATH })
  addDirectory({ path: ROOT_PATH })
  addDirectory({ path: DOWNLOAD_PATH })

  // === Labels (the shim's `localMetadata`) ===

  const labels: backend.Label[] = []
  /** Deleted label names, which projects still carrying them no longer list. */
  const deletedLabelNames = new Set<string>()

  const addLabel = (value: string, color: backend.LChColor) => {
    const label: backend.Label = {
      id: backend.TagId(uuidv4()),
      value: backend.LabelName(value),
      color,
    }
    labels.push(label)
    deletedLabelNames.delete(value)
    return label
  }

  /** A listing entry as the shim lists it: a project's labels without the deleted ones. */
  const withLiveLabels = (entry: FileSystemEntry): FileSystemEntry =>
    entry.type !== 'ProjectEntry' ?
      entry
    : {
        ...entry,
        metadata: {
          ...entry.metadata,
          labels: (entry.metadata.labels ?? []).filter((name) => !deletedLabelNames.has(name)),
        },
      }

  await test.step('Mock Local API', async () => {
    await page.route('/api/project-service/project/create', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const params: CreateProjectParams = JSON.parse(request.postData() ?? '{}')
      called('createProject', params)
      const parentPath = params.projectsDirectory ?? ROOT_PATH
      const path = Path(`${parentPath}/${params.name}`)
      const id = UUID(uuidv4())
      const metadata: ProjectEntryWithData['metadata'] = {
        projectName: params.name,
        projectNormalizedName: params.name,
      }
      const result: CreateProject = { projectId: id, projectPath: path, ...metadata }
      addProject({
        path,
        metadata: {
          id,
          name: metadata.projectName,
          namespace: 'local',
          created: toRfc3339(new Date()),
        },
      })
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(result)),
      })
    })

    await page.route('/api/project-service/project/duplicate', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const params: { projectId: UUID; projectsDirectory?: Path } = JSON.parse(
        request.postData() ?? '{}',
      )
      called('duplicateProject', { projectId: params.projectId })
      const parentPath = params.projectsDirectory ?? ROOT_PATH
      const parentDirectory = fileSystem.get(parentPath)
      const original =
        parentDirectory?.type === 'DirectoryEntry' ?
          parentDirectory.children.find(
            (entry) =>
              entry.type === 'ProjectEntry' && entry.entry.metadata.id === params.projectId,
          )
        : undefined
      if (original?.type !== 'ProjectEntry') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(toJSONRPCError('Project not found')),
        })
      }
      // The shim's naming (`getNameForDuplicatedProject`).
      const name = ProjectName(`${original.entry.metadata.name} (copy)`)
      const path = Path(`${parentPath}/${name}`)
      const id = UUID(uuidv4())
      addProject({
        path,
        metadata: { id, name, namespace: 'local', created: toRfc3339(new Date()) },
      })
      const result: DuplicatedProject = {
        projectId: id,
        projectName: name,
        projectNormalizedName: name,
        projectPath: path,
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(result)),
      })
    })

    await page.route('/api/project-service/project/open', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const params: OpenProjectParams = JSON.parse(request.postData() ?? '{}')
      called('openProject', params)
      const parentDirectory = fileSystem.get(params.projectsDirectory ?? ROOT_PATH)
      const project =
        parentDirectory?.type === 'DirectoryEntry' ?
          parentDirectory.children.find(
            (entry) =>
              entry.type === 'ProjectEntry' && entry.entry.metadata.id === params.projectId,
          )
        : null
      if (project?.type !== 'ProjectEntry') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(toJSONRPCError(`No project with UUID '${params.projectId}'`)),
        })
      }
      unsafeMutable(project.entry.metadata).lastOpened = toRfc3339(new Date())
      const result: OpenProject = {
        projectId: UUID(crypto.randomUUID()),
        languageServerJsonAddress,
        languageServerYdocAddress,
        projectNamespace: 'local',
        projectName: project.metadata.projectName,
        projectNormalizedName: project.metadata.projectNormalizedName,
      }
      openProjects.set(params.projectId, {
        state: backend.ProjectState.opened,
        data: result,
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 1_000)
      })
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(result)),
      })
    })

    await page.route('/api/project-service/project/close', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const params: CloseProjectParams = JSON.parse(request.postData() ?? '{}')
      called('closeProject', params)
      openProjects.delete(params.projectId)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult({})),
      })
    })

    const projectServiceRoute = (
      name: string,
      handler: (params: Record<string, unknown>) => JSONRPCResponse<unknown>,
    ) =>
      page.route(`/api/project-service/${name}`, async (route, request) => {
        if (request.method() !== 'POST') {
          return route.fulfill({ status: 400 })
        }
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(handler(JSON.parse(request.postData() ?? '{}'))),
        })
      })

    await projectServiceRoute('labels/list', () => toJSONRPCResult(labels))
    await projectServiceRoute('labels/create', (params) => {
      const value = String(params.value)
      if (labels.some((label) => label.value === value)) {
        return toJSONRPCError(`A label named '${value}' already exists.`)
      }
      return toJSONRPCResult(addLabel(value, params.color as backend.LChColor))
    })
    await projectServiceRoute('labels/delete', (params) => {
      const index = labels.findIndex((label) => label.id === params.id)
      const [label] = index === -1 ? [] : labels.splice(index, 1)
      if (label != null) deletedLabelNames.add(label.value)
      return toJSONRPCResult(null)
    })
    await projectServiceRoute('project/set-labels', (params) => {
      const project = fileSystem.get(String(params.path))
      if (project?.type !== 'ProjectEntry') {
        return toJSONRPCError(`No project at '${String(params.path)}'`)
      }
      const names = (params.labels as string[]).filter((name) => !deletedLabelNames.has(name))
      unsafeMutable(project.entry.metadata).labels = names.map(backend.LabelName)
      return toJSONRPCResult(null)
    })

    const datalinkName = (path: string) => posix.basename(path)
    /** The shim's `isAcceptableDatalinkPath` for the mock's POSIX paths. */
    const acceptableDatalinkPath = (path: string) =>
      posix.isAbsolute(path) &&
      posix.basename(path).length > '.datalink'.length &&
      path.endsWith('.datalink') &&
      !path
        .split('/')
        .slice(1)
        .some((segment) => ['', '.', '..'].includes(segment))
    const requireDatalinkPath = (route: string, path: string) =>
      acceptableDatalinkPath(path) ? null : (
        toJSONRPCError(
          `${route} failed: '${path}' is not an absolute path to a '.datalink' file without '.' or '..' segments.`,
        )
      )
    const isObject = (value: unknown) =>
      typeof value === 'object' && value != null && !Array.isArray(value)
    await projectServiceRoute('datalink/read', ({ path }) => {
      const invalid = requireDatalinkPath('datalink/read', String(path))
      if (invalid) return invalid
      const entry = fileSystem.get(String(path))
      if (entry?.type !== 'DatalinkEntry') {
        return toJSONRPCError(`datalink/read failed: Datalink not found: '${String(path)}'.`)
      }
      try {
        return toJSONRPCResult(JSON.parse(entry.content))
      } catch (error) {
        return toJSONRPCError(
          `datalink/read failed: '${datalinkName(String(path))}' is not valid JSON: ${String(error)}`,
        )
      }
    })
    await projectServiceRoute('datalink/create', ({ path, value }) => {
      const invalid = requireDatalinkPath('datalink/create', String(path))
      if (invalid) return invalid
      if (!isObject(value)) {
        return toJSONRPCError('datalink/create failed: A datalink must be a JSON object.')
      }
      const folder = posix.dirname(String(path))
      if (fileSystem.get(folder)?.type !== 'DirectoryEntry') {
        return toJSONRPCError(`datalink/create failed: The folder '${folder}' does not exist.`)
      }
      if (fileSystem.has(String(path))) {
        return toJSONRPCError(
          `datalink/create failed: '${datalinkName(String(path))}' already exists.`,
        )
      }
      addDatalink({ path: Path(String(path)), value })
      return toJSONRPCResult(null)
    })
    await projectServiceRoute('datalink/update', ({ path, value }) => {
      const invalid = requireDatalinkPath('datalink/update', String(path))
      if (invalid) return invalid
      if (!isObject(value)) {
        return toJSONRPCError('datalink/update failed: A datalink must be a JSON object.')
      }
      const entry = fileSystem.get(String(path))
      if (entry?.type !== 'DatalinkEntry') {
        return toJSONRPCError(
          `datalink/update failed: '${datalinkName(String(path))}' does not exist.`,
        )
      }
      entry.content = JSON.stringify(value, null, 2)
      return toJSONRPCResult(null)
    })
    await projectServiceRoute('datalink/delete', ({ path }) => {
      const invalid = requireDatalinkPath('datalink/delete', String(path))
      if (invalid) return invalid
      if (fileSystem.get(String(path))?.type !== 'DatalinkEntry') {
        return toJSONRPCError(
          `datalink/delete failed: '${datalinkName(String(path))}' is not a file.`,
        )
      }
      removeEntry(Path(String(path)))
      return toJSONRPCResult(null)
    })

    const ydocAddressBase = `ws://${languageServerYdocAddress.host}:${languageServerYdocAddress.port}`

    class MockWs implements YjsSocket {
      binaryType = 'arraybuffer' as const
      readyState = WebSocket.OPEN
      constructor(private wsRoute: WebSocketRoute) {}
      on(event: 'close', listener: (code: number, reason: Buffer) => void): this
      on(event: 'message', listener: (data: ArrayBuffer | Buffer, isBinary: boolean) => void): this
      on(event: 'ping' | 'pong', listener: (data: Buffer) => void): this
      on(event: unknown, listener: unknown): this {
        switch (event) {
          case 'close':
            this.wsRoute.onClose((code, reason) => {
              const _listener = listener as (code: number, reason: Buffer) => void
              _listener(code ?? 0, Buffer.from(reason ?? []))
            })
            return this
          case 'message':
            this.wsRoute.onMessage((data) => {
              const _listener = listener as (data: ArrayBuffer | Buffer, isBinary: boolean) => void
              _listener(Buffer.from(data), true)
            })
            return this
          case 'ping':
          case 'pong':
            return this
        }
        throw new Error(`Event ${event} not implemented.`)
      }
      send(data: Uint8Array, cb?: (err?: Error) => void): void {
        this.wsRoute.send(Buffer.from(data))
        if (cb) queueMicrotask(() => cb())
      }
      ping(): void {}
      close(): void {
        // Fire-and-forget, like a real socket's `close()`, whose synchronous signature this mirrors.
        void this.wsRoute.close()
      }
    }

    /** Set up the mock JSON-RPC channel handler with its associated data channel */
    function setupMockLsChannel(
      channel: YjsChannel<string>,
      associatedDataChannel: YjsChannel<Uint8Array> | null,
    ) {
      channel.subscribe(async (messageRaw) => {
        const { method, params, jsonrpc, id } = JSON.parse(messageRaw)
        try {
          const result =
            (await mockLSHandler(
              method,
              params,
              (message) => channel.send(JSON.stringify({ jsonrpc, ...message })),
              (binaryData?: ArrayBuffer) => {
                // Use the associated data channel for this connection
                if (binaryData && associatedDataChannel) {
                  associatedDataChannel.send(new Uint8Array(binaryData))
                }
              },
            )) ?? null
          channel.send(JSON.stringify({ jsonrpc, id, result }))
        } catch (error) {
          channel.send(JSON.stringify({ jsonrpc, id, error }))
        }
      })
    }

    /** Set up the mock binary data channel handler */
    function setupMockDataChannel(channel: YjsChannel<Uint8Array>) {
      channel.subscribe(async (messageRaw) => {
        // Important: Use slice to get a copy of just the relevant portion
        // because messageRaw.buffer may include data beyond the Uint8Array's view
        const data = messageRaw.buffer.slice(
          messageRaw.byteOffset,
          messageRaw.byteOffset + messageRaw.byteLength,
        ) as ArrayBuffer
        const response = await mockDataHandler(data)
        if (response) {
          channel.send(new Uint8Array(response))
        }
      })
    }

    await page.routeWebSocket(`${ydocAddressBase}/**`, (wsRoute) => {
      const parsedUrl = new URL(wsRoute.url())
      const room = parsedUrl.pathname.substring('/project/'.length)
      const lsChannelName = parsedUrl.searchParams.get('ls')
      const dataChannelName = parsedUrl.searchParams.get('data')

      const mockWs = new MockWs(wsRoute)
      const wsDoc = new WSSharedDoc()
      const _connection = new YjsConnection(mockWs, wsDoc)
      mockYdocProvider(room, wsDoc.doc)

      let binaryChannel: YjsChannel<Uint8Array> | null = null
      if (dataChannelName) {
        binaryChannel = new YjsChannel<Uint8Array>(wsDoc.doc, dataChannelName)
        // Only set up the data handler for the main 'index' room connection.
        // Subdoc connections reuse the same ydoc transport but do not drive
        // the DataServer protocol handled here.
        if (room === 'index') {
          setupMockDataChannel(binaryChannel)
        }
      }
      if (lsChannelName) {
        const lsChannel = new YjsChannel<string>(wsDoc.doc, lsChannelName)
        setupMockLsChannel(lsChannel, binaryChannel)
      }
    })

    // The local Recent list, as the shim's `localMetadata` keeps it.
    const recentProjectAt = (path: string) => {
      const entry = fileSystem.get(path)
      return entry?.type === 'ProjectEntry' ? entry : null
    }
    const isLiveRecentEntry = (entry: RecentProjectEntry) =>
      recentProjectAt(entry.path)?.entry.metadata.id === entry.projectId

    await page.route('/api/project-service/recent/list', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(recentProjects.filter(isLiveRecentEntry))),
      })
    })

    await page.route('/api/project-service/recent/record', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const { path }: { path: Path } = JSON.parse(request.postData() ?? '{}')
      const project = recentProjectAt(path)
      if (project == null) {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(toJSONRPCError(`No project at '${path}'`)),
        })
      }
      const projectId = project.entry.metadata.id
      recentProjects = [
        { path, projectId, openedAt: toRfc3339(new Date()) },
        ...recentProjects.filter(
          (entry) => entry.projectId !== projectId && isLiveRecentEntry(entry),
        ),
      ].slice(0, RECENT_LIMIT)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(null)),
      })
    })

    await page.route('/api/project-service/recent/forget', async (route, request) => {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const { path }: { path: Path } = JSON.parse(request.postData() ?? '{}')
      recentProjects = recentProjects.filter((entry) => entry.path !== path)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(toJSONRPCResult(null)),
      })
    })

    await registerVersioningRoutes(page, versioningContext, { ...SAVE_ROUTES, ...HISTORY_ROUTES })

    await page.route('/api/root-directory-path', async (route, request) => {
      called('getRootDirectory', {})
      if (request.method() !== 'GET') {
        return route.fulfill({ status: 400 })
      }
      return route.fulfill({
        contentType: 'text/plain',
        body: ROOT_PATH,
      })
    })

    await page.route('/api/download-directory-path', async (route, request) => {
      called('getDownloadDirectory', {})
      if (request.method() !== 'GET') {
        return route.fulfill({ status: 400 })
      }
      return route.fulfill({
        contentType: 'text/plain',
        body: DOWNLOAD_PATH,
      })
    })

    await page.route('/api/upload-file?*', async (route, request) => {
      const params = new URL(request.url()).searchParams
      const fileName = params.get('file_name')
      const directoryPathRaw = params.get('directory') as backend.DirectoryId | null
      const directoryPath =
        directoryPathRaw != null ? backend.extractTypeAndPath(directoryPathRaw).path : ROOT_PATH
      const filePath = Path(`${directoryPath}/${fileName}`)
      if (filePath == null) {
        return route.fulfill({ status: 400 })
      }
      // Remove any existing file, if one exists.
      removeEntry(filePath)
      addFile({ path: filePath, content: request.postData() ?? '' })
      return route.fulfill({ body: filePath, contentType: 'text/plain' })
    })

    await page.route('/api/projects/**', async (route, request) => {
      const url = new URL(request.url())
      const { projectId: projectIdRaw } =
        url.pathname.match(/^\/api\/projects\/(?<projectId>[^/]+)\/download$/)?.groups ?? {}
      if (request.method() !== 'GET' || projectIdRaw == null) {
        return route.fulfill({ status: 400 })
      }
      const projectId = backend.ProjectId(projectIdRaw)
      called('downloadProject', { projectId })
      const response = `mock project body projectId='${projectId}'`
      return route.fulfill({
        contentType: 'text/plain',
        body: JSON.stringify(response),
      })
    })

    await page.route('/api/run-project-manager-command?*', async (route, request) => {
      const succeed = (result: unknown, contentType = 'application/json') => {
        return route.fulfill({ contentType, body: JSON.stringify(toJSONRPCResult(result)) })
      }
      const fail = (errorMessage: string) => {
        return route.fulfill({ body: JSON.stringify(toJSONRPCError(errorMessage)) })
      }
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 400 })
      }
      const cliArgumentsRaw = JSON.parse(
        new URL(request.url()).searchParams.get('cli-arguments') ?? '[]',
      )
      const cliArgumentsObject =
        cliArgumentsRaw[0] != null ?
          { name: cliArgumentsRaw[0].slice(2), arguments: cliArgumentsRaw.slice(1) }
        : null
      if (!cliArgumentsObject) {
        return fail('Missing arguments object')
      }
      const cliArguments: readonly string[] = cliArgumentsObject.arguments
      switch (cliArgumentsObject.name) {
        case 'filesystem-exists': {
          const path = cliArguments[0]
          if (path == null) {
            return fail('No path provided')
          }
          return succeed({ exists: fileSystem.has(path) })
        }
        case 'filesystem-list':
        case 'filesystem-list-recursive': {
          const recursive = cliArgumentsObject.name === 'filesystem-list-recursive'
          const folderPath = cliArguments[0]?.replace(/[/]$/, '')
          const folder = folderPath != null ? fileSystem.get(folderPath) : null
          if (folderPath == null || folder?.type !== 'DirectoryEntry') {
            return fail(`Could not find folder at '${folderPath}'`)
          }
          const folderPathQueue = [folderPath]
          const entries: FileSystemEntry[] = []
          while (true) {
            const currentFolderPath = folderPathQueue.shift()
            if (currentFolderPath == null) break
            for (const { entry } of folder.children) {
              if (recursive && entry.type === 'DirectoryEntry') {
                folderPathQueue.push(entry.path)
              }
              entries.push(withLiveLabels(entry))
            }
          }
          return succeed({ entries })
        }
        case 'filesystem-read-path': {
          const filePath = cliArguments[0]
          if (filePath == null) {
            return fail('No path provided')
          }
          called('getFileContent', { path: filePath })
          const file = fileSystem.get(filePath)
          if (!file) {
            return fail(`Could not find file at '${filePath}'`)
          }
          if (file.type !== 'FileEntry') {
            return fail(`Filesystem entry at '${filePath}' is '${file?.type}', not file`)
          }
          // Raw, not a JSON-RPC result: the shim streams the file (`--filesystem-read-path`), and
          // `Backend.getMainFileContent` reads the body as text.
          return route.fulfill({ contentType: mimeTypeFor(file.entry.path), body: file.content })
        }
        case 'filesystem-create-directory': {
          const folderPath = cliArguments[0]
          if (folderPath == null) {
            return fail('No path provided')
          }
          const folder = fileSystem.get(folderPath)
          if (folder) {
            return fail(`Item already exists at '${folderPath}'`)
          }
          addDirectory({ path: Path(folderPath) })
          return succeed({})
        }
        case 'filesystem-write-path': {
          const filePath = cliArguments[0]
          if (filePath == null) {
            return fail('No path provided')
          }
          // Remove any existing file, if one exists.
          removeEntry(Path(filePath))
          addFile({ path: Path(filePath), content: request.postData() ?? '' })
          return succeed({})
        }
        case 'filesystem-move-from': {
          if (cliArguments[1] !== '--filesystem-move-to') {
            return fail('`--filesystem-move-to` not found')
          }
          const sourcePath = cliArguments[0]
          const destinationPath = cliArguments[2]
          if (sourcePath == null) {
            return fail('No source path provided')
          }
          if (destinationPath == null) {
            return fail('No destination path provided')
          }
          called('moveFile', { from: sourcePath, to: destinationPath })
          moveEntry(Path(sourcePath), Path(destinationPath))
          recentPathMoved(sourcePath, destinationPath)
          return succeed({})
        }
        case 'list-project-sessions': {
          const localProjectKey = cliArguments[0]
          if (localProjectKey == null) {
            return fail('No project key provided')
          }
          called('listProjectSessions', { localProjectKey })
          return succeed({ sessions: projectSessions })
        }
        case 'filesystem-delete': {
          const path = cliArguments[0]
          if (path == null) {
            return fail('No path provided')
          }
          const entry = fileSystem.get(path)
          if (!entry) {
            return fail(`Item does not exist at '${path}'`)
          }
          called('deletePath', { path })
          removeEntry(Path(path))
          recentPathDeleted(path)
          return succeed({})
        }
      }
    })
  })

  /** Whether `path` is `ancestor` or inside it. */
  function isAtOrUnder(path: string, ancestor: string) {
    return path === ancestor || path.startsWith(`${ancestor}/`)
  }

  /** Rewrite the Recent entries at or under a moved path, as the shim does. */
  function recentPathMoved(from: string, to: string) {
    recentProjects = recentProjects.map((entry) =>
      isAtOrUnder(entry.path, from) ?
        { ...entry, path: Path(`${to}${entry.path.slice(from.length)}`) }
      : entry,
    )
  }

  /** Forget the Recent entries at or under a deleted path, as the shim does. */
  function recentPathDeleted(deletedPath: string) {
    recentProjects = recentProjects.filter((entry) => !isAtOrUnder(entry.path, deletedPath))
  }

  /** Put the project at `path` at the top of the Recent list, as opening it would. */
  function addRecentProject(path: Path) {
    const project = fileSystem.get(path)
    if (project?.type !== 'ProjectEntry') throw new Error(`No project at '${path}'`)
    const projectId = project.entry.metadata.id
    recentProjects = [
      { path, projectId, openedAt: toRfc3339(new Date()) },
      ...recentProjects.filter((entry) => entry.projectId !== projectId),
    ]
  }

  /** Add a session that every local project will report. */
  function addProjectSession(createdAt: string) {
    projectSessions.push({ projectSessionId: `local-session-${projectSessions.length}`, createdAt })
  }

  async function updateVisualization(preprocessor: string, data: unknown) {
    updateVisualizationData(preprocessor, data)
  }

  const api = {
    rootPath: ROOT_PATH,
    trackCalls,
    addDirectory,
    addProject,
    addFile,
    addRootDirectory,
    addRootFile,
    addRootProject,
    addProjectSources,
    addDatalink,
    datalinkValue,
    removeEntry,
    addProjectSession,
    updateVisualization,
    addLabel,
    addRecentProject,
    /** The mocked git versioning: change it in `setupApi.local`, before the page loads. */
    versioning,
    /** The paths in the Recent list, newest first, whether or not a project is still there. */
    recentProjectPaths: () => recentProjects.map((entry) => entry.path),
  } as const

  return api
}
