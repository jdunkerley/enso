import * as path from 'node:path'
import { CommandError, runCommand } from '../childProcess/runCommand.js'

/** Git is not installed (or cannot be run). */
export class GitUnavailableError extends Error {
  /** Create the error. */
  constructor() {
    super('Git is not installed')
    this.name = 'GitUnavailableError'
  }
}

/** The identity commits are made with when the user has none configured. Never written to config. */
const FALLBACK_IDENTITY: readonly string[] = [
  '-c',
  'user.name=Enso',
  '-c',
  'user.email=noreply@enso.org',
]

let gitLookup: Promise<string | null> | undefined

/**
 * The git executable, or `null` when git is not installed. Only a git that was found is cached: a
 * failed lookup is tried again next time, so installing git needs no restart of the IDE.
 */
export function findGit(): Promise<string | null> {
  if (gitLookup == null) {
    const lookup = runCommand('git', ['--version']).then(
      () => 'git',
      () => null,
    )
    gitLookup = lookup
    void lookup.then((git) => {
      if (git == null && gitLookup === lookup) gitLookup = undefined
    })
  }
  return gitLookup
}

/** For tests: forget the cached result. */
export function resetGitCache(): void {
  gitLookup = undefined
}

/**
 * Inherited variables that would point git at another repository, index or object store (set, for
 * example, when the IDE is started from a git hook or an editor's terminal). They are never passed
 * on; a caller that needs one (`exportAt`'s `GIT_INDEX_FILE`) passes it in `options.env`.
 */
const REPOSITORY_VARIABLES: readonly string[] = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

/** `process.env` without {@link REPOSITORY_VARIABLES}. */
function inheritedEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of REPOSITORY_VARIABLES) delete env[name]
  return env
}

/** The tail of the work queued for each queue key; entries are removed once the queue drains. */
const queues = new Map<string, Promise<unknown>>()

/**
 * Run git in `cwd` after every earlier call queued for the same `queueKey` (a repository root)
 * has finished. The queue orders single calls only; `LocalVersioning` holds its own lock
 * around each operation's sequence of calls.
 *
 * Adds `-c core.quotepath=false`, `GIT_TERMINAL_PROMPT=0` (never prompt for credentials) and
 * `GIT_OPTIONAL_LOCKS=0`, so read-only commands such as `status` never take the index lock just to
 * refresh it, racing the user's own git (commands that change the index take it regardless).
 * Inherited {@link REPOSITORY_VARIABLES} are dropped. The queue key defaults to `cwd`. Git runs
 * without a shell. Returns stdout unchanged.
 * @throws {GitUnavailableError} when git is not installed; {@link CommandError} on failure.
 */
export async function runGit(
  cwd: string,
  args: readonly string[],
  options?: {
    readonly queueKey?: string
    readonly input?: string
    /** Extra environment variables, e.g. `GIT_INDEX_FILE`. */
    readonly env?: Readonly<Record<string, string>>
  },
): Promise<string> {
  const git = await findGit()
  if (git == null) throw new GitUnavailableError()
  const key = options?.queueKey ?? cwd
  const execute = async () => {
    const { stdout } = await runCommand(git, ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env: {
        ...inheritedEnvironment(),
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        ...options?.env,
      },
      ...(options?.input != null ? { input: options.input } : {}),
    })
    return stdout
  }
  const previous = queues.get(key) ?? Promise.resolve()
  // A failure of an earlier call must not stop this one.
  const result = previous.then(execute, execute)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return result
}

/** The repository containing `dir` (its `--show-toplevel`), or `null`. */
export async function findRepoRoot(dir: string): Promise<string | null> {
  try {
    const stdout = await runGit(dir, ['rev-parse', '--show-toplevel'])
    // Git prints forward slashes on Windows.
    return path.resolve(stdout.replace(/\r?\n$/, ''))
  } catch (error) {
    if (error instanceof CommandError) return null
    throw error
  }
}

/** `-c` arguments for the fallback identity, or `[]` when the user has an identity in `repoRoot`. */
export async function identityArgs(repoRoot: string): Promise<readonly string[]> {
  try {
    await runGit(repoRoot, ['var', 'GIT_AUTHOR_IDENT'])
    return []
  } catch (error) {
    if (error instanceof CommandError) return FALLBACK_IDENTITY
    throw error
  }
}
