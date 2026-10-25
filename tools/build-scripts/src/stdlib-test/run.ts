/**
 * @file `stdlib-test`: runs a standard-library test suite against a built engine package, as the
 * retired build CLI's `backend test <suite>` did (the retired build CLI's `enso.rs` `run_tests`):
 * each selected `test/*_Tests` project in turn with `enso --no-ir-caches --run`, every one even
 * after a failure, then one `::error` naming the failures. The caller provides the engine package
 * (the build job's download), the small JDK for the JVM suite, and the databases (service
 * containers in CI); the runner starts the HTTP test helper itself.
 */
import path from 'node:path'
import { ensoBinary } from '../lib/engine.ts'
import type { Httpbin } from './httpbin.ts'
import {
  irCacheDirectory,
  missingServiceWarnings,
  projectArguments,
  runnerArguments,
  testEnvironment,
} from './invocation.ts'
import { readJUnitDir, summaryMarkdown } from './junit.ts'
import {
  discoverProjects,
  selectProjects,
  skipsForMissingAwsCredentials,
  suiteNamed,
  unselectedNames,
} from './suites.ts'

/**
 * The cloud credentials with which the retired build CLI logged in to Enso Cloud
 * (`cloud_tests/env.rs`).
 */
export const CLOUD_VARIABLES = [
  'ENSO_CLOUD_TEST_ACCOUNT_USERNAME',
  'ENSO_CLOUD_TEST_ACCOUNT_PASSWORD',
  'ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID',
  'ENSO_CLOUD_COGNITO_USER_POOL_ID',
  'ENSO_CLOUD_COGNITO_REGION',
] as const

/** What the caller asks for. */
export interface StdlibTestOptions {
  readonly suite: string
  /** Run only these of the suite's projects (a local convenience). */
  readonly only?: readonly string[]
  /** In GitHub Actions, delete the global IR cache and `bench-report.xml` files first. */
  readonly clean: boolean
  /** Print what would run, and run nothing. */
  readonly dryRun: boolean
}

/** What the runner needs from the outside world; tests fake all of it. */
export interface StdlibTestContext {
  readonly repoRoot: string
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly enginePackage: { readonly dir: string; readonly version: string }
  readonly exists: (file: string) => boolean
  readonly startHttpbin: () => Promise<Httpbin>
  /** Runs one project; returns its exit status. */
  readonly runProject: (
    file: string,
    args: readonly string[],
    env: Record<string, string>,
  ) => number
  readonly remove: (target: string) => void
  readonly benchReports: () => string[]
  readonly resetDir: (dir: string) => void
  readonly appendSummary: (lines: readonly string[]) => void
  readonly log: (line: string) => void
}

/** Runs the suite; returns the exit status for the process. */
export async function runStdlibTests(
  options: StdlibTestOptions,
  context: StdlibTestContext,
): Promise<number> {
  const { name, suite } = suiteNamed(options.suite)
  const testDir = path.join(context.repoRoot, 'test')
  if (options.only != null) {
    const unselected = unselectedNames(discoverProjects(testDir), suite, options.only)
    if (unselected.length > 0) {
      const names = unselected.map((entry) => JSON.stringify(entry)).join(', ')
      throw new Error(`--only names projects that suite ${name} does not run: ${names}.`)
    }
  }
  const env = context.env
  if (CLOUD_VARIABLES.every((variable) => (env[variable] ?? '') !== '')) {
    throw new Error(
      'Enso Cloud test credentials are set, but stdlib-test cannot sign in to Enso Cloud: unset ' +
        `${CLOUD_VARIABLES.join(', ')} to run the cloud suites without the real cloud.`,
    )
  }
  if (skipsForMissingAwsCredentials(suite, env)) {
    context.log(
      'Skipping the AWS standard library tests: no AWS credentials found in the environment ' +
        '(ENSO_LIB_S3_AWS_ACCESS_KEY_ID / ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY).',
    )
    return 0
  }
  const projects = selectProjects(discoverProjects(testDir), suite, options.only)
  if (projects.length === 0) throw new Error(`Suite ${name} selects no test project.`)
  const smallJdk = path.join(context.repoRoot, 'target', 'small-jdk')
  const runnerArgs = runnerArguments(suite, context.platform, smallJdk, env.GRAAL_EDITION)
  if (runnerArgs.includes(smallJdk) && !context.exists(smallJdk)) {
    throw new Error(
      `Suite ${name} runs on the small JDK, and ${smallJdk} does not exist. Build it with ` +
        `sbt "buildSmallJdkForRelease ${smallJdk}".`,
    )
  }
  const junitDir = path.resolve(
    (env.ENSO_TEST_JUNIT_DIR ?? '') !== '' ?
      (env.ENSO_TEST_JUNIT_DIR as string)
    : path.join(context.repoRoot, 'target', 'test-results'),
  )
  const enso = ensoBinary(context.enginePackage.dir, context.platform)
  context.log(`Suite ${name}: ${projects.join(', ')}`)
  for (const warning of missingServiceWarnings(projects, context.platform, env)) {
    context.log(`::warning::${warning}`)
  }
  if (options.dryRun) {
    for (const project of projects) {
      context.log(`${enso} ${projectArguments(runnerArgs, path.join(testDir, project)).join(' ')}`)
    }
    return 0
  }
  if (options.clean && env.GITHUB_ACTIONS === 'true') {
    context.remove(irCacheDirectory(context.platform, env, context.home))
    for (const report of context.benchReports()) context.remove(report)
  }
  context.resetDir(junitDir)
  const given = env.ENSO_HTTP_TEST_HTTPBIN_URL ?? ''
  const httpbin: Httpbin =
    given !== '' ? { url: given, stop: () => {} } : await context.startHttpbin()
  const failures: string[] = []
  try {
    const testEnv = testEnvironment({
      base: env,
      platform: context.platform,
      enginePackage: context.enginePackage.dir,
      nativeRunner: suite.nativeRunner,
      runnerArgs,
      junitDir,
      httpbinUrl: httpbin.url,
    })
    for (const project of projects) {
      const status = context.runProject(
        enso,
        projectArguments(runnerArgs, path.join(testDir, project)),
        testEnv,
      )
      if (status !== 0) failures.push(`${project}: the test run exited with status ${status}`)
    }
  } finally {
    httpbin.stop()
  }
  context.appendSummary(summaryMarkdown(readJUnitDir(junitDir)))
  if (failures.length > 0) {
    context.log(
      `::error title=Failed Standard Library Tests::${failures.length} test suite(s) failed: ${failures.join(';%0A')}`,
    )
    return 1
  }
  return 0
}
