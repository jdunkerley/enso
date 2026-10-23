/**
 * @file The standard-library test suites: `./run backend test <suite>` (`build_tools/cli/src/lib.rs`,
 * `engine.rs` `StandardLibraryTestsSelection`), with the same names, so the workflows' matrices do
 * not change.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** One suite. */
export interface Suite {
  /** Run only these projects (by directory name)... */
  readonly allow?: readonly string[]
  /** ...or every project but these. */
  readonly deny?: readonly string[]
  /** Run on the small JDK (`--jvm <repo>/target/small-jdk`), unless the edition is Oracle GraalVM. */
  readonly smallJdk: boolean
  /** Runner arguments that replace the heap-dump flag (`extra_engine_runner_args`). */
  readonly runnerArgs?: readonly string[]
  /** Whether `ENSO_META_TEST_COMMAND` names the native launcher (`enso.exe`, not `enso.bat`). */
  readonly nativeRunner: boolean
}

const NOT_SEPARATE = ['Microsoft_Tests', 'AWS_Tests']

/** The suites `./run backend test` knew. */
export const SUITES: Readonly<Record<string, Suite>> = {
  'standard-library': { deny: NOT_SEPARATE, smallJdk: true, nativeRunner: true },
  'standard-library-in-native': { deny: NOT_SEPARATE, smallJdk: false, nativeRunner: true },
  'std-aws': { allow: ['AWS_Tests'], smallJdk: false, nativeRunner: true },
  'std-microsoft': { allow: ['Microsoft_Tests'], smallJdk: false, nativeRunner: true },
  'std-snowflake': { allow: ['Snowflake_Tests'], smallJdk: false, nativeRunner: false },
  'std-snowflake-jvm': {
    allow: ['Snowflake_Tests'],
    smallJdk: false,
    runnerArgs: ['--jvm'],
    nativeRunner: false,
  },
  'std-cloud-related': {
    allow: [
      'Base_Tests',
      'Base_Internal_Tests',
      'Table_Tests',
      'AWS_Tests',
      'Image_Tests',
      'Microsoft_Tests',
    ],
    smallJdk: false,
    nativeRunner: true,
  },
  'std-mock-dual-microsoft': {
    allow: ['Microsoft_Tests'],
    smallJdk: false,
    runnerArgs: ['--jvm', '--vm.D=polyglot.enso.classLoading=Standard.Microsoft:guest,hosted'],
    nativeRunner: false,
  },
}

/** `./run`'s aliases. */
const ALIASES: Readonly<Record<string, string>> = {
  stdlib: 'standard-library',
  'stdlib-native': 'standard-library-in-native',
}

/** The suite called `name` (or an alias of it), with its canonical name. */
export function suiteNamed(name: string): { readonly name: string; readonly suite: Suite } {
  const canonical = ALIASES[name] ?? name
  const suite = SUITES[canonical]
  if (suite == null) {
    throw new Error(`Unknown suite ${name}; expected one of ${Object.keys(SUITES).join(', ')}.`)
  }
  return { name: canonical, suite }
}

/** The test projects under `testDir`: directories `*_Tests` with a `package.yaml`, sorted. */
export function discoverProjects(testDir: string): string[] {
  return readdirSync(testDir)
    .filter(
      (name) => name.endsWith('_Tests') && existsSync(path.join(testDir, name, 'package.yaml')),
    )
    .sort()
}

/** Whether `suite` runs `project`. */
export function selects(suite: Suite, project: string): boolean {
  if (suite.allow != null) return suite.allow.includes(project)
  return !(suite.deny ?? []).includes(project)
}

/** `--only`'s value: project names separated by commas, each trimmed (`A_Tests, B_Tests`). */
export function parseOnly(value: string): string[] {
  return value.split(',').map((name) => name.trim())
}

/**
 * The names in `only` that `suite` does not run among `projects`: a typo, an empty name, or a
 * project of another suite. `selectProjects` would drop them silently.
 */
export function unselectedNames(
  projects: readonly string[],
  suite: Suite,
  only: readonly string[],
): string[] {
  return only.filter((name) => !(projects.includes(name) && selects(suite, name)))
}

/** The projects `suite` runs, optionally narrowed to `only`. */
export function selectProjects(
  projects: readonly string[],
  suite: Suite,
  only?: readonly string[],
): string[] {
  return projects.filter(
    (project) => selects(suite, project) && (only == null || only.includes(project)),
  )
}

/**
 * The AWS suite without credentials: `./run` warned and succeeded, before starting any service. Only
 * the dedicated suite (exactly `AWS_Tests`) is skipped this way.
 */
export function skipsForMissingAwsCredentials(
  suite: Suite,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const awsOnly = suite.allow?.length === 1 && suite.allow[0] === 'AWS_Tests'
  const has = (name: string) => (env[name] ?? '') !== ''
  return (
    awsOnly && !(has('ENSO_LIB_S3_AWS_ACCESS_KEY_ID') && has('ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY'))
  )
}
