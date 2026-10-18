/**
 * @file This module defines the Project Manager endpoint.
 * @see
 * https://github.com/enso-org/enso/blob/develop/docs/language-server/protocol-project-manager.md
 */
import * as dateTime from '../../utilities/data/dateTime.js'
import { omit } from '../../utilities/data/object.js'
import { getDirectoryAndName, getFolderPath, normalizeSlashes } from '../../utilities/file.js'
import { normalizeName } from '../../utilities/nameValidation.js'
import * as backend from '../Backend.js'
import { makeProjectCacheKey, makeProjectTelemetryKey } from './projectIdentity.js'
import {
  MissingComponentAction,
  Path,
  type CloseProjectParams,
  type CreateLabelParams,
  type CreateProject,
  type CreateProjectParams,
  type DeleteLabelParams,
  type DeleteProjectParams,
  type DuplicatedProject,
  type DuplicateProjectParams,
  type FileSystemEntry,
  type JSONRPCResponse,
  type OpenProject,
  type OpenProjectParams,
  type ProjectState,
  type RecentProjectEntry,
  type RenameProjectParams,
  type SetProjectLabelsParams,
  type UUID,
  type VersionEntry,
  type VersioningStatus,
} from './types.js'

/** A project with its path provided instead of its id. */
type WithProjectPath<T> = Omit<T, 'projectId' | 'projectsDirectory'> & {
  readonly projectPath: Path
}

/**
 * A {@link WebSocket} endpoint to the project manager.
 */
export class ProjectManager {
  // This is required so that projects get recursively updated (deleted, renamed or moved).
  private readonly directories = new Map<Path, readonly FileSystemEntry[]>()
  private readonly projects = new Map<string, ProjectState>()
  private readonly projectIds = new Map<Path, UUID>()

  /** Create a {@link ProjectManager} */
  constructor(public readonly rootDirectory: Path) {}

  /** Get the state of a project given its path. */
  async getProjectId(projectPath: Path) {
    if (!this.projectIds.has(projectPath)) {
      await this.listDirectory(Path(getFolderPath(projectPath)))
    }
    return this.projectIds.get(projectPath)
  }

  /** Get the state of a project given its path. */
  async getProject(projectPath: Path) {
    const cacheKey = await this.getProjectCacheKey(projectPath)
    if (cacheKey != null) {
      return this.projects.get(cacheKey)
    }
    if (!this.projectIds.has(projectPath)) {
      throw new Error(`Unknown project id for project '${projectPath}'.`)
    }
    return this.projects.get(await this.requireProjectCacheKey(projectPath))
  }

  /** Open an existing project. */
  async openProject(params: WithProjectPath<OpenProjectParams>): Promise<OpenProject> {
    const fullParams: OpenProjectParams = await this.paramsWithPathToWithId(params)
    const cacheKey = makeProjectCacheKey(fullParams)
    const cached = this.projects.get(cacheKey)
    if (cached) {
      return cached.data
    } else {
      const promise: Promise<OpenProject> = this.runProjectServiceCommand(
        'project/open',
        fullParams,
      )
      this.projects.set(cacheKey, {
        state: backend.ProjectState.openInProgress,
        data: promise,
      })
      try {
        const result = await promise
        this.projects.set(cacheKey, {
          state: backend.ProjectState.opened,
          data: result,
        })
        return result
      } catch (error) {
        this.projects.delete(cacheKey)
        throw error
      }
    }
  }

  /** Close an open project. */
  async closeProject(
    params: WithProjectPath<CloseProjectParams>,
  ): Promise<{ readonly versioningWarning?: string }> {
    const fullParams: CloseProjectParams = await this.paramsWithPathToWithId(params)
    const cacheKey = makeProjectCacheKey(fullParams)
    const state = this.projects.get(cacheKey)
    if (state?.state === backend.ProjectState.openInProgress) {
      // Projects that are not opened cannot be closed.
      // This is the only way to wait until the project is open.
      await this.openProject({
        projectPath: params.projectPath,
        missingComponentAction: MissingComponentAction.install,
      })
    }
    this.projects.delete(cacheKey)
    // An older shim (or a mock) may answer `null`; that means no warning.
    const result = await this.runProjectServiceCommand<{
      readonly versioningWarning?: string
    } | null>('project/close', fullParams)
    return result ?? {}
  }

  /** Create a new project. */
  async createProject(params: CreateProjectParams): Promise<CreateProject> {
    const result: Omit<CreateProject, 'projectPath'> = await this.runProjectServiceCommand(
      'project/create',
      { ...params },
    )
    const directoryPath = params.projectsDirectory ?? this.rootDirectory
    // Update `internalDirectories` by listing the project's parent directory, because the
    // directory name of the project is unknown. Deleting the directory is not an option because
    // that will prevent ALL descendants of the parent directory from being updated.
    const siblings = await this.listDirectory(directoryPath)
    const projectEntry = siblings.find(
      (entry) => entry.type === 'ProjectEntry' && entry.metadata.id === result.projectId,
    )
    if (projectEntry == null) {
      throw new Error('Project failed to be created')
    }
    return { ...result, projectPath: projectEntry.path }
  }

  /** Return the content of a file of the project. */
  async getFileContent(projectPath: Path, pathInProject: string) {
    return await this.runStandaloneCommand(
      null,
      'filesystem-read-path',
      projectPath + '/' + pathInProject,
    )
  }

  /** Rename a project. */
  async renameProject(params: WithProjectPath<RenameProjectParams>): Promise<void> {
    const fullParams: RenameProjectParams = await this.paramsWithPathToWithId(params)
    const cacheKey = makeProjectCacheKey(fullParams)
    await this.runProjectServiceCommand('project/rename', fullParams)
    const state = this.projects.get(cacheKey)
    if (state?.state === backend.ProjectState.opened) {
      this.projects.set(cacheKey, {
        state: state.state,
        data: {
          ...state.data,
          projectName: params.name,
          projectNormalizedName: normalizeName(params.name),
        },
      })
    }
    // Update `internalDirectories` by listing the project's parent directory, because the new
    // directory name of the project is unknown. Deleting the directory is not an option because
    // that will prevent ALL descendants of the parent directory from being updated.
    await this.listDirectory(fullParams.projectsDirectory)
  }

  /** Duplicate a project. */
  async duplicateProject(
    params: WithProjectPath<DuplicateProjectParams>,
  ): Promise<DuplicatedProject> {
    const fullParams: DuplicateProjectParams = await this.paramsWithPathToWithId(params)
    const result: Omit<DuplicatedProject, 'projectPath'> = await this.runProjectServiceCommand(
      'project/duplicate',
      fullParams,
    )
    // Update `internalDirectories` by listing the project's parent directory, because the
    // directory name of the project is unknown. Deleting the directory is not an option because
    // that will prevent ALL descendants of the parent directory from being updated.
    const siblings = await this.listDirectory(fullParams.projectsDirectory)
    const projectEntry = siblings.find(
      (entry) => entry.type === 'ProjectEntry' && entry.metadata.id === result.projectId,
    )
    if (projectEntry == null) {
      throw new Error('Project failed to be created')
    }
    return { ...result, projectPath: projectEntry.path }
  }

  /** Delete a project. */
  async deleteProject(params: WithProjectPath<DeleteProjectParams>): Promise<void> {
    const fullParams: DeleteProjectParams = await this.paramsWithPathToWithId(params)
    const cacheKey = makeProjectCacheKey(fullParams)
    const cached = this.projects.get(cacheKey)
    if (cached && backend.IS_OPENING_OR_OPENED[cached.state]) {
      await this.closeProject({ projectPath: params.projectPath })
    }
    await this.runProjectServiceCommand('project/delete', fullParams)
    this.projectIds.delete(params.projectPath)
    this.projects.delete(cacheKey)
    const siblings = this.directories.get(fullParams.projectsDirectory)
    if (siblings != null) {
      this.directories.set(
        fullParams.projectsDirectory,
        siblings.filter((entry) => entry.path !== params.projectPath),
      )
    }
  }

  /** Checks if a file or directory exists. */
  async exists(parentId: Path | null) {
    /** The type of the response body of this endpoint. */
    interface ResponseBody {
      readonly exists: boolean
    }
    const response = await this.runStandaloneCommandJson<ResponseBody>(
      null,
      'filesystem-exists',
      parentId ?? this.rootDirectory,
    )
    return response.exists
  }

  /** List directories, projects and files in the given folder. */
  async listDirectory(
    parentPath: Path | null,
    recursive = false,
  ): Promise<readonly FileSystemEntry[]> {
    /** The type of the response body of this endpoint. */
    interface ResponseBody {
      readonly entries: FileSystemEntry[]
    }
    parentPath ??= this.rootDirectory
    const response = await this.runStandaloneCommandJson<ResponseBody>(
      null,
      recursive ? 'filesystem-list-recursive' : 'filesystem-list',
      parentPath,
    )
    const result = response.entries.map((entry) => ({
      ...entry,
      path: normalizeSlashes(entry.path),
    }))

    for (const entry of result) {
      if (entry.type === 'ProjectEntry') {
        this.projectIds.set(entry.path, entry.metadata.id)
      }
    }
    return result
  }

  /** Create a directory. */
  async createDirectory(path: Path) {
    await this.runStandaloneCommandJson(null, 'filesystem-create-directory', path)
    this.directories.set(path, [])
    const directoryPath = getDirectoryAndName(path).directoryPath
    const siblings = this.directories.get(directoryPath)
    if (siblings) {
      const now = dateTime.toRfc3339(new Date())
      this.directories.set(directoryPath, [
        ...siblings.filter((sibling) => sibling.type === 'DirectoryEntry'),
        {
          type: 'DirectoryEntry',
          attributes: {
            byteSize: 0,
            creationTime: now,
            lastAccessTime: now,
            lastModifiedTime: now,
          },
          path,
        },
        ...siblings.filter((sibling) => sibling.type !== 'DirectoryEntry'),
      ])
    }
  }

  /** Create a file. */
  async createFile(path: Path, file: Blob) {
    await this.runStandaloneCommandJson(file, 'filesystem-write-path', path)
    const directoryPath = getDirectoryAndName(path).directoryPath
    const siblings = this.directories.get(directoryPath)
    if (siblings) {
      const now = dateTime.toRfc3339(new Date())
      this.directories.set(directoryPath, [
        ...siblings.filter((sibling) => sibling.type !== 'FileEntry'),
        {
          type: 'FileEntry',
          attributes: {
            byteSize: file.size,
            creationTime: now,
            lastAccessTime: now,
            lastModifiedTime: now,
          },
          path,
        },
        ...siblings.filter((sibling) => sibling.type === 'FileEntry'),
      ])
    }
  }

  /** Move a file or directory. */
  async moveFile(from: Path, to: Path) {
    await this.runStandaloneCommand(null, 'filesystem-move-from', from, '--filesystem-move-to', to)
  }

  /** Delete a file or directory. */
  async deleteFile(path: Path) {
    await this.runStandaloneCommandJson(null, 'filesystem-delete', path)
    const children = this.directories.get(path)
    // Assume a directory needs to be loaded for its children to be loaded.
    if (children) {
      const removeChildren = (directoryChildren: readonly FileSystemEntry[]) => {
        for (const child of directoryChildren) {
          switch (child.type) {
            case 'DirectoryEntry': {
              const childChildren = this.directories.get(child.path)
              if (childChildren) {
                removeChildren(childChildren)
              }
              break
            }
            case 'ProjectEntry': {
              this.projects.delete(
                makeProjectCacheKey({
                  projectId: child.metadata.id,
                  projectsDirectory: getDirectoryAndName(child.path).directoryPath,
                }),
              )
              this.projectIds.delete(child.path)
              break
            }
            case 'DatalinkEntry':
            case 'FileEntry': {
              // No special extra metadata is stored for files.
              break
            }
          }
        }
      }
      removeChildren(children)
      this.directories.delete(path)
    }
    const directoryPath = getDirectoryAndName(path).directoryPath
    const siblings = this.directories.get(directoryPath)
    if (siblings) {
      this.directories.set(
        directoryPath,
        siblings.filter((entry) => entry.path !== path),
      )
    }
  }

  /**
   * Convert {@link WithProjectPath<T>} to `T`.
   * @throws {Error} when the `id` is not cached.
   */
  private async paramsWithPathToWithId<T>(obj: WithProjectPath<T>) {
    const path = obj.projectPath
    const directoryPath = getDirectoryAndName(path).directoryPath
    const id = await this.getProjectId(path)
    if (id == null) {
      throw new Error(`Project with path '${path}' does not exist`)
    }
    return {
      ...omit(obj, 'projectPath'),
      projectId: id,
      projectsDirectory: directoryPath,
    }
  }

  /** Return opaque cache key used for local logs and telemetry. */
  async getTelemetryKey(projectPath: Path) {
    const projectId = await this.getProjectId(projectPath)
    if (projectId == null) {
      return undefined
    }
    return makeProjectTelemetryKey(getDirectoryAndName(projectPath).directoryPath, projectId)
  }

  /** List project sessions by scanning engine log files for the given local project key. */
  async listProjectSessions(localProjectKey: string) {
    return this.runStandaloneCommandJson<{
      sessions: readonly { projectSessionId: string; createdAt: string }[]
    }>(null, 'list-project-sessions', localProjectKey)
  }

  /** Get log content for a local project session. */
  async getProjectSessionLogs(sessionId: string, scrollId: string | null) {
    const args = scrollId != null ? [sessionId, scrollId] : [sessionId]
    return this.runStandaloneCommandJson<{ scrollId: string; hits: readonly string[] }>(
      null,
      'get-project-session-logs',
      ...args,
    )
  }

  /** Download all log content for a local project session. */
  async downloadProjectSessionLogs(sessionId: string) {
    return this.runStandaloneCommandJson<string>(null, 'download-project-session-logs', sessionId)
  }

  /** List the local label definitions. */
  async listLabels(): Promise<readonly backend.Label[]> {
    return this.runProjectServiceCommand('labels/list', {})
  }

  /**
   * Create a local label.
   * @throws {Error} when a label with the same value already exists.
   */
  async createLabel(params: CreateLabelParams): Promise<backend.Label> {
    return this.runProjectServiceCommand('labels/create', params)
  }

  /** Delete a local label. Projects carrying its name stop listing it. */
  async deleteLabel(params: DeleteLabelParams): Promise<void> {
    await this.runProjectServiceCommand('labels/delete', params)
  }

  /** Replace the labels of a local project. */
  async setProjectLabels(params: SetProjectLabelsParams): Promise<void> {
    await this.runProjectServiceCommand('project/set-labels', {
      path: params.projectPath,
      labels: params.labels,
    })
  }

  /** The recently opened local projects that still exist, newest first. */
  async listRecentProjects(): Promise<readonly RecentProjectEntry[]> {
    const entries: readonly RecentProjectEntry[] = await this.runProjectServiceCommand(
      'recent/list',
      {},
    )
    return entries.map((entry) => ({ ...entry, path: normalizeSlashes(entry.path) }))
  }

  /** Record that the local project at `projectPath` was opened. */
  async recordRecentProject(projectPath: Path): Promise<void> {
    await this.runProjectServiceCommand('recent/record', { path: projectPath })
  }

  /** Remove the local project at `projectPath` from the recently opened projects. */
  async forgetRecentProject(projectPath: Path): Promise<void> {
    await this.runProjectServiceCommand('recent/forget', { path: projectPath })
  }

  /**
   * The JSON of the datalink file at `path`.
   * @throws {Error} when it is missing or is not valid JSON.
   */
  async readDatalink(path: Path): Promise<unknown> {
    return this.runProjectServiceCommand('datalink/read', { path })
  }

  /** Create the datalink file `path`; its folder must exist and the file must not. */
  async createDatalink(path: Path, value: unknown): Promise<void> {
    await this.runProjectServiceCommand('datalink/create', { path, value })
  }

  /** Replace the content of the existing datalink file `path`. */
  async updateDatalink(path: Path, value: unknown): Promise<void> {
    await this.runProjectServiceCommand('datalink/update', { path, value })
  }

  /** Delete the datalink file `path`. */
  async deleteDatalink(path: Path): Promise<void> {
    await this.runProjectServiceCommand('datalink/delete', { path })
  }

  /** Whether the project at `path` is versioned, has unsaved changes, and its last version. */
  async versioningStatus(path: Path): Promise<VersioningStatus> {
    const status: VersioningStatus = await this.runProjectServiceCommand('versioning/status', {
      path,
    })
    return { ...status, repoRoot: status.repoRoot && normalizeSlashes(status.repoRoot) }
  }

  /** Start versioning the projects under `rootPath` in a new repository, which is enabled. */
  async initVersioning(rootPath: Path): Promise<{ readonly repoRoot: Path }> {
    const result: { readonly repoRoot: Path } = await this.runProjectServiceCommand(
      'versioning/init',
      { rootPath },
    )
    return { repoRoot: normalizeSlashes(result.repoRoot) }
  }

  /**
   * Agree to have the existing repository at `repoRoot` versioned. Until then nothing is committed
   * to it, on close or otherwise.
   */
  async enableVersioning(repoRoot: Path): Promise<void> {
    await this.runProjectServiceCommand('versioning/enable', { repoRoot })
  }

  /** Stop versioning the repository at `repoRoot`. Its history is left as it is. */
  async disableVersioning(repoRoot: Path): Promise<void> {
    await this.runProjectServiceCommand('versioning/disable', { repoRoot })
  }

  /**
   * Enable the repository at `repoRoot` if it is at or inside `rootPath` (compared by real path in
   * the shim), unless the user opted out of it. Returns whether it is enabled afterwards.
   */
  async enableVersioningIfInside(
    repoRoot: Path,
    rootPath: Path,
  ): Promise<{ readonly enabled: boolean }> {
    return this.runProjectServiceCommand('versioning/enable-if-inside', { repoRoot, rootPath })
  }

  /** Save the project's current state as a version. `id` is `null` when nothing had changed. */
  async commitVersion(path: Path, message: string): Promise<{ readonly id: string | null }> {
    return this.runProjectServiceCommand('versioning/commit', { path, message })
  }

  /** The project's saved versions, newest first. */
  async listVersions(path: Path): Promise<{ readonly versions: readonly VersionEntry[] }> {
    return this.runProjectServiceCommand('versioning/log', { path })
  }

  /** The content of `relativePath` in the project as it was at version `id`. */
  async versionFileContent(path: Path, id: string, relativePath: string): Promise<string> {
    return this.runProjectServiceCommand('versioning/file-at', { path, id, relativePath })
  }

  /** Restore the project to version `id`. The project must not be running. */
  async restoreVersion(path: Path, id: string): Promise<{ readonly id: string }> {
    return this.runProjectServiceCommand('versioning/restore', { path, id })
  }

  /** Create a new project in `parentPath` from the project as it was at version `id`. */
  async duplicateVersion(
    path: Path,
    id: string,
    title: string,
    parentPath: Path,
  ): Promise<DuplicatedProject> {
    const result: DuplicatedProject = await this.runProjectServiceCommand(
      'versioning/duplicate-at',
      { path, id, title, parentPath },
    )
    return { ...result, projectPath: normalizeSlashes(result.projectPath) }
  }

  /** Change the comment of version `id`. */
  async setVersionComment(path: Path, id: string, comment: string): Promise<void> {
    await this.runProjectServiceCommand('versioning/set-comment', { path, id, comment })
  }

  /** Run the Project Manager binary with the given command-line arguments. */
  private async runStandaloneCommand(
    body: BodyInit | null,
    name: string,
    ...cliArguments: string[]
  ): Promise<Response> {
    const searchParams = new URLSearchParams({
      'cli-arguments': JSON.stringify([`--${name}`, ...cliArguments]),
    })
    return await fetch(`/api/run-project-manager-command?${searchParams}`, { method: 'POST', body })
  }

  /** Run the Project Manager binary with the given command-line arguments, expecting JSON data of given type T. */
  private async runStandaloneCommandJson<T = void>(
    body: BodyInit | null,
    name: string,
    ...cliArguments: string[]
  ): Promise<T> {
    const response = await this.runStandaloneCommand(body, name, ...cliArguments)
    const json: JSONRPCResponse<never> = await response.json()
    if ('result' in json) {
      return json.result
    } else {
      throw new Error(json.error.message)
    }
  }

  /** Run the Project Manager binary with the given command-line arguments. */
  private async runProjectServiceCommand<T = void>(name: string, body: object | null): Promise<T> {
    const response = await fetch(`/api/project-service/${name}`, {
      method: 'POST',
      body: body && JSON.stringify(body),
    })
    const json: JSONRPCResponse<never> = await response.json()
    if ('result' in json) {
      return json.result
    } else {
      throw new Error(json.error.message)
    }
  }

  private async getProjectCacheKey(projectPath: Path) {
    const projectId = await this.getProjectId(projectPath)
    if (projectId == null) {
      return undefined
    }
    return makeProjectCacheKey({
      projectId,
      projectsDirectory: getDirectoryAndName(projectPath).directoryPath,
    })
  }

  private async requireProjectCacheKey(projectPath: Path) {
    const cacheKey = await this.getProjectCacheKey(projectPath)
    if (cacheKey == null) {
      throw new Error(`Unknown project id for project '${projectPath}'.`)
    }
    return cacheKey
  }
}
