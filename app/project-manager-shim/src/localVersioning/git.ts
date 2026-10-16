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

/** The git executable, or `null` when git is not installed. Found once and cached. */
export function findGit(): Promise<string | null> {
  gitLookup ??= runCommand('git', ['--version']).then(
    () => 'git',
    () => null,
  )
  return gitLookup
}

/** For tests: forget the cached result. */
export function resetGitCache(): void {
  gitLookup = undefined
}

/** The tail of the work queued for each queue key; entries are removed once the queue drains. */
const queues = new Map<string, Promise<unknown>>()

/**
 * Run git in `cwd` after every earlier call queued for the same `queueKey` (a repository root)
 * has finished. Adds `GIT_TERMINAL_PROMPT=0` and `-c core.quotepath=false`. The queue key defaults
 * to `cwd`. Git runs without a shell. Returns stdout unchanged.
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
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options?.env },
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
