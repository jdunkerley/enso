/**
 * @file How each test project runs (`build_tools/build/src/enso.rs` `run_tests`): the launcher's
 * arguments and the environment, exactly as `./run` built them (the CI logs show the command lines).
 */
import path from 'node:path'
import type { Suite } from './suites.ts'

/** The heap-dump flag: in `JAVA_TOOL_OPTIONS` always, and a launcher argument except on Windows. */
export const HEAP_DUMP = '-XX:+HeapDumpOnOutOfMemoryError'

/** The launcher arguments before `--no-ir-caches --run` (`extra_engine_runner_args`). */
export function runnerArguments(
  suite: Suite,
  platform: NodeJS.Platform,
  smallJdk: string,
  graalEdition: string | undefined,
): string[] {
  const args =
    suite.runnerArgs != null ? [...suite.runnerArgs]
    : platform === 'win32' ? []
    : [HEAP_DUMP]
  if (suite.smallJdk && graalEdition !== 'Oracle GraalVM') args.push('--jvm', smallJdk)
  return args
}

/** The launcher's arguments for one project. `_Internal_` projects may use private methods. */
export function projectArguments(runnerArgs: readonly string[], projectDir: string): string[] {
  const args = [...runnerArgs, '--no-ir-caches', '--run', projectDir]
  if (projectDir.includes('_Internal_')) args.push('--disable-private-check')
  return args
}

/** What {@link testEnvironment} needs. */
export interface TestEnvironmentInputs {
  readonly base: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  readonly enginePackage: string
  readonly nativeRunner: boolean
  readonly runnerArgs: readonly string[]
  readonly junitDir: string
  readonly httpbinUrl: string | null
}

/** The database variables a CI job sets per matrix entry; an empty one means "no such database". */
export const SERVICE_VARIABLES = [
  'ENSO_POSTGRES_DATABASE',
  'ENSO_POSTGRES_HOST',
  'ENSO_POSTGRES_USER',
  'ENSO_POSTGRES_PASSWORD',
  'ENSO_SQLSERVER_DATABASE',
  'ENSO_SQLSERVER_HOST',
  'ENSO_SQLSERVER_PORT',
  'ENSO_SQLSERVER_USER',
  'ENSO_SQLSERVER_PASSWORD',
] as const

/**
 * The tests' environment. On top of `base`: `./run`'s variables (`JAVA_TOOL_OPTIONS` is set, not
 * appended to), and without the service variables that are empty. Enso's `Environment.get` reads
 * an empty variable as `""`, not `Nothing`, which would turn a skipped database group into a
 * failing one.
 */
export function testEnvironment(inputs: TestEnvironmentInputs): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(inputs.base)) {
    if (value != null) env[name] = value
  }
  for (const name of SERVICE_VARIABLES) {
    if (env[name] === '') delete env[name]
  }
  const launcher =
    inputs.platform === 'win32' ?
      inputs.nativeRunner ?
        'enso.exe'
      : 'enso.bat'
    : 'enso'
  Object.assign(env, {
    JAVA_TOOL_OPTIONS: `-enableassertions ${HEAP_DUMP}`,
    ENSO_META_TEST_COMMAND: path.join(inputs.enginePackage, 'bin', launcher),
    ENSO_META_TEST_ARGS: ['--no-ir-caches', ...inputs.runnerArgs, '--run'].join(' '),
    ENSO_ENABLE_ASSERTIONS: 'true',
    ENSO_TEST_ANSI_COLORS: 'true',
    ENSO_TEST_JUNIT_DIR: inputs.junitDir,
  })
  if (inputs.httpbinUrl != null) env.ENSO_HTTP_TEST_HTTPBIN_URL = inputs.httpbinUrl
  if (inputs.platform === 'win32') {
    env.CI_TEST_TIMEFACTOR = '2'
    env.CI_TEST_FLAKY_ENABLE = 'true'
  }
  return env
}

/**
 * Warnings for a Linux run that `./run` would have given a database and that has none: the
 * database groups would be skipped silently, and the job would stay green.
 */
export function missingServiceWarnings(
  projects: readonly string[],
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  if (platform !== 'linux') return []
  const warnings: string[] = []
  if (projects.includes('Table_Tests') && (env.ENSO_POSTGRES_DATABASE ?? '') === '') {
    warnings.push('Table_Tests runs without a Postgres database (ENSO_POSTGRES_* is not set).')
  }
  if (projects.includes('Microsoft_Tests') && (env.ENSO_SQLSERVER_DATABASE ?? '') === '') {
    warnings.push(
      'Microsoft_Tests runs without a SQL Server database (ENSO_SQLSERVER_* is not set).',
    )
  }
  return warnings
}

/** Where the global IR cache lives (`paths.rs` `cache_directory`). */
export function irCacheDirectory(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const custom = env.ENSO_DATA_DIRECTORY ?? ''
  if (custom !== '') return path.join(custom, 'cache')
  if (platform === 'win32')
    return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'enso', 'cache')
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'org.enso', 'cache')
  const data = env.XDG_DATA_HOME ?? ''
  return path.join(data !== '' ? data : path.join(home, '.local', 'share'), 'enso', 'cache')
}
