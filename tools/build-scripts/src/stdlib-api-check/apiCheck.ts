/**
 * @file `stdlib-api-check`: a port of `RunContext::stdlib_api_check` (`build_tools/build/src/engine/
 * context.rs`). For each standard library with a `docs/api` directory, the built engine regenerates
 * the API docs in the engine package (`enso --docs api --in-project <lib>`), and `git diff
 * --no-index` compares them with the committed ones. The first library that differs fails the
 * check, with `./run`'s messages.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** The version directory of every library in the source tree. */
export const SOURCE_VERSION = '0.0.0-dev'

/**
 * The libraries under `stdlibRoot` (`distribution/lib/Standard`) that have a committed API, sorted.
 * A library without a `0.0.0-dev` directory is an error, as in `./run`.
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

/** `./run`'s report for a library whose API changed. Paths are relative to the repository. */
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
  /** `git diff --no-index <old> <new> --exit-code --no-ext-diff`: its status and stdout. */
  readonly diff: (
    oldDir: string,
    newDir: string,
  ) => { readonly status: number; readonly stdout: string }
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
    const diff = context.diff(oldApiDir, path.join(builtDir, 'docs', 'api'))
    if (diff.status !== 0) {
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
