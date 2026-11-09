/** @file Project Manager Shim bindings. */

import { app, net, utilityProcess } from 'electron'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as url from 'node:url'

import type { Electron } from '@/electron'
import {
  AfterFirstOpen,
  appImageEngine,
  isEngineCopyPath,
  isJvmDefaultEngine,
  jvmAotRootDirectory,
} from '@/jvmAotSettings'
import * as paths from '@/paths'
import { lazyKeyringEntries, SECRETS_KEY_VARIABLE, SecretsKeySource } from '@/secretsKey'
import { UtilityProcessYdocHost, type YdocHostChild } from '@/ydocHost/client'
import { findEnsoExecutable, getProjectRoot } from 'project-manager-shim'
import { JvmAotCache } from 'project-manager-shim/jvmAot'
import { LocalMetadata } from 'project-manager-shim/localMetadata'
import { defaultSecretsFilePath, encodeKey, LocalSecrets } from 'project-manager-shim/localSecrets'
import { LocalVersioning, VersioningConsent } from 'project-manager-shim/localVersioning'
import {
  loopbackOrigins,
  ProjectService,
  ydocHostKind,
  type EngineSettings,
} from 'project-manager-shim/projectService'

let projectService: ProjectService | null = null
/** Where the engine mode may come from besides a project's `package.yaml`. */
let engineSettings: EngineSettings | undefined
let localMetadata: LocalMetadata | null = null
let localVersioning: LocalVersioning | null = null
let localSecrets: LocalSecrets | null = null
let secretsKeySource: SecretsKeySource | null = null
let extraArgs: readonly string[] = []
let jvmAotCache: JvmAotCache | null = null
let ydocHost: UtilityProcessYdocHost | null = null

/**
 * Fork the ydoc server's utility process (`ydocHost/main.ts`, bundled as `ydocHost.mjs` beside
 * `index.mjs`). Its output goes through this process's console, so it reaches the IDE's log file.
 */
function forkYdocHost(): YdocHostChild {
  const child = utilityProcess.fork(path.join(import.meta.dirname, 'ydocHost.mjs'), [], {
    serviceName: 'Enso ydoc server',
    stdio: 'pipe',
  })
  // The `error` listeners keep a failed pipe from becoming an unhandled error in this process; the
  // child's own `error` and `exit` are handled by `UtilityProcessYdocHost`.
  const forward = (input: NodeJS.ReadableStream | null, write: (line: string) => void) => {
    if (!input) return
    input.on('error', (error) => console.error('The ydoc host output failed:', error))
    readline
      .createInterface({ input })
      .on('line', write)
      .on('error', (error) => console.error('The ydoc host output failed:', error))
  }
  forward(child.stdout, (line) => console.log(line))
  forward(child.stderr, (line) => console.error(line))
  return child
}

/**
 * Where opened projects' ydoc servers run under `ENSO_YDOC_HOST=node` (the default): a utility
 * process, forked at start-up by `setupProjectService` (`start()`).
 */
function getYdocHost(): UtilityProcessYdocHost {
  ydocHost ??= new UtilityProcessYdocHost(forkYdocHost)
  return ydocHost
}

/**
 * Let the window, loaded from `https://localhost:<port>`, open the ydoc listeners' sockets; any
 * other browser origin is refused (#596).
 */
export function allowYdocOrigin(port: number): void {
  getYdocHost().allowOrigins(loopbackOrigins('https:', port))
}

/** Stop the ydoc server's utility process, if it was started. */
export function disposeYdocHost(): void {
  ydocHost?.dispose()
}

/** The engine settings, with the ydoc host. */
function engineSettingsWithHost(): EngineSettings {
  return { ...engineSettings, ydocHost: getYdocHost() }
}

/** The local labels and Recent store, kept in Electron's `userData` directory. */
export function getLocalMetadata(): LocalMetadata {
  localMetadata ??= new LocalMetadata({ userDataDirectory: app.getPath('userData') })
  return localMetadata
}

/** The git-based versioning of local projects; the repositories it may use are kept in `userData`. */
export function getLocalVersioning(): LocalVersioning {
  localVersioning ??= new LocalVersioning({
    consent: new VersioningConsent({ userDataDirectory: app.getPath('userData') }),
  })
  return localVersioning
}

/** The encrypted local secrets file (`~/.enso/secrets.json`, or `ENSO_SECRETS_FILE`). */
export function getLocalSecrets(): LocalSecrets {
  localSecrets ??= new LocalSecrets({
    filePath: defaultSecretsFilePath(process.env, os.homedir()),
    getKey: () => getSecretsKeySource().current(),
    isKeyUnavailable: () => getSecretsKeySource().keychainUnavailable,
  })
  return localSecrets
}

/**
 * The master key: `ENSO_SECRETS_KEY`, or the keychain item service `Enso`, account `secrets-key`.
 *
 * Use the plain `new Entry(service, account)`, never `Entry.withTarget`: in `@napi-rs/keyring` 2.1.2
 * merely constructing a `withTarget` entry wipes an existing Windows credential. On Linux the store
 * is pinned to the Secret Service, because the default silently falls back to the kernel keyring,
 * which the engine's reader cannot see.
 *
 * The native module is imported on first use, so one that cannot load leaves the app without a key
 * instead of stopping it from starting. esbuild still bundles it: a dynamic `import()` of a bundled
 * module is inlined, and its `.node` binary is copied (`loader` in `esbuildConfig.ts`).
 */
export function getSecretsKeySource(): SecretsKeySource {
  secretsKeySource ??= new SecretsKeySource({
    env: process.env,
    entry: lazyKeyringEntries(async () => {
      const { Entry } = await import('@napi-rs/keyring')
      return (account) => new Entry('Enso', account, { linux: { store: 'secret-service' } })
    }),
    fileKeyId: () => getLocalSecrets().fileKeyId(),
    fileHasSecrets: async () => (await getLocalSecrets().list()).length > 0,
  })
  return secretsKeySource
}

/**
 * Whether any engine (an opened project, or a `--run`) is running. Rotating or resetting the
 * secrets key needs none: each engine holds the key it was started with.
 */
export async function hasRunningProjects(): Promise<boolean> {
  return projectService == null ? false : projectService.hasRunningProjects()
}

/** The master key for an engine's environment, when there is one. */
function secretsKeyEnvironment(): readonly (readonly [string, string])[] {
  const key = getSecretsKeySource().current()
  return key ? [[SECRETS_KEY_VARIABLE, encodeKey(key)]] : []
}

/** Get the project service. */
function getProjectService(electron: Electron | undefined, electronIsDev: boolean): ProjectService {
  if (!projectService) {
    projectService = ProjectService.default(
      paths.resourcesPath(electron, electronIsDev),
      extraArgs,
      getLocalMetadata(),
      getLocalVersioning(),
      secretsKeyEnvironment,
      engineSettingsWithHost(),
    )
  }
  return projectService
}

/**
 * The per-user JDK AOT cache (`project-manager-shim/jvmAot`), under `<userData>/jvm-aot`, or
 * `ENSO_JVM_AOT_DIR` (the open-time harness points it at its own directory). `null` when the
 * engine cannot be found.
 */
function createJvmAotCache(
  electron: Electron,
  electronIsDev: boolean,
  engine: EngineSettings | undefined,
): JvmAotCache | null {
  const ensoExecutable = findEnsoExecutable(
    paths.resourcesPath(electron, electronIsDev),
    appImageEnginePath,
  )
  if (ensoExecutable == null) return null
  return new JvmAotCache({
    rootDirectory: jvmAotRootDirectory(process.env, app.getPath('userData')),
    appVersion: app.getVersion(),
    ensoExecutable,
    isJvmDefault: () => isJvmDefaultEngine(engine, process.env),
    // No spare engine starts while the cache trains (`isTraining`); once it has, one is wanted.
    onTrainingEnded: () => void projectService?.refreshSpare(),
  })
}

/**
 * Under a Linux AppImage with the JVM as the default engine, the engine is run from its copy at
 * `<userData>/engine/<version>/` (`appImageEngine`): its launcher when the copy is complete, given
 * to the project service and the AOT cache explicitly, never through the environment.
 */
let appImageEnginePath: string | undefined
/** The copy to make once the window is up, when there is no complete one. */
let appImageCopy: (() => Promise<string>) | undefined
/** Holds the copy back until the first open has been answered (or a minute without one). */
const appImageCopyGate = new AfterFirstOpen(60_000)

/**
 * Decide which engine a Linux AppImage runs (see {@link appImageEnginePath}). Called before the
 * project service and the JDK AOT cache are created, since both find the engine once.
 */
export async function prepareAppImageEngine(
  electron: Electron,
  electronIsDev: boolean,
  engine: EngineSettings | undefined,
): Promise<void> {
  const userData = app.getPath('userData')
  const inherited = process.env.ENSO_ENGINE_PATH
  if (inherited && isEngineCopyPath(inherited, userData)) {
    // Not the user's: an earlier IDE's copy, passed on by an in-app update's relaunch. Dropped so
    // that neither `findEnsoExecutable` nor the engines this process starts run it.
    console.info(`Ignoring the inherited ENSO_ENGINE_PATH ${inherited}: an IDE engine copy.`)
    Reflect.deleteProperty(process.env, 'ENSO_ENGINE_PATH')
  }
  try {
    const { enginePath, startCopy } = await appImageEngine(
      process.env,
      {
        resourcesPath: paths.resourcesPath(electron, electronIsDev),
        userData,
        version: app.getVersion(),
      },
      engine,
    )
    if (enginePath != null)
      console.info(`Running the AppImage's engine from its copy at ${enginePath}.`)
    appImageEnginePath = enginePath
    appImageCopy = startCopy
  } catch (error) {
    console.warn("Failed to check the AppImage's engine copy:", error)
  }
}

/**
 * Make the AppImage's engine copy, if one is due: called once the window is up, it waits for the
 * first open to be answered (`AfterFirstOpen`), so that the copy does not slow that open down.
 */
export function startAppImageEngineCopy(): void {
  const copy = appImageCopy
  appImageCopy = undefined
  if (copy == null) return
  appImageCopyGate.schedule(() => {
    console.info("Copying the AppImage's engine for the next launch.")
    copy().then(
      (launcher) =>
        console.info(`Copied the AppImage's engine to ${launcher}; used from the next launch.`),
      (error: unknown) => console.warn("Did not copy the AppImage's engine:", error),
    )
  })
}

/**
 * Train the JDK AOT cache in the background if it is needed (the JVM is the default engine).
 *
 * The GUI may have asked for a spare engine before this runs. `start()` counts as training from its
 * first line (`isTraining`), so the refresh right after it stops a spare started meanwhile, and the
 * one after it has settled starts one when no training followed (a cache was there, or there is no
 * cache for this engine); a training's end refreshes it too (`onTrainingEnded`).
 */
export function startJvmAotCache(): void {
  if (jvmAotCache == null) return
  jvmAotCache
    .start()
    .catch((error: unknown) => {
      console.error('Failed to start the JDK AOT cache:', error)
    })
    .finally(() => void projectService?.refreshSpare())
  void projectService?.refreshSpare()
}

/** Stop a running AOT training. */
export async function disposeJvmAotCache(): Promise<void> {
  await jvmAotCache?.dispose()
}

/** How long a quit, or an update's install, waits for the spare engine to exit before killing it. */
export const SPARE_QUIT_WAIT_MS = 5000

/**
 * Stop the spare engine for good (quit), and wait for it to exit: it exits by itself once its stdin
 * closes, or is killed with its children after {@link SPARE_QUIT_WAIT_MS}.
 */
export async function stopSpareEngine(): Promise<void> {
  await projectService?.stopSpareEngine({ waitMs: SPARE_QUIT_WAIT_MS })
}

/** Whether a spare engine runs, or a stopped one has not exited yet. */
export function spareEngineAlive(): boolean {
  return projectService?.spareEngineAlive() ?? false
}

/** Start or replace the spare engine for the current settings (a new secrets key). */
export async function refreshSpareEngine(): Promise<void> {
  await projectService?.refreshSpare()
}

/** Setup the project service.*/
export function setupProjectService(
  args: readonly string[],
  electron: Electron,
  electronIsDev: boolean,
  engine?: EngineSettings,
): ProjectService {
  extraArgs = args
  jvmAotCache ??= createJvmAotCache(electron, electronIsDev, engine)
  engineSettings = {
    ...engine,
    jvmAot: jvmAotCache ?? undefined,
    ensoExecutable: appImageEnginePath,
    openObserver: appImageCopyGate,
  }
  if (!projectService) {
    projectService = ProjectService.default(
      paths.resourcesPath(electron, electronIsDev),
      args,
      getLocalMetadata(),
      getLocalVersioning(),
      secretsKeyEnvironment,
      engineSettingsWithHost(),
    )
  }
  // The ydoc host's start is not left to the first open, whose engine would wait for it.
  if (ydocHostKind() === 'node') getYdocHost().start()
  return projectService
}

/** Get the Project Manager version. */
export async function version(
  electron: Electron | undefined,
  electronIsDev: boolean,
): Promise<string> {
  return await getProjectService(electron, electronIsDev).version()
}

/**
 * Handle requests to the `enso://` protocol.
 *
 * The protocol is used to fetch project assets from the backend.
 * If a given path is not inside a project, the request is rejected with a 403 error.
 */
export async function handleProjectProtocol(absolutePath: string): Promise<Response> {
  if (getProjectRoot(absolutePath) == null) {
    console.error(`The given path is not inside a project: ${absolutePath}.`)
    return new Response(null, { status: 403 })
  }
  return net.fetch(url.pathToFileURL(absolutePath).toString())
}
