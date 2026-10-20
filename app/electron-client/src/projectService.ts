/** @file Project Manager Shim bindings. */

import { app, net } from 'electron'
import * as os from 'node:os'
import * as url from 'node:url'

import type { Electron } from '@/electron'
import * as paths from '@/paths'
import { lazyKeyringEntries, SECRETS_KEY_VARIABLE, SecretsKeySource } from '@/secretsKey'
import { getProjectRoot } from 'project-manager-shim'
import { LocalMetadata } from 'project-manager-shim/localMetadata'
import { defaultSecretsFilePath, encodeKey, LocalSecrets } from 'project-manager-shim/localSecrets'
import { LocalVersioning, VersioningConsent } from 'project-manager-shim/localVersioning'
import { ProjectService } from 'project-manager-shim/projectService'

let projectService: ProjectService | null = null
let localMetadata: LocalMetadata | null = null
let localVersioning: LocalVersioning | null = null
let localSecrets: LocalSecrets | null = null
let secretsKeySource: SecretsKeySource | null = null
let extraArgs: readonly string[] = []

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
    )
  }
  return projectService
}

/** Setup the project service.*/
export function setupProjectService(
  args: readonly string[],
  electron: Electron,
  electronIsDev: boolean,
): ProjectService {
  extraArgs = args
  if (!projectService) {
    projectService = ProjectService.default(
      paths.resourcesPath(electron, electronIsDev),
      args,
      getLocalMetadata(),
      getLocalVersioning(),
      secretsKeyEnvironment,
    )
  }
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
