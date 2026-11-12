/**
 * @file TypeScript implementation of the ProjectService.
 * This module provides project management functionality including creating, deleting,
 * renaming, opening, closing, and duplicating projects.
 */
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { makeProjectTelemetryKey } from 'enso-common/src/services/ProjectManager/projectIdentity'
import { engineLoggingArgs, type EngineLoggingOptions } from 'enso-common/src/services/engineLogs'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import KSUID from 'ksuid'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import { getEngineLogDirectory } from '../distributionManager.js'
import { EngineLogHub } from '../engineLogs/hub.js'
import type { JvmAotCache } from '../jvmAot/index.js'
import type { ProjectLifecycleListener } from '../localMetadata/index.js'
import { withinVersioningTimeout, type LocalVersioning } from '../localVersioning/index.js'
import { samplesSettled } from '../samples/index.js'
import {
  comparableProjectPath,
  EnsoRunner,
  findEnsoExecutable,
  type EngineLaunch,
  type LanguageServerSockets,
  type Runner,
  type Socket,
} from './ensoRunner.js'
import * as nameValidation from './nameValidation.js'
import { NATIVE_REMOVED_NOTICE, nativeRequested } from './nativeRequest.js'
import {
  ProjectFileRepository,
  type Project,
  type ProjectMetadata,
  type ProjectRepository,
} from './projectRepository.js'
import { spawnKey } from './spareEngine.js'
import { engineTimeouts } from './timeouts.js'
import { Path, UUID } from './types.js'
import type { YdocHost } from './ydocHost.js'

export { loopbackOrigins, type YdocHost, type YdocListenRequest } from './ydocHost.js'

export interface RunningLanguageServerInfo {
  readonly sockets: LanguageServerSockets
  readonly projectName: string
  readonly projectNormalizedName: string
  readonly projectNamespace: string
}

/** What the host gives the project service besides its arguments. */
export interface EngineSettings {
  /** The per-user JDK AOT cache: its options go to every engine, and opens stop its training. */
  readonly jvmAot?: JvmAotCache | undefined
  /**
   * Where opened projects' ydoc servers run: Electron's utility process, or `NodeYdocHost` in the
   * Vite dev server. Without one no ydoc server is started.
   */
  readonly ydocHost?: YdocHost | undefined
  /**
   * The engine's launcher, when the host knows better than the search (a Linux AppImage's copy,
   * `jvmAot/stableEngine.ts`); a user's `ENSO_ENGINE_PATH` still wins (`findEnsoExecutable`).
   */
  readonly ensoExecutable?: string | undefined
  /** Told when each open starts and is answered (a failure too), like `jvmAot`. */
  readonly openObserver?: OpenObserver | undefined
  /** How long after a close the next spare engine waits for the closing engine to exit (2 s). */
  readonly spareAfterCloseMs?: number | undefined
}

/** Hears opens: Electron holds a Linux AppImage's engine copy back until the first is answered. */
export interface OpenObserver {
  openStarted(): void
  openAnswered(): void
}

/**
 * After a close, the next spare engine starts once the closing engine has exited or this long has
 * passed, whichever is first, so the two do not compete for CPU (spec, "After a close").
 */
export const SPARE_AFTER_CLOSE_MS = 2000

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
    private readonly engine?: EngineSettings,
  ) {}

  /** How an engine is launched: the timeouts and the AOT cache's options. */
  private async engineLaunch(): Promise<EngineLaunch> {
    return { timeouts: engineTimeouts(), ...(await this.aotOptions()) }
  }

  /** The AOT cache's options for an engine (`jvmOptions` of its launch), when there is a cache. */
  private async aotOptions(): Promise<Pick<EngineLaunch, 'jvmOptions'>> {
    const jvmAot = this.engine?.jvmAot
    if (jvmAot == null) return {}
    try {
      const jvmOptions = await jvmAot.jvmOptions()
      return jvmOptions.length > 0 ? { jvmOptions } : {}
    } catch (error) {
      this.logger.error('Failed to read the AOT cache:', error)
      return {}
    }
  }

  /** Why the last close-commit of each project (by path) failed, until `closeProject` reports it. */
  private readonly versioningWarnings = new Map<string, string>()
  /** The projects `openProject` is working on, by {@link comparableProjectPath}, with a count. */
  private readonly openingProjects = new Map<string, number>()

  /** The engine logs of the open projects, served by `GET /api/engine-logs/stream`. */
  readonly engineLogs = new EngineLogHub()

  /** Settings → Local → Engine's "Pre-start the engine"; `undefined` until the GUI sends it. */
  private spareSetting: boolean | undefined
  /** Set on quit: no spare is started again. */
  private spareStopped = false
  /** Why the last spare decision started none, for an open's log; `undefined` once one started. */
  private spareIdleReason: string | undefined
  /** Spare decisions, one at a time. */
  private spareQueue: Promise<void> = Promise.resolve()
  /** A close has happened since a spare was last started: one whose start failed may be tried again. */
  private spareRetryAllowed = false
  /** Opens from `openProject`'s first line to its answer (a failure too). */
  private opensInFlight = 0
  /** Opens ever started: a spare decision that sees it change has met an open. */
  private opensStarted = 0

  /**
   * `engine/setSpare`: the GUI's setting. Until the first call no spare is started.
   */
  async setSpareEngine(enabled: boolean): Promise<void> {
    this.spareSetting = enabled
    await this.refreshSpare()
  }

  /** Start the spare engine if one is wanted (`spareEngine.ts`), stop it otherwise. */
  refreshSpare(): Promise<void> {
    this.spareQueue = this.spareQueue
      .then(() => this.refreshSpareNow())
      .catch((error: unknown) => this.logger.error('Failed to update the spare engine:', error))
    return this.spareQueue
  }

  /**
   * Quit: stop the spare engine for good. With `waitMs`, wait for it (and any stopped one still
   * exiting) to exit, killing its tree after `waitMs` (`EnsoRunner.stopSpare`).
   */
  async stopSpareEngine(options: { readonly waitMs?: number } = {}): Promise<void> {
    this.spareStopped = true
    await this.refreshSpare()
    if (options.waitMs != null) await this.runner.stopSpare?.('quitting', options)
  }

  /** Whether a spare engine runs, or a stopped one has not exited yet. */
  spareEngineAlive(): boolean {
    return this.runner.spareAlive?.() ?? false
  }

  private async refreshSpareNow(): Promise<void> {
    const runner = this.runner
    if (runner.startSpare == null || runner.stopSpare == null) return
    const opensBefore = this.opensStarted
    const reason = this.spareSettingsReason()
    if (reason != null) {
      this.spareIdleReason = reason
      await runner.stopSpare(reason)
      return
    }
    const launch = await this.engineLaunch()
    const key = this.spareKeyFor(launch)
    const inUse =
      runner.hasProjectsInUse != null ?
        await runner.hasProjectsInUse()
      : await runner.hasRunningProjects()
    // Decided after the last await, with nothing awaited before `startSpare`: an open that started
    // at any point of this decision (it is counted from its first line) means no spare, and so
    // does a quit, and so does an AOT training that `JvmAotCache.start()` began meanwhile (its end
    // refreshes the spare).
    const lateReason =
      this.spareStopped ? 'quitting'
      : this.opensInFlight > 0 || this.opensStarted !== opensBefore ? 'a project is opening'
      : inUse ? 'a project is open'
      : this.engine?.jvmAot?.isTraining() === true ? 'the AOT cache is training'
      : undefined
    if (lateReason != null) {
      // A failed spare is tried again only once nothing is in use; the next close allows it again.
      if (lateReason === 'a project is opening' || lateReason === 'a project is open') {
        this.spareRetryAllowed = false
      }
      // The open that this decision met reports the reason it had no spare before it.
      if (lateReason !== 'a project is opening') this.spareIdleReason = lateReason
      // An opening project takes a running spare or stops it itself (`EnsoRunner.openProject`).
      if (lateReason !== 'a project is opening') await runner.stopSpare(lateReason)
      return
    }
    if (this.spareRetryAllowed) {
      this.spareRetryAllowed = false
      runner.spareAvailableAgain?.()
    }
    this.spareIdleReason = undefined
    runner.startSpare({
      key,
      extraArgs: this.extraArgs,
      extraEnv: this.extraEnvironment?.() ?? [],
      launch: { ...launch, spareKey: key },
    })
  }

  /** Whether spares are off: the setting, or `ENSO_SPARE_ENGINE=0`. An open then logs nothing. */
  private spareDisabled(): boolean {
    return this.spareSetting !== true || process.env.ENSO_SPARE_ENGINE === '0'
  }

  /** Why the settings want no spare; `undefined` when they want one. */
  private spareSettingsReason(): string | undefined {
    if (this.spareStopped) return 'quitting'
    if (this.spareSetting !== true) {
      return this.spareSetting === false ? 'the setting is off' : 'the GUI has not sent the setting'
    }
    if (process.env.ENSO_SPARE_ENGINE === '0') return 'ENSO_SPARE_ENGINE=0'
    // A first launch trains the AOT cache in the background: a spare would compete with it, and
    // be discarded at the next open for the new cache. `onTrainingEnded` refreshes it.
    if (this.engine?.jvmAot?.isTraining() === true) return 'the AOT cache is training'
    // `--profiling-path` takes a relative path, and a standby engine refuses relative paths.
    if (this.extraArgs.includes('--profiling-path')) return 'profiling is on'
    return undefined
  }

  /**
   * The spawn key of an engine started now (decision 8 of the plan; `spawnKey`): a spare and an
   * open with the same settings get the same one. An open's own arguments (its engine logging) and
   * its line variables travel in the spare's line, so they are not part of it.
   */
  private spareKeyFor(launch: Pick<EngineLaunch, 'jvmOptions'>): string {
    return spawnKey({
      args: this.extraArgs,
      jvmOptions: launch.jvmOptions ?? [],
      env: {
        ...Object.fromEntries(this.extraEnvironment?.() ?? []),
        ENSO_JVM_OPTIONS: process.env.ENSO_JVM_OPTIONS ?? '',
      },
    })
  }

  /** After a close: the next spare, once the closing engine has exited or the delay has passed. */
  private async spareAfterClose(closing: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      closing.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.engine?.spareAfterCloseMs ?? SPARE_AFTER_CLOSE_MS)
        // A pending gate never keeps the process alive.
        timer.unref()
      }),
    ])
    clearTimeout(timer)
    this.spareRetryAllowed = true
    await this.refreshSpare()
  }

  /** Creates a default ProjectService using the Enso executable found in the environment. */
  static default(
    workDir: string = '.',
    extraArgs: readonly string[] = [],
    lifecycle?: ProjectLifecycleListener,
    versioning?: LocalVersioning,
    extraEnvironment?: () => readonly (readonly [string, string])[],
    engine?: EngineSettings,
  ): ProjectService {
    const ensoPath = findEnsoExecutable(workDir, engine?.ensoExecutable)
    if (!ensoPath) {
      throw new Error(`${PRODUCT_NAME} executable not found`)
    }
    // The start-up and terminate timeouts come per launch (`engineTimeouts`;
    // `ENSO_ENGINE_STARTUP_TIMEOUT_MS` and `ENSO_ENGINE_TERMINATE_TIMEOUT_MS` override them).
    const runner = new EnsoRunner(ensoPath, { ydocHost: engine?.ydocHost })

    // Read extra arguments from environment variable
    const envArgs = process.env.ENSO_ENGINE_ARGS
    const envArgsArray = envArgs ? envArgs.split(/\s+/).filter((arg) => arg.length > 0) : []

    return new ProjectService(
      runner,
      [...envArgsArray, ...extraArgs],
      console,
      lifecycle,
      versioning,
      extraEnvironment,
      engine,
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

  private projectEnvVars(localProjectKey: string): readonly (readonly [string, string])[] {
    const localSessionId = `localprojectsession-${KSUID.randomSync().string}`
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
    if (await nativeRequested(project.path)) this.logger.warn(NATIVE_REMOVED_NOTICE)
    const launch = await this.engineLaunch()
    const exitCode = await this.runner.runProject(
      project.path,
      this.projectEnvVars(await makeProjectTelemetryKey(projectsDirectory, projectId)),
      launch,
    )
    this.logger.debug(`Project '${project.path}' finished running`)
    return exitCode
  }

  /**
   * Open a project and starts its language server.
   * @param engineLogging - Extra logging for the engine started here; the engine keeps it across
   * restarts until the project closes. A project already open keeps the logging it was opened with.
   */
  async openProject(
    projectId: UUID,
    projectsDirectory: Path,
    engineLogging?: EngineLoggingOptions,
  ): Promise<OpenProject> {
    this.logger.debug('Opening project', projectId)
    // Counted before the first await, so a spare decision that runs meanwhile sees it.
    this.opensInFlight += 1
    this.opensStarted += 1
    let opened = false
    try {
      const result = await this.openProjectCounted(projectId, projectsDirectory, engineLogging)
      opened = true
      return result
    } finally {
      this.opensInFlight -= 1
      // A failed open leaves no project of its own open: a spare may be wanted again. Only now,
      // when it no longer counts as opening.
      if (!opened) void this.refreshSpare()
    }
  }

  /** The rest of {@link openProject}, counted as an open in flight. */
  private async openProjectCounted(
    projectId: UUID,
    projectsDirectory: Path,
    engineLogging: EngineLoggingOptions | undefined,
  ): Promise<OpenProject> {
    const project = await this.getProject(projectId, projectsDirectory, true)
    const openingKey = comparableProjectPath(project.path)
    this.openingProjects.set(openingKey, (this.openingProjects.get(openingKey) ?? 0) + 1)
    try {
      // Counted as opening first, so a samples change still queued sees it and leaves it alone.
      await samplesSettled(project.path)
      return await this.openFoundProject(project, projectId, projectsDirectory, engineLogging)
    } finally {
      const count = (this.openingProjects.get(openingKey) ?? 1) - 1
      if (count > 0) this.openingProjects.set(openingKey, count)
      else this.openingProjects.delete(openingKey)
    }
  }

  /** The rest of {@link openProject}, once the project is found. */
  private async openFoundProject(
    project: Project,
    projectId: UUID,
    projectsDirectory: Path,
    engineLogging: EngineLoggingOptions | undefined,
  ): Promise<OpenProject> {
    // Update the lastOpened timestamp
    const openTime = toRfc3339(new Date())
    const updatedProject = { ...project, lastOpened: openTime }
    await this.getProjectRepository(projectsDirectory).update(updatedProject)

    // The log channel opens before the engine starts, so that its start-up is in the replay buffer.
    const localProjectKey = await makeProjectTelemetryKey(projectsDirectory, projectId)
    // An open project keeps the engine it has: no second notice in the middle of its log.
    const alreadyLogging = this.engineLogs.get(project.path)?.isOpen === true
    const engineLog = this.engineLogs.open({
      projectPath: project.path,
      logDirectory: path.join(getEngineLogDirectory(), localProjectKey),
      localProjectKey,
    })

    // Start the language server
    let sockets: LanguageServerSockets
    let launch: EngineLaunch | undefined
    const engineArgs = [...this.extraArgs, ...engineLoggingArgs(engineLogging)]
    // A running AOT training yields to the open (spec, stage 1d "Yielding").
    const jvmAot = this.engine?.jvmAot
    jvmAot?.openStarted()
    this.engine?.openObserver?.openStarted()
    try {
      if (!alreadyLogging && (await nativeRequested(project.path))) {
        engineLog.notice(NATIVE_REMOVED_NOTICE)
      }
      launch = await this.engineLaunch()
      launch = {
        ...launch,
        spareKey: this.spareKeyFor(launch),
        spareIdleReason: this.spareDisabled() ? null : this.spareIdleReason,
      }
      sockets = await this.runner.openProject(
        project.path,
        projectId,
        engineArgs.length > 0 ? engineArgs : undefined,
        this.projectEnvVars(localProjectKey),
        engineLog,
        launch,
      )
    } catch (error) {
      await engineLog.close()
      throw error
    } finally {
      jvmAot?.openAnswered()
      this.engine?.openObserver?.openAnswered()
      if (jvmAot != null && (launch?.jvmOptions?.length ?? 0) > 0) {
        // The JVM has written its warnings by now: a cache it refused is deleted.
        void jvmAot
          .checkUseLog()
          .catch((error: unknown) => this.logger.error('Failed to check the AOT cache:', error))
      }
    }

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
    const closing = this.runner.closeProject(project.path)
    void this.spareAfterClose(closing)
    try {
      await closing
    } finally {
      // The runner closes it too when the engine stops (`projectClosed`); this covers runners that
      // do not, and a close that threw.
      await this.engineLogs.get(project.path)?.close()
    }
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

  /** Whether any engine this service started is still running; see `Runner.hasRunningProjects`. */
  async hasRunningProjects(): Promise<boolean> {
    return this.runner.hasRunningProjects()
  }

  /** Whether the project at `projectPath` is running. */
  async isProjectRunning(projectPath: Path): Promise<boolean> {
    return this.runner.isProjectRunning(projectPath)
  }

  /**
   * Whether the project at `projectPath` is open or still opening, comparing paths whatever their
   * separators (and case, on Windows). A project that is must not be changed on disk.
   */
  async isProjectOpenOrOpening(projectPath: string): Promise<boolean> {
    if (this.openingProjects.has(comparableProjectPath(projectPath))) return true
    if (this.runner.isProjectOpenOrOpening != null) {
      return this.runner.isProjectOpenOrOpening(projectPath)
    }
    return this.runner.isProjectRunning(Path(projectPath))
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
