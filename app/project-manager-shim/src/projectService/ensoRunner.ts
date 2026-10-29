import { createDeferred, type Deferred } from 'enso-common/src/utilities/async'
import {
  WatchedChildProcess,
  type ChildProcessHandle,
  type UnexpectedExitInfo,
} from 'enso-common/src/utilities/childProcess'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as portfinder from 'portfinder'
import { CommandError, runCommand as runChildCommand } from '../childProcess/runCommand.js'
import { Path } from './types.js'

const HEALTHCHECK_FAILURES_TO_RESTART = 3
const LOAD_HEALTHCHECK_INTERVAL = 250
const WATCHDOG_HEALTHCHECK_INTERVAL = 3000
const LANGUAGE_SERVER_CRASH_LOOP_MAX = 5
const LANGUAGE_SERVER_CRASH_LOOP_WINDOW_MS = 60_000

export interface Runner {
  runProject(projectPath: Path, extraEnv?: readonly (readonly [string, string])[]): Promise<number>
  createProject(path: Path, name: string, projectTemplate?: string): Promise<void>
  openProject(
    projectPath: Path,
    projectId: string,
    extraArgs?: readonly string[],
    extraEnv?: readonly (readonly [string, string])[],
    logSink?: EngineLogSink,
  ): Promise<LanguageServerSockets>
  closeProject(projectPath: Path): Promise<void>
  isProjectRunning(projectPath: Path): Promise<boolean>
  /**
   * Whether any engine this runner started is still alive: an opened project (loading included)
   * or a `--run`. Each holds the environment it was started with, such as the secrets key.
   */
  hasRunningProjects(): Promise<boolean>
  renameProject(
    projectPath: Path,
    namespace: string,
    oldPackage: string,
    newPackage: string,
  ): Promise<void>
  registerShutdownHook(
    projectPath: Path,
    hookType: ShutdownHookType,
    hook: () => Promise<void>,
  ): Promise<void>
  version(): Promise<string>
}

export interface LanguageServerSockets {
  readonly jsonSocket: Socket
  readonly secureJsonSocket?: Socket
  readonly ydocSocket: Socket
}

export interface Socket {
  readonly host: string
  readonly port: number
}

/**
 * Where an opened project's engine output goes, besides this process's own stderr: the engine
 * logs panel (`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`).
 */
export interface EngineLogSink {
  /** An engine process has started (the first, or a respawn): a new log session begins. */
  engineStarted(): void
  /** A chunk the engine wrote to stderr. It has already been written to this process's stderr. */
  engineStderr(chunk: Buffer): void
  /** The project has closed; no engine will start for it again. */
  projectClosed(): void
}

let stderrErrorHandled = false

/**
 * Write `chunk` to this process's stderr, as when the engine inherited it. This is a best-effort
 * terminal echo and must never crash the shim: a broken stream (EPIPE, EBADF) is logged once and
 * then ignored, and back-pressure is not waited for.
 */
function echoToStderr(chunk: Buffer): void {
  if (!stderrErrorHandled) {
    stderrErrorHandled = true
    let reported = false
    process.stderr.on('error', (error) => {
      if (reported) return
      reported = true
      try {
        console.error('Failed to echo the engine stderr; no longer reported:', error)
      } catch {
        // Nowhere left to report to.
      }
    })
  }
  try {
    process.stderr.write(chunk)
  } catch {
    // As above: the echo is best-effort.
  }
}

/**
 * Use declaration merging to allow extension of ShutdownHookRegistry in other modules.
 * This enables adding new shutdown hook types without modifying the original interface.
 *
 * For example, in another module, you can add:
 * ```ts
 * declare module './projectService/ensoRunner.js' {
 *   interface ShutdownHookRegistry {
 *     'my-new-hook-type': true
 *   }
 * }
 * ```
 */
export interface ShutdownHookRegistry {
  'rename-project-directory': true
  'remove-from-list': true
  'version-on-close': true
}

export type ShutdownHookType = keyof ShutdownHookRegistry

const DEFAULT_JSONRPC_PORT = 30616
const LANGUAGE_SERVER_STARTUP_TIMEOUT = 30000

const TERMINATE_TIMEOUT_MS = 10_000

/**
 * How many times an open looks for ports and starts an engine, when each engine fails to bind
 * them. The ports are free when found, but another program can take one before the engine binds it.
 */
const PORT_ATTEMPTS = 3
/** How much of an engine's stderr is kept to tell why it failed to start. */
const STDERR_TAIL_LENGTH = 4096
/** How long to wait for an exited engine's stderr to end, to read why it exited. */
const STDERR_END_TIMEOUT_MS = 1000
/** What a language server prints when it cannot bind its port (Akka, the JVM; Windows and Unix). */
const PORT_IN_USE = /address already in use|EADDRINUSE|BindException/i

class OpenedProject {
  loaded: Promise<void>
  shutdownHooks: Map<ShutdownHookType, () => void | Promise<void>> = new Map()
  private closed = false
  /** Whether an engine has passed its health check: until then, an exit fails the open. */
  private started = false
  private nextWatchdogCheck: ReturnType<typeof setTimeout> | undefined
  private readonly watcher: WatchedChildProcess
  private loadedDeferred: Deferred<void> = createDeferred()
  /** The end of what the latest engine wrote to stderr. */
  private stderrTail = ''
  /** Resolves when the latest engine's stderr has ended (its last output has been read). */
  private stderrEnded: Promise<void> = Promise.resolve()

  private constructor(
    private path: Path,
    public sockets: LanguageServerSockets,
    spawner: () => Promise<childProcess.ChildProcess>,
    private readonly logSink: EngineLogSink | undefined,
    private readonly startupTimeoutMs: number,
  ) {
    this.loaded = this.loadedDeferred.promise
    this.loadedDeferred.promise.catch(() => undefined)
    this.watcher = new WatchedChildProcess(spawner, {
      onChildStarted: (handle) => {
        this.handleStdinErrors(handle)
        this.captureStderr(handle)
        this.startLoadingRoutine()
      },
      onUnexpectedExit: (reason, info) => this.onUnexpectedExit(reason, info),
      crashLoopLimit: {
        maxCrashes: LANGUAGE_SERVER_CRASH_LOOP_MAX,
        windowMs: LANGUAGE_SERVER_CRASH_LOOP_WINDOW_MS,
      },
    })
  }

  static async create(
    path: Path,
    jsonPort: number,
    ydocPort: number,
    spawner: () => Promise<childProcess.ChildProcess>,
    logSink: EngineLogSink | undefined,
    startupTimeoutMs: number,
  ) {
    const sockets = {
      jsonSocket: { host: '127.0.0.1', port: jsonPort },
      ydocSocket: { host: '127.0.0.1', port: ydocPort },
    }
    const project = new OpenedProject(path, sockets, spawner, logSink, startupTimeoutMs)
    // Surface synchronous spawn failures (bad executable path, etc.) to the caller.
    await project.watcher.firstSpawn
    return project
  }

  async close() {
    console.log('Closing Project', this.path)
    this.closed = true
    clearTimeout(this.nextWatchdogCheck)
    // A watchdog respawn may be waiting for the old engine to stop, or spawning: without this it
    // would start an engine after the close, which nothing could close (#335).
    this.watcher.stopRespawning()
    try {
      await this.gracefulShutdown()
    } finally {
      // The engine has exited (or failed to stop): its log is complete. Closed before the hooks,
      // which may take a while, and even when the shutdown threw, so no tailer is left polling.
      this.logSink?.projectClosed()
    }

    for (const [hookType, hook] of this.shutdownHooks) {
      try {
        this.shutdownHooks.delete(hookType)
        await hook()
      } catch (error) {
        console.error(
          `Error executing shutdown hook '${hookType}' for project ${this.path}:`,
          error,
        )
      }
    }
  }

  /**
   * Pass the engine's stderr through to this process's stderr, as when it was inherited, and to the
   * log sink. It is read even without a sink: an unread pipe would fill up and block the engine.
   */
  private captureStderr(handle: ChildProcessHandle): void {
    this.logSink?.engineStarted()
    this.stderrTail = ''
    const stderr = handle.child.stderr
    this.stderrEnded =
      stderr ?
        new Promise<void>((resolve) => stderr.once('close', () => resolve()))
      : Promise.resolve()
    stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_LENGTH)
      echoToStderr(chunk)
      this.logSink?.engineStderr(chunk)
    })
  }

  /**
   * Listen for errors on the engine's stdin, so that none is ever unhandled. The newline of the
   * graceful shutdown (see {@link gracefulShutdown}) fails asynchronously, with `EPIPE`, when the
   * engine exits between the check that it is alive and the write: that means it has exited, and
   * the wait for its exit is what ends the shutdown.
   */
  private handleStdinErrors(handle: ChildProcessHandle): void {
    handle.child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
        console.info('Language server of', this.path, 'closed its stdin; it has exited')
      } else {
        console.error('Error writing to the stdin of the language server of', this.path, error)
      }
    })
  }

  /**
   * Whether the engine that failed to start did so because it could not bind its port: something
   * else took it after the search found it free. The 'exit' event can come before the last of the
   * engine's output is read, so this waits (briefly) for the end of stderr.
   */
  async failedToBindPort(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.stderrEnded,
      new Promise((resolve) => (timeout = setTimeout(resolve, STDERR_END_TIMEOUT_MS))),
    ])
    clearTimeout(timeout)
    return PORT_IN_USE.test(this.stderrTail)
  }

  private startLoadingRoutine(): void {
    const deferred = createDeferred<void>()
    deferred.promise.catch(() => undefined)
    this.loadedDeferred = deferred
    this.loaded = deferred.promise
    // Capture the *specific* handle this attempt is loading, so a stale timeout fired after a
    // respawn doesn't kill the new child or reject the new deferred.
    const handle = this.watcher.current
    let resolved = false

    // Over once this attempt has an answer, or its engine is gone: a health check of the port after
    // that could be answered by another engine, and must not count as this one starting.
    const over = () => this.closed || resolved || !handle?.alive || this.watcher.current !== handle
    const healthCheck = async () => {
      if (over()) return
      const healthy = await this.checkServerHealth()
      if (over()) return
      if (healthy) {
        resolved = true
        this.started = true
        this.startWatchdog()
        deferred.resolve()
        return
      }
      // Not using setInterval to not pile slow-responding healthchecks.
      setTimeout(healthCheck, LOAD_HEALTHCHECK_INTERVAL)
    }
    setTimeout(healthCheck, 250)

    // Timeout if server doesn't start (skip timeout in debug mode)
    const javaToolOptions = process.env.JAVA_TOOL_OPTIONS
    const isDebugMode = javaToolOptions?.includes('jdwp')
    if (!isDebugMode) {
      setTimeout(() => {
        if (resolved || this.closed) return
        resolved = true
        // SIGKILL the *specific* child this routine was waiting on. `onUnexpectedExit` decides
        // whether to respawn: not while the project is still opening, by default after.
        handle?.child.kill('SIGKILL')
        deferred.reject(new Error('Language server startup timeout'))
      }, this.startupTimeoutMs)
    }
  }

  private onUnexpectedExit(reason: string, info: UnexpectedExitInfo): boolean | undefined {
    clearTimeout(this.nextWatchdogCheck)
    if (this.closed) {
      // Exit caused by our own gracefulShutdown — suppress respawn so the port frees up.
      return false
    }
    this.loadedDeferred.reject(new Error(reason))
    if (!this.started) {
      // The open has failed, and is not retried: nothing could close an engine started now. Nor
      // is anything else of this project's ever started again.
      this.closed = true
      console.error(`Language Server for project ${this.path} exited while starting (${reason}).`)
      return false
    }
    if (info.exceedsCrashLimit) {
      console.error(
        `Language Server for project ${this.path} crashed ${LANGUAGE_SERVER_CRASH_LOOP_MAX} times within ${LANGUAGE_SERVER_CRASH_LOOP_WINDOW_MS}ms (${reason}); auto-respawn suspended.`,
      )
      // Defer to the watcher's default for exceedsCrashLimit (suspend). The healthcheck loop
      // is no longer scheduled, so nothing will respawn until something external triggers it.
      return
    }
    console.error(
      `Language Server process for project ${this.path} exited unexpectedly (${reason}); restarting`,
    )
  }

  private startWatchdog(): void {
    let failures = 0
    const check = async () => {
      if (this.closed) return
      if (await this.checkServerHealth()) {
        failures = 0
      } else {
        console.error('Healthcheck failed! Project:', this.path)
        failures += 1
      }
      if (failures >= HEALTHCHECK_FAILURES_TO_RESTART) {
        console.error(
          `Healthcheck of ${this.path} failed ${HEALTHCHECK_FAILURES_TO_RESTART} times in a row, restarting.`,
        )
        // The respawn triggers `onUnexpectedExit` followed by `onChildStarted`, which restarts
        // this watchdog loop on the new child. Don't schedule another `check` here.
        void this.watcher.respawn(TERMINATE_TIMEOUT_MS)
      } else {
        // Not using setInterval to not pile slow-responding healthchecks.
        this.nextWatchdogCheck = setTimeout(check, WATCHDOG_HEALTHCHECK_INTERVAL)
      }
    }
    this.nextWatchdogCheck = setTimeout(check, WATCHDOG_HEALTHCHECK_INTERVAL)
  }

  /**
   * Trigger the language server's graceful shutdown protocol (a single newline written to
   * stdin) and wait for the child to exit. SIGKILL after a timeout if it doesn't.
   */
  private async gracefulShutdown(): Promise<void> {
    const handle = this.watcher.current
    if (!handle?.alive) return
    console.log('Terminating language server process of', this.path)
    if (handle.child.stdin && !handle.child.stdin.destroyed) {
      handle.child.stdin.write('\n')
      const killTimeout = setTimeout(() => {
        if (handle.alive) {
          console.error('Language Server process of', this.path, "didn't finish in time. Killing.")
          handle.child.kill('SIGKILL')
        }
      }, TERMINATE_TIMEOUT_MS)
      try {
        await handle.waitForExit()
      } finally {
        clearTimeout(killTimeout)
      }
      console.log('Language server process of', this.path, 'exited')
      return
    }
    // No stdin to write to — fall back to SIGTERM with SIGKILL after timeout.
    await handle.terminate({ timeoutMs: TERMINATE_TIMEOUT_MS })
  }

  // Health check function
  async checkServerHealth(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://${this.sockets.jsonSocket.host}:${this.sockets.jsonSocket.port}/_health`,
      )
      return response.ok
    } catch {
      return false
    }
  }
}

/** Implementation of Runner that uses the Enso executable. */
export class EnsoRunner implements Runner {
  private runningProjects = new Map<Path, OpenedProject>()
  private loadingProjects = new Map<Path, Promise<OpenedProject>>()
  /** The `--run` processes that have not exited yet. */
  private activeRuns = 0

  /**
   * Creates a new EnsoRunner with the path to the Enso executable. `firstPort` is where the search
   * for an engine's free ports starts; `startupTimeoutMs` is how long an engine has to pass its
   * first health check before it is killed.
   */
  constructor(
    private ensoPath: Path,
    private readonly options: {
      readonly firstPort?: number
      readonly startupTimeoutMs?: number
    } = {},
  ) {}

  private resolveCommandAndArgs(args: readonly string[]): [string, readonly string[]] {
    const [cmd, cmdArgs] =
      this.ensoPath.endsWith('.bat') ?
        ['cmd.exe', ['/c', this.ensoPath, ...args]]
      : [this.ensoPath, args]
    const isDevMode = process.env.NODE_ENV === 'development'
    if (isDevMode) {
      console.log('runProcess', cmd, cmdArgs.join(' '))
    }
    return [cmd, cmdArgs]
  }

  private async runProcess<T extends childProcess.ChildProcess>(
    args: readonly string[],
    spawnCallback: (cmd: string, cmdArgs: readonly string[]) => T,
  ) {
    const [cmd, cmdArgs] = this.resolveCommandAndArgs(args)
    return spawnCallback(cmd, cmdArgs)
  }

  private async runCommand(
    args: readonly string[],
    options?: childProcess.SpawnOptionsWithoutStdio,
  ): Promise<void> {
    const [cmd, cmdArgs] = this.resolveCommandAndArgs(args)

    const commandOptions: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } | undefined =
      !options ? undefined : (
        {
          ...(options.cwd && typeof options.cwd === 'string' && { cwd: options.cwd }),
          ...(options.env && { env: options.env }),
        }
      )

    try {
      await runChildCommand(cmd, cmdArgs as string[], commandOptions)
    } catch (error) {
      if (error instanceof CommandError) {
        throw new Error(
          `Enso process exited with code ${error.code}.\nstdout: ${error.stdout}\nstderr: ${error.stderr}`,
          { cause: error },
        )
      }
      throw new Error(`Failed to spawn enso process: ${(error as Error).message}`, {
        cause: error,
      })
    }
  }

  /** Run an existing Enso project at the specified path. Returns the exit code of the process. */
  async runProject(
    projectPath: Path,
    extraEnv?: readonly (readonly [string, string])[],
  ): Promise<number> {
    const args = ['--run', projectPath]
    const env = { ...process.env, ...(extraEnv ? Object.fromEntries(extraEnv) : {}) }
    const cwd = path.dirname(projectPath)
    const spawnedProcess = await this.runProcess(args, (cmd, cmdArgs) =>
      childProcess.spawn(cmd, cmdArgs, { env, cwd, stdio: ['inherit', 'inherit', 'inherit'] }),
    )
    this.activeRuns += 1
    let counted = true
    const finished = () => {
      if (counted) this.activeRuns -= 1
      counted = false
    }
    // A spawn failure emits `error` and no `exit`; an exit may also be followed by an `error`.
    spawnedProcess.once('error', finished)
    spawnedProcess.once('exit', finished)
    return new Promise((resolve, reject) => {
      spawnedProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn enso process: ${error.message}`))
      })
      spawnedProcess.on('exit', resolve)
    })
  }

  /** Create a new Enso project at the specified path. */
  async createProject(projectPath: Path, name: string, projectTemplate?: string): Promise<void> {
    return await this.runCommand([
      '--new',
      projectPath,
      '--new-project-name',
      name,
      ...(projectTemplate ? ['--new-project-template', projectTemplate] : []),
    ])
  }

  /** Open a project and starts its language server. */
  async openProject(
    projectPath: Path,
    projectId: string,
    extraArgs?: readonly string[],
    extraEnv?: readonly (readonly [string, string])[],
    logSink?: EngineLogSink,
  ): Promise<LanguageServerSockets> {
    // Check if the project is already running
    const runningProject = this.runningProjects.get(projectPath)
    if (runningProject) {
      return runningProject.sockets
    }
    const loadingProject = this.loadingProjects.get(projectPath)
    if (loadingProject) {
      return (await loadingProject).sockets
    }

    // Finding server ports is not reliable if another project is opening.
    while (this.loadingProjects.size > 0) {
      // Only waited for: that open's failure is its own caller's.
      await this.loadingProjects
        .values()
        .next()
        .value?.catch(() => undefined)
    }
    const openedProject = (async () => {
      // The ports are found free, but another program can take one before the engine binds it:
      // such an engine exits with a bind failure, and the open looks for new ports and tries again.
      for (let attempt = 1; ; attempt++) {
        const [jsonPort, ydocPort] = await this.findServerPorts(
          this.options.firstPort ?? DEFAULT_JSONRPC_PORT,
        )
        const rootId = crypto.randomUUID()
        const args: readonly string[] = [
          '--server',
          '--root-id',
          rootId,
          '--project-id',
          projectId,
          '--path',
          projectPath,
          '--interface',
          '127.0.0.1',
          '--rpc-port',
          jsonPort.toString(),
          ...(extraArgs ?? []),
        ]

        const env = {
          ...process.env,
          LANGUAGE_SERVER_YDOC_PORT: ydocPort.toString(),
          ...(extraEnv ? Object.fromEntries(extraEnv) : {}),
        }

        const cwd = path.dirname(projectPath)
        const project = await OpenedProject.create(
          projectPath,
          jsonPort,
          ydocPort,
          () =>
            this.runProcess(args, (cmd, cmdArgs) =>
              childProcess.spawn(cmd, cmdArgs, {
                env,
                detached: false,
                cwd,
                stdio: ['pipe', 'inherit', 'pipe'],
                windowsHide: true,
              }),
            ),
          logSink,
          this.options.startupTimeoutMs ?? LANGUAGE_SERVER_STARTUP_TIMEOUT,
        )
        project.shutdownHooks.set('remove-from-list', () => {
          this.runningProjects.delete(projectPath)
          this.loadingProjects.delete(projectPath)
        })
        try {
          await project.loaded
          return project
        } catch (error) {
          if (attempt >= PORT_ATTEMPTS || !(await project.failedToBindPort())) throw error
          console.warn(
            `Language Server for project ${projectPath} could not bind its port; looking for new ports.`,
          )
        }
      }
    })()

    this.loadingProjects.set(projectPath, openedProject)
    // The caller gets the failure, from the promise returned below.
    void openedProject
      .then(
        (project) => void this.runningProjects.set(projectPath, project),
        () => undefined,
      )
      .finally(() => this.loadingProjects.delete(projectPath))
    return openedProject.then((project) => project.sockets)
  }

  /** Closes a project and stops its language server. */
  async closeProject(projectPath: Path): Promise<void> {
    // First wait for potential initialization end.
    // A failed open has nothing to close.
    await this.loadingProjects.get(projectPath)?.catch(() => undefined)
    const runningProject = this.runningProjects.get(projectPath)

    if (!runningProject) {
      // Project is not running or already closed
      return
    }

    return runningProject.close()
  }

  /** Checks if a project's language server is currently running. */
  async isProjectRunning(projectPath: Path): Promise<boolean> {
    return this.runningProjects.has(projectPath)
  }

  /** Whether any opened (or opening) project or `--run` process is alive. */
  async hasRunningProjects(): Promise<boolean> {
    return this.runningProjects.size > 0 || this.loadingProjects.size > 0 || this.activeRuns > 0
  }

  /** Registers an action to be executed when the project is closed. */
  async registerShutdownHook(
    projectPath: Path,
    hookType: ShutdownHookType,
    hook: () => void | Promise<void>,
  ): Promise<void> {
    const runningProject = this.runningProjects.get(projectPath)

    if (!runningProject) {
      // If project is not running, execute the hook immediately
      await hook()
      return
    }

    runningProject.shutdownHooks.set(hookType, hook)
  }

  /**
   * Renames the running language server project.
   *
   * It does _not_ rename it's directory.
   */
  async renameProject(
    projectPath: Path,
    namespace: string,
    oldPackage: string,
    newPackage: string,
  ): Promise<void> {
    const runningProject = this.runningProjects.get(projectPath)
    if (!runningProject) {
      throw new Error(`Project ${projectPath} is not running`)
    }

    const { sockets } = runningProject
    const requestBody = {
      namespace: namespace,
      oldName: oldPackage,
      newName: newPackage,
    }

    try {
      // Send POST request to the language server's rename endpoint
      const response = await fetch(
        `http://127.0.0.1:${sockets.jsonSocket.port}/refactoring/renameProject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      )

      if (!response.ok) {
        const errorBody = await response.text()
        let errorMessage = `Failed to rename project: ${response.status} ${response.statusText}`
        try {
          const errorJson = JSON.parse(errorBody)
          if (errorJson.error) {
            errorMessage = `Failed to rename project: ${errorJson.error}`
          }
        } catch {
          if (errorBody) {
            errorMessage += ` - ${errorBody}`
          }
        }
        throw new Error(errorMessage)
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error
      } else {
        throw new Error(`Failed to rename project: ${error}`, { cause: error })
      }
    }
  }

  /** Gets the version of the Enso executable. */
  async version(): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['--version']
      const cmd = this.ensoPath.endsWith('.bat') ? 'cmd.exe' : this.ensoPath
      const cmdArgs = this.ensoPath.endsWith('.bat') ? ['/c', this.ensoPath, ...args] : args
      const process = childProcess.spawn(cmd, cmdArgs)

      let stdout = ''
      let stderr = ''

      process.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      process.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      process.on('error', (error) => {
        reject(new Error(`Failed to spawn enso process: ${error.message}`))
      })

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`Enso process exited with code ${code}. stderr: ${stderr}`))
        }
      })
    })
  }

  /** Finds an available port starting from the given port number. */
  private async findServerPorts(startPort: number): Promise<[number, number]> {
    return new Promise((resolve, reject) => {
      portfinder.getPorts(2, { port: startPort }, (err, ports) => {
        if (err) {
          reject(new Error(`Failed to find ports: ${err}`))
        }
        if (ports.length < 2) {
          reject(new Error(`Failed to find all ports: ${ports}`))
        }
        resolve(ports as [number, number])
      })
    })
  }
}

function checkExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
  } catch {
    throw new Error(`Enso executable at ${filePath} is not executable`)
  }
  return Path(filePath)
}

const ensoExecutables = (() => {
  switch (os.platform()) {
    case 'win32': {
      return ['enso.exe', 'enso.bat']
    }
    case 'darwin':
    case 'linux':
    default: {
      return ['enso']
    }
  }
})()

function checkExecutables(...segments: readonly string[]): Path | undefined {
  if (!segments.includes('*')) {
    for (const ensoExecutable of ensoExecutables) {
      const ensoPath = path.join(...segments, ensoExecutable)
      try {
        fs.accessSync(ensoPath)
        return checkExecutable(ensoPath)
      } catch {
        // File doesn't exist, continue searching
      }
    }
    return
  }
  const literalSegments: string[] = []
  let i = -1
  for (const segment of segments) {
    i += 1
    if (segment === '*') {
      const basePath = path.join(...literalSegments)
      try {
        for (const entry of fs.readdirSync(basePath)) {
          const result = checkExecutables(basePath, entry, ...segments.slice(i + 1))
          if (result) {
            return result
          }
        }
      } catch {
        // Directory doesn't exist, continue searching
      }
    } else {
      literalSegments.push(segment)
    }
  }
  return
}

/** Find the path to the `enso` executable. */
export function findEnsoExecutable(workDir: string = '.'): Path | undefined {
  workDir = path.resolve(workDir)

  // Check ENSO_ENGINE_PATH environment variable first
  const envPath = process.env.ENSO_ENGINE_PATH
  if (envPath) {
    try {
      fs.accessSync(envPath)
      return checkExecutable(envPath)
    } catch {
      // File doesn't exist, continue searching
    }
  }

  const executablePath = process.argv[0] ? path.dirname(process.argv[0]) : undefined
  const directories: readonly (readonly string[])[] = [
    // Check executable path
    ...(executablePath ? [[executablePath, 'resources', 'enso', 'dist', '*', 'bin']] : []),
    // Check executable path for MacOs
    ...(executablePath ? [[executablePath, '..', 'Resources', 'enso', 'dist', '*', 'bin']] : []),
    // Check enso/dist/*/bin/enso
    [workDir, 'enso', 'dist', '*', 'bin'],
    // Check built-distribution/*/enso/dist/*/bin/enso
    [workDir, 'built-distribution', '*', 'enso', 'dist', '*', 'bin'],
    // Check built-distribution/*/*/bin/enso
    [workDir, 'built-distribution', '*', '*', 'bin'],
    // Macos dist/backend/dist/*/bin nightly
    [workDir, 'dist', 'backend', 'dist', '*', 'bin'],
  ]

  for (const directory of directories) {
    const result = checkExecutables(...directory)
    if (result) {
      return result
    }
  }
}

/**
 * Bundled engine's `lib/Standard` directory, derived from the engine binary's location.
 * `undefined` when the binary cannot be located or the derived directory does not exist.
 */
export function findStdlibRoot(workDir: string = '.'): Path | undefined {
  const ensoPath = findEnsoExecutable(workDir)
  if (!ensoPath) return undefined
  const engineRoot = path.dirname(path.dirname(ensoPath))
  const stdlib = path.join(engineRoot, 'lib', 'Standard')
  try {
    fs.accessSync(stdlib)
  } catch {
    return undefined
  }
  return Path(stdlib)
}
