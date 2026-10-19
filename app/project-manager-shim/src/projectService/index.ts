/**
 * @file TypeScript implementation of the ProjectService.
 * This module provides project management functionality including creating, deleting,
 * renaming, opening, closing, and duplicating projects.
 */
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { makeProjectTelemetryKey } from 'enso-common/src/services/ProjectManager/projectIdentity'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import KSUID from 'ksuid'
import * as crypto from 'node:crypto'
import type { ProjectLifecycleListener } from '../localMetadata/index.js'
import { withinVersioningTimeout, type LocalVersioning } from '../localVersioning/index.js'
import {
  EnsoRunner,
  findEnsoExecutable,
  type LanguageServerSockets,
  type Runner,
  type Socket,
} from './ensoRunner.js'
import * as nameValidation from './nameValidation.js'
import {
  ProjectFileRepository,
  type Project,
  type ProjectMetadata,
  type ProjectRepository,
} from './projectRepository.js'
import { UUID, type Path } from './types.js'

export interface RunningLanguageServerInfo {
  readonly sockets: LanguageServerSockets
  readonly projectName: string
  readonly projectNormalizedName: string
  readonly projectNamespace: string
}

/** Parameters for the "create project" endpoint. */
export interface CreateProjectParams {
  readonly name: string
  readonly projectTemplate?: string
  readonly version?: string
  readonly projectsDirectory?: Path
}

/** The return value of the "create project" endpoint. */
export interface CreateProject {
  readonly projectId: UUID
  readonly projectName: string
  readonly projectNormalizedName: string
  readonly projectPath: Path
}

/** The return value of the "open project" endpoint. */
export interface OpenProject {
  readonly projectId: UUID
  readonly languageServerJsonAddress: Socket
  readonly languageServerYdocAddress: Socket
  readonly projectName: string
  readonly projectNormalizedName: string
  readonly projectNamespace: string
}

/** The return value of the "close project" endpoint. */
export interface CloseProjectResult {
  /** Set when the project was closed but saving a version of it failed. */
  readonly versioningWarning?: string
}

/** The return value of the "duplicate project" endpoint. */
export interface DuplicatedProject {
  readonly projectId: UUID
  readonly projectName: string
  readonly projectPath: Path
  readonly projectNormalizedName: string
}

/** Service for managing Enso projects. */
export class ProjectService {
  private static readonly DEFAULT_NAMESPACE = 'local'

  /**
   * Creates a new ProjectService with the specified runner.
   * @param lifecycle - Told about project directories this service moves or deletes.
   */
  constructor(
    private readonly runner: Runner,
    private readonly extraArgs: readonly string[],
    private readonly logger: Console = console,
    private readonly lifecycle?: ProjectLifecycleListener,
    private readonly versioning?: LocalVersioning,
    /** Environment variables added to every engine this service starts. */
    private readonly extraEnvironment?: () => readonly (readonly [string, string])[],
  ) {}

  /** Why the last close-commit of each project (by path) failed, until `closeProject` reports it. */
  private readonly versioningWarnings = new Map<string, string>()

  /** Creates a default ProjectService using the Enso executable found in the environment. */
  static default(
    workDir: string = '.',
    extraArgs: readonly string[] = [],
    lifecycle?: ProjectLifecycleListener,
    versioning?: LocalVersioning,
    extraEnvironment?: () => readonly (readonly [string, string])[],
  ): ProjectService {
    const ensoPath = findEnsoExecutable(workDir)
    if (!ensoPath) {
      throw new Error(`${PRODUCT_NAME} executable not found`)
    }
    const runner = new EnsoRunner(ensoPath)

    // Read extra arguments from environment variable
    const envArgs = process.env.ENSO_ENGINE_ARGS
    const envArgsArray = envArgs ? envArgs.split(/\s+/).filter((arg) => arg.length > 0) : []
    const allExtraArgs = [...envArgsArray, ...extraArgs]

    return new ProjectService(
      runner,
      allExtraArgs,
      console,
      lifecycle,
      versioning,
      extraEnvironment,
    )
  }

  /** Tell {@link lifecycle} about a change that has already happened; failures are only logged. */
  private async notifyLifecycle(
    notify: (listener: ProjectLifecycleListener) => Promise<void>,
  ): Promise<void> {
    if (this.lifecycle == null) return
    try {
      await notify(this.lifecycle)
    } catch (error) {
      this.logger.error('Failed to update local metadata:', error)
    }
  }

  /** Creates a new user project with the specified configuration. */
  async createProject(
    projectName: string,
    projectsDirectory: Path,
    projectTemplate?: string,
  ): Promise<CreateProject> {
    const projectId = this.generateUUID()
    const repo = this.getProjectRepository(projectsDirectory)

    // Ensure unique name
    const actualName = await this.getNameForNewProject(projectName, repo)

    // Validation
    await this.validateProjectName(actualName)
    await this.checkIfNameExists(actualName, repo)

    // Normalize project name
    const normalizedName = nameValidation.normalizedName(actualName)

    // Find path for new project
    const projectPath = await repo.findPathForNewProject(normalizedName)
    const creationTime = toRfc3339(new Date())
    const project: Project = {
      id: projectId,
      name: actualName,
      namespace: ProjectService.DEFAULT_NAMESPACE,
      kind: 'UserProject',
      created: creationTime,
      path: projectPath,
    }

    // Create project structure
    await this.runner.createProject(projectPath, actualName, projectTemplate)

    // Update metadata
    await repo.update(project)

    this.logger.debug('Created project', projectPath)

    return {
      projectId,
      projectName: actualName,
      projectNormalizedName: normalizedName,
      projectPath,
    }
  }

  private async getProject(
    projectId: UUID,
    projectsDirectory: Path,
    update = false,
  ): Promise<Project> {
    const repo = this.getProjectRepository(projectsDirectory)
    const project = await repo.findById(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    if (update) {
      // Update the lastOpened timestamp
      const openTime = toRfc3339(new Date())
      const updatedProject = { ...project, lastOpened: openTime }
      await this.getProjectRepository(projectsDirectory).update(updatedProject)
    }
    return project
  }

  private async projectEnvVars(
    projectId: UUID,
    projectsDirectory: Path,
  ): Promise<readonly (readonly [string, string])[]> {
    const localSessionId = `localprojectsession-${KSUID.randomSync().string}`
    const localProjectKey = await makeProjectTelemetryKey(projectsDirectory, projectId)
    return [
      ['ENSO_LOCAL_PROJECT_ID', localProjectKey],
      ['ENSO_LOCAL_PROJECT_SESSION_ID', localSessionId],
      ...(this.extraEnvironment?.() ?? []),
    ]
  }

  /** Run an existing Enso project at the specified path. */
  async runProject(projectId: UUID, projectsDirectory: Path): Promise<number> {
    const project = await this.getProject(projectId, projectsDirectory, true)
    this.logger.debug(`Running project '${project.path}'`)
    const exitCode = await this.runner.runProject(
      project.path,
      await this.projectEnvVars(projectId, projectsDirectory),
    )
    this.logger.debug(`Project '${project.path}' finished running`)
    return exitCode
  }

  /** Open a project and starts its language server. */
  async openProject(projectId: UUID, projectsDirectory: Path): Promise<OpenProject> {
    this.logger.debug('Opening project', projectId)

    const project = await this.getProject(projectId, projectsDirectory, true)

    // Update the lastOpened timestamp
    const openTime = toRfc3339(new Date())
    const updatedProject = { ...project, lastOpened: openTime }
    await this.getProjectRepository(projectsDirectory).update(updatedProject)

    // Start the language server
    const sockets = await this.runner.openProject(
      project.path,
      projectId,
      this.extraArgs.length > 0 ? this.extraArgs : undefined,
      await this.projectEnvVars(projectId, projectsDirectory),
    )

    // Registered before any rename hook, so a project is saved before its directory moves.
    if (this.versioning != null) {
      const versioning = this.versioning
      await this.runner.registerShutdownHook(project.path, 'version-on-close', async () => {
        try {
          // The repository lookup is git too, so it counts towards the timeout.
          await withinVersioningTimeout(
            (async () => {
              await versioning.commitIfEnabled([project.path], 'Saved on close')
            })(),
          )
        } catch (error) {
          this.logger.error(`Failed to save project ${projectId} on close:`, error)
          this.versioningWarnings.set(
            project.path,
            error instanceof Error ? error.message : String(error),
          )
        }
      })
    }

    // Return the OpenProject response
    return {
      projectId,
      languageServerJsonAddress: sockets.jsonSocket,
      languageServerYdocAddress: sockets.ydocSocket,
      projectName: project.name,
      projectNormalizedName: nameValidation.normalizedName(project.name),
      projectNamespace: project.namespace,
    }
  }

  /** Closes a project and stops its language server. */
  async closeProject(projectId: UUID, projectsDirectory: Path): Promise<CloseProjectResult> {
    const repo = this.getProjectRepository(projectsDirectory)
    const project = await repo.findById(projectId)
    if (!project) {
      throw new Error(`Project '${projectId}' not found`)
    }
    this.logger.debug('Closing project', projectId, projectsDirectory)
    this.versioningWarnings.delete(project.path)
    await this.runner.closeProject(project.path)
    const versioningWarning = this.versioningWarnings.get(project.path)
    this.versioningWarnings.delete(project.path)
    return versioningWarning != null ? { versioningWarning } : {}
  }

  /** Deletes a user project. */
  async deleteProject(projectId: UUID, projectsDirectory: Path): Promise<void> {
    this.logger.debug('Deleting project', projectId)

    const repo = this.getProjectRepository(projectsDirectory)
    const project = await repo.findById(projectId)
    if (!project) {
      throw new Error(`Project '${projectId}' not found`)
    }

    try {
      await repo.moveToTrash(project.path)
      this.logger.debug('Project moved to trash', projectId)
    } catch (error) {
      // If moving to trash fails, permanently delete
      await repo.delete(project.path)
      this.logger.debug('Project permanently deleted', projectId, error)
    }
    await this.notifyLifecycle((listener) => listener.projectDeleted(projectId))
  }

  /** Duplicates a project. */
  async duplicateProject(projectId: UUID, projectsDirectory: Path): Promise<DuplicatedProject> {
    this.logger.debug('Duplicating project', projectId)
    const repo = this.getProjectRepository(projectsDirectory)
    // Get the original project
    const originalProject = await repo.findById(projectId)
    if (!originalProject) {
      throw new Error(`Project not found: ${projectId}`)
    }
    // Generate a suggested name for the duplicated project
    const suggestedName = this.getNameForDuplicatedProject(originalProject.name)
    // Get an available name (checking for conflicts)
    const newName = await this.getNameForNewProject(suggestedName, repo)
    // Validate the new name
    await this.validateProjectName(newName)
    // Create new metadata
    const newProjectId = this.generateUUID()
    const creationTime = toRfc3339(new Date())
    const newMetadata: ProjectMetadata = {
      id: newProjectId,
      name: newName,
      namespace: originalProject.namespace,
      created: creationTime,
    }
    // Copy the project
    const newProject = await repo.copyProject(originalProject, newName, newMetadata)
    return {
      projectId: newProject.id,
      projectName: newProject.name,
      projectNormalizedName: nameValidation.normalizedName(newProject.name),
      projectPath: newProject.path,
    }
  }

  /**
   * Creates a new project in `parentPath` named after `title` (made unique if taken), populating
   * its directory with `populate` and giving it a new identity. The directory must not exist when
   * `populate` is called, and `populate` may leave out `.enso/`.
   */
  async duplicateProjectInto(
    title: string,
    parentPath: Path,
    populate: (targetPath: Path) => Promise<void>,
  ): Promise<DuplicatedProject> {
    const repo = new ProjectFileRepository(parentPath)
    const newName = await this.getNameForNewProject(title, repo)
    await this.validateProjectName(newName)
    const targetPath = await repo.findPathForNewProject(newName)
    await populate(targetPath)
    try {
      const newProject = await repo.giveNewIdentity(targetPath, newName, {
        id: this.generateUUID(),
        name: newName,
        namespace: ProjectService.DEFAULT_NAMESPACE,
        created: toRfc3339(new Date()),
      })
      return {
        projectId: newProject.id,
        projectName: newProject.name,
        projectNormalizedName: nameValidation.normalizedName(newProject.name),
        projectPath: newProject.path,
      }
    } catch (error) {
      await repo.delete(targetPath).catch(() => {})
      throw error
    }
  }

  /** Whether the project at `projectPath` is running. */
  async isProjectRunning(projectPath: Path): Promise<boolean> {
    return this.runner.isProjectRunning(projectPath)
  }

  /** Renames a project. */
  async renameProject(projectId: UUID, newName: string, projectsDirectory: Path): Promise<void> {
    this.logger.debug('Renaming project', projectId, 'to', newName)
    // Validate the new project name
    await this.validateProjectName(newName)
    // Get the repository
    const repo = this.getProjectRepository(projectsDirectory)
    // Check if project exists
    const project = await repo.findById(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    // Check if new name already exists
    await this.checkIfNameExists(newName, repo)
    // Get the old package name (normalized)
    const oldNormalizedName = nameValidation.normalizedName(project.name)
    // Get the namespace
    const namespace = project.namespace
    // Create new package name (normalized)
    const newNormalizedName = nameValidation.normalizedName(newName)
    // Rename in the repository (updates metadata)
    await repo.rename(projectId, newName)
    // Check if language server is running for this project
    const isRunning = await this.runner.isProjectRunning(project.path)
    if (isRunning) {
      // Register a shutdown hook to rename the directory after the server stops
      await this.runner.registerShutdownHook(project.path, 'rename-project-directory', async () => {
        this.logger.info(`Executing deferred directory rename for project ${projectId}`)
        try {
          const newPath = await repo.renameProjectDirectory(project.path, newNormalizedName)
          this.logger.info(`Successfully renamed project directory for ${projectId}`)
          const warning = await this.versioning?.commitMove(
            project.path,
            newPath,
            `Renamed ${project.name} to ${newName}`,
          )
          if (warning != null && !this.versioningWarnings.has(project.path)) {
            this.versioningWarnings.set(project.path, warning)
          }
          await this.notifyLifecycle((listener) => listener.projectMoved(projectId, newPath))
        } catch (error) {
          this.logger.error(`Failed to rename project directory for ${projectId}:`, error)
        }
      })
      // Send rename command to the running server
      await this.runner.renameProject(project.path, namespace, oldNormalizedName, newNormalizedName)
    } else {
      // If server is not running, rename the directory immediately
      const newPath = await repo.renameProjectDirectory(project.path, newNormalizedName)
      await this.versioning?.commitMove(
        project.path,
        newPath,
        `Renamed ${project.name} to ${newName}`,
      )
      await this.notifyLifecycle((listener) => listener.projectMoved(projectId, newPath))
    }
  }

  private generateUUID(): UUID {
    return UUID(crypto.randomUUID())
  }

  private getProjectRepository(projectsDirectory: Path): ProjectRepository {
    return new ProjectFileRepository(projectsDirectory)
  }

  private async getNameForNewProject(
    projectName: string,
    repo: ProjectRepository,
  ): Promise<string> {
    const mkName = (name: string, suffix: number): string => `${name}_${suffix}`

    const findAvailableName = async (name: string, suffix: number): Promise<string> => {
      const newName = mkName(name, suffix)
      const exists = await repo.exists(newName)
      if (exists) {
        return findAvailableName(name, suffix + 1)
      }
      return newName
    }

    const exists = await repo.exists(projectName)
    if (exists) {
      return findAvailableName(projectName, 1)
    }
    return projectName
  }

  private async validateProjectName(name: string): Promise<void> {
    if (name.trim().length === 0) {
      throw new Error('Project name cannot be empty.')
    }
  }

  private async checkIfNameExists(name: string, repo: ProjectRepository): Promise<void> {
    const exists = await repo.exists(name)
    if (exists) {
      throw new Error(`Project with name '${name}' already exists.`)
    }
  }

  private getNameForDuplicatedProject(projectName: string): string {
    return `${projectName} (copy)`
  }

  /** Gets the version of the Enso executable. */
  async version(): Promise<string> {
    return this.runner.version()
  }
}
