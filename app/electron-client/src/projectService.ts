/** @file Project Manager Shim bindings. */

import { app, net, utilityProcess } from 'electron'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as url from 'node:url'

import type { Electron } from '@/electron'
import * as paths from '@/paths'
import { lazyKeyringEntries, SECRETS_KEY_VARIABLE, SecretsKeySource } from '@/secretsKey'
import { UtilityProcessYdocHost, type YdocHostChild } from '@/ydocHost/client'
import { getProjectRoot } from 'project-manager-shim'
import { LocalMetadata } from 'project-manager-shim/localMetadata'
import { defaultSecretsFilePath, encodeKey, LocalSecrets } from 'project-manager-shim/localSecrets'
import { LocalVersioning, VersioningConsent } from 'project-manager-shim/localVersioning'
import {
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
  if (child.stdout) {
    readline.createInterface({ input: child.stdout }).on('line', (line) => console.log(line))
  }
  if (child.stderr) {
    readline.createInterface({ input: child.stderr }).on('line', (line) => console.error(line))
  }
  return child
}

/**
 * Where opened projects' ydoc servers run under `ENSO_YDOC_HOST=node` (the default): a utility
 * process, forked on the first open.
 */
function getYdocHost(): UtilityProcessYdocHost {
  ydocHost ??= new UtilityProcessYdocHost(forkYdocHost)
  return ydocHost
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

/** Setup the project service.*/
export function setupProjectService(
  args: readonly string[],
  electron: Electron,
  electronIsDev: boolean,
  engine?: EngineSettings,
): ProjectService {
  extraArgs = args
  engineSettings = engine
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
