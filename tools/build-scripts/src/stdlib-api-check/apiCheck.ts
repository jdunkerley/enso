/**
 * @file `stdlib-api-check`: a port of `RunContext::stdlib_api_check`
 * (the retired build CLI's `context.rs`). For each standard library with a `docs/api`
 * directory, the built engine regenerates the API docs in the engine package (`enso --docs api
 * --in-project <lib>`), and `git diff --no-index` compares them with the committed ones. The first
 * library that differs fails the check, with the retired build CLI's messages.
 *
 * One deliberate difference: the retired build CLI read any non-zero `git diff` status as "the API
 * changed". Here only status 1 is; any other (128 for a bad path, -1 when git cannot start) is an
 * error that carries git's stderr, rather than an "API changed" report with an empty diff.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** The version directory of every library in the source tree. */
export const SOURCE_VERSION = '0.0.0-dev'

/**
 * The libraries under `stdlibRoot` (`distribution/lib/Standard`) that have a committed API, sorted.
 * A library without a `0.0.0-dev` directory is an error, as in the retired build CLI.
 */
export function librariesWithApi(stdlibRoot: string): string[] {
  const libraries: string[] = []
  for (const name of readdirSync(stdlibRoot).sort()) {
    const dir = path.join(stdlibRoot, name)
    if (!statSync(dir).isDirectory()) continue
    const versionDir = path.join(dir, SOURCE_VERSION)
    if (!existsSync(versionDir)) throw new Error(`Directory ${versionDir} does not exist`)
    if (existsSync(path.join(versionDir, 'docs', 'api'))) libraries.push(name)
  }
  return libraries
}

/**
 * The retired build CLI's report for a library whose API changed. Paths are relative to the
 * repository.
 */
export function failureLines(
  library: string,
  diff: string,
  oldApiDir: string,
  librarySourceDir: string,
): string[] {
  return [
    `API check failed for library Standard.${library}`,
    `Current API vs Old API: ${diff}`,
    `If you wish to overwrite the current API in the directory ${oldApiDir}, run the following command
                       sbt "runEngineDistribution --no-ir-caches --docs=api --in-project ${librarySourceDir}"
                       and commit the modified files`,
  ]
}

/** What the check needs from the outside world. */
export interface ApiCheckContext {
  readonly repoRoot: string
  /** The engine package directory and the version its libraries are installed at. */
  readonly enginePackage: { readonly dir: string; readonly version: string }
  readonly enso: string
  /** Runs `enso` with the given arguments, output inherited; returns the exit status. */
  readonly runEnso: (args: readonly string[]) => number
  /**
   * `git diff --no-index <old> <new> --exit-code --no-ext-diff`: its status (0 same, 1 different,
   * anything else a failure; -1 when it cannot start), stdout and stderr.
   */
  readonly diff: (
    oldDir: string,
    newDir: string,
  ) => { readonly status: number; readonly stdout: string; readonly stderr: string }
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

/** Runs the check; returns whether every library's API is unchanged. */
export function runApiCheck(context: ApiCheckContext): boolean {
  const stdlibRoot = path.join(context.repoRoot, 'distribution', 'lib', 'Standard')
  const relative = (target: string) => path.relative(context.repoRoot, target)
  const libraries = librariesWithApi(stdlibRoot)
  context.log(`Checking API for standard libraries: ${libraries.join(', ')}`)
  for (const library of libraries) {
    const sourceDir = path.join(stdlibRoot, library, SOURCE_VERSION)
    const oldApiDir = path.join(sourceDir, 'docs', 'api')
    const builtDir = path.join(
      context.enginePackage.dir,
      'lib',
      'Standard',
      library,
      context.enginePackage.version,
    )
    const status = context.runEnso(['--docs', 'api', '--in-project', builtDir])
    if (status !== 0) {
      throw new Error(
        `\`${context.enso} --docs api --in-project ${builtDir}\` exited with ${status}.`,
      )
    }
    const newApiDir = path.join(builtDir, 'docs', 'api')
    const diff = context.diff(oldApiDir, newApiDir)
    if (diff.status !== 0 && diff.status !== 1) {
      throw new Error(
        `\`git diff --no-index ${oldApiDir} ${newApiDir}\` exited with ${diff.status}: ${diff.stderr.trim()}`,
      )
    }
    if (diff.status === 1) {
      for (const line of failureLines(
        library,
        diff.stdout,
        relative(oldApiDir),
        relative(sourceDir),
      )) {
        context.error(line)
      }
      context.error(`Error: API check failed for library Standard.${library}`)
      return false
    }
  }
  return true
}
