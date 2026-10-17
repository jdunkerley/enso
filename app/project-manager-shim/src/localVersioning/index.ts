/**
 * Versioning of local projects as git commits, using the user's own git CLI.
 *
 * Every commit is scoped to the paths given, so one project's changes are never recorded with
 * another's. Each public operation holds its repository's lock (see {@link exclusive}) from its
 * first git call to its last, so concurrent operations on one repository run one after another;
 * every single git call also goes through {@link runGit}'s per-repository queue.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { CommandError } from '../childProcess/runCommand.js'
import type { VersioningConsent } from './consent.js'
import { findGit, findRepoRoot, identityArgs, repositoryKey, runGit } from './git.js'
export { VersioningConsent, type VersioningConsentOptions } from './consent.js'

/** A saved version of a project. */
export interface VersionSummary {
  readonly id: string
  /** ISO-8601, the commit's committer date. */
  readonly date: string
}

/** What is known about a project's versioning. */
export interface VersioningStatus {
  readonly git: boolean
  readonly repoRoot: string | null
  readonly changed: boolean
  readonly lastVersion: VersionSummary | null
  /** Git's message when the repository cannot be used (mid-merge, locked, …). */
  readonly blocked: string | null
  /**
   * Whether the user has agreed to have the repository versioned (see {@link VersioningConsent}).
   * `false` when git is unavailable or there is no repository.
   */
  readonly enabled: boolean
  /** The user turned versioning off for this repository (`disable`); it is enabled again only explicitly. */
  readonly optedOut: boolean
}

/** A saved version of a project, with who made it and its comment. */
export interface VersionEntry extends VersionSummary {
  readonly author: { readonly name: string; readonly email: string }
  /** The version's `refs/notes/enso` note if it has one, else its commit message. */
  readonly comment: string
  readonly isLatest: boolean
}

/** A project's old and new paths relative to their repository, with `/` separators. */
export interface MovedPaths {
  readonly from: string
  readonly to: string
}

const NOTES_REF = '--ref=enso'

/**
 * The trailer naming a moved project's previous path (relative to the repository), on every
 * rename or move commit, so the history before the move can be followed.
 */
export const MOVED_FROM_TRAILER = 'Enso-Moved-From'

/**
 * Configuration for the IDE's own commits and notes, which are automatic, path-scoped snapshots:
 * never signed (`commit.gpgsign=false`, which could prompt or fail), and never running the user's
 * hooks (`core.hooksPath` at the null device, where no hook can exist; `--no-verify` on top skips
 * `pre-commit` and `commit-msg` only, while this also skips `post-commit` and the like).
 */
const AUTOMATIC: readonly string[] = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  `core.hooksPath=${os.devNull}`,
]

/**
 * Throws unless `id` is a full commit hash (40 or 64 hex digits, as {@link LocalVersioning.log}
 * returns). Ids come from callers over HTTP, so nothing git could read as an option or a revision
 * expression (`--output=…`, `HEAD~1`) may get through. Abbreviated ids are not accepted.
 */
export function assertVersionId(id: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) throw new Error(`Invalid version id: ${id}`)
}

/** How long a caller that waits for a commit (a close, a move) waits before giving up. */
export const VERSIONING_TIMEOUT_MS = 15_000

/** The message of the error {@link withinVersioningTimeout} throws. */
export const VERSIONING_TIMEOUT_MESSAGE = 'Saving a version timed out.'

/**
 * Settle with `work`, or reject with {@link VERSIONING_TIMEOUT_MESSAGE} after
 * {@link VERSIONING_TIMEOUT_MS}. The git process behind `work` is deliberately not killed (killing
 * git mid-commit can leave an `index.lock`): it keeps running until it ends, and until then its
 * operation keeps holding the repository's lock, so later operations on that repository wait for
 * it. That is the accepted cost of never killing git.
 */
export async function withinVersioningTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(VERSIONING_TIMEOUT_MESSAGE)), VERSIONING_TIMEOUT_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Lines the root `.gitignore` must contain. */
export const ENSO_IGNORE_LINES: readonly string[] = ['**/.enso/', '*.bak']

const NO_GIT: VersioningStatus = {
  git: false,
  repoRoot: null,
  changed: false,
  lastVersion: null,
  blocked: null,
  enabled: false,
  optedOut: false,
}
const NO_REPOSITORY: VersioningStatus = { ...NO_GIT, git: true }

/** In-progress operations that make a repository unusable, with the message to show. */
const BLOCKING_STATES: readonly (readonly [string, string])[] = [
  ['MERGE_HEAD', 'The repository is in the middle of a merge.'],
  ['rebase-merge', 'The repository is in the middle of a rebase.'],
  ['rebase-apply', 'The repository is in the middle of a rebase.'],
  ['CHERRY_PICK_HEAD', 'The repository is in the middle of a cherry-pick.'],
  ['REVERT_HEAD', 'The repository is in the middle of a revert.'],
  ['BISECT_LOG', 'The repository is in the middle of a bisect.'],
]

/** The tail of the operations queued on each repository (see {@link exclusive}). */
const operations = new Map<string, Promise<unknown>>()

/**
 * Run `work` once every earlier operation on the repository at `repoRoot` has settled, so a
 * multi-call operation (a commit is several git calls, its id one more) never interleaves with
 * another. The lock is keyed by the repository's real path and shared by all
 * {@link LocalVersioning} instances; a failing operation releases it. Operations call only the
 * unlocked `…In` helpers, never a public method, so they cannot wait on themselves.
 */
async function exclusive<T>(repoRoot: string, work: () => Promise<T>): Promise<T> {
  const key = await repositoryKey(repoRoot)
  const previous = operations.get(key) ?? Promise.resolve()
  const result = previous.then(work, work)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  operations.set(key, tail)
  void tail.then(() => {
    if (operations.get(key) === tail) operations.delete(key)
  })
  return result
}

/** The repository-relative path of the `.enso` folder of the project at `relative`. */
function ensoFolder(relative: string): string {
  return relative === '.' ? '.enso' : `${relative}/.enso`
}

/**
 * `relative` as a literal pathspec. Every path from data (a project's path, a trailer's) reaches
 * git through this or {@link excludeEnso}: as a plain pathspec, `*`, `?` and `[` in a folder name
 * would be globs and could match a sibling (and `clean` would delete its files).
 */
function literal(relative: string): string {
  return `:(literal)${relative}`
}

/** A literal pathspec excluding the `.enso` folder of the project at `relative` (a version never holds it). */
function excludeEnso(relative: string): string {
  return `:(exclude,literal)${ensoFolder(relative)}`
}

/** The pathspecs of the project at `relative`, without its `.enso` folder. */
function projectPathspecs(relative: string): readonly string[] {
  return [literal(relative), excludeEnso(relative)]
}

/** `p` relative to `repoRoot` (resolving links first), with `/` separators; `.` for the root. */
async function repoRelative(repoRoot: string, p: string): Promise<string> {
  const relative = path.relative(await fs.realpath(repoRoot), await realpathOrParent(p))
  return relative === '' ? '.' : relative.split(path.sep).join('/')
}

/**
 * `fs.realpath(p)`, or, for a path that no longer exists (the old path after a move), the real path
 * of its nearest existing ancestor joined with the rest.
 */
async function realpathOrParent(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(p)
    if (parent === p) throw error
    return path.join(await realpathOrParent(parent), path.basename(p))
  }
}

/** The nearest ancestor of `p` (or `p` itself) that exists. */
async function existingAncestor(p: string): Promise<string> {
  let current = path.resolve(p)
  while (!(await exists(current))) {
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Why `repoRoot` cannot be used, or `null`. One git call resolves every state's path. */
async function blockedReason(repoRoot: string): Promise<string | null> {
  const gitPaths = (
    await runGit(
      repoRoot,
      ['rev-parse', ...BLOCKING_STATES.flatMap(([name]) => ['--git-path', name])],
      { queueKey: repoRoot },
    )
  ).split(/\r?\n/)
  for (const [i, [, message]] of BLOCKING_STATES.entries()) {
    const gitPath = gitPaths[i]
    if (gitPath && (await exists(path.resolve(repoRoot, gitPath)))) return message
  }
  return null
}

function lockMessage(error: unknown): string | null {
  return error instanceof CommandError && error.stderr.includes('index.lock') ?
      error.stderr.trim()
    : null
}

/** `message` without the {@link MOVED_FROM_TRAILER} lines at its end. */
function withoutMoveTrailer(message: string): string {
  const isTrailer = (line: string) => line.startsWith(`${MOVED_FROM_TRAILER}: `)
  const lines = message.split(/\r?\n/)
  if (!isTrailer(lines[lines.length - 1] ?? '')) return message
  while (lines.length > 0 && (isTrailer(lines.at(-1)!) || lines.at(-1)!.trim() === '')) lines.pop()
  return lines.join('\n').trim()
}

/**
 * The path in a commit message's {@link MOVED_FROM_TRAILER} trailer, or `null`. A path that is not
 * a plain repository-relative one (absolute, with a backslash or an empty, `.` or `..` segment, or
 * one git could read as an option or pathspec magic) is ignored: a trailer is only text in a commit
 * message, which anyone can write. Glob characters are fine: every pathspec is literal (see
 * {@link literal}).
 */
function movedFrom(message: string): string | null {
  const prefix = `${MOVED_FROM_TRAILER}: `
  const line = message
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.startsWith(prefix))
  if (line == null) return null
  const from = line.slice(prefix.length).trim()
  const unsafe =
    from === '' ||
    /^[/:-]/.test(from) ||
    /^[a-zA-Z]:/.test(from) ||
    from.includes('\\') ||
    from.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  return unsafe ? null : from
}

/** A version, with the project's repository-relative path at that version. */
interface LoggedVersion extends VersionEntry {
  readonly relativePath: string
}

/** How many moves `log` follows back at most: a guard against a cycle of trailers. */
const MAX_FOLLOWED_MOVES = 100

/**
 * Whether `revision` (a validated version id, optionally with `:<path>` or `^{tree}`) names an
 * object. Resolving it first means a missing path fails as such, and is never read as anything else.
 */
function objectExists(repoRoot: string, revision: string): Promise<boolean> {
  return runGit(repoRoot, ['cat-file', '-e', revision], { queueKey: repoRoot }).then(
    () => true,
    () => false,
  )
}

/** The message of the error for a restore across a move that `.enso` folders tracked in git block. */
const TRACKED_ENSO_MESSAGE =
  'This version cannot be restored here: the repository tracks the project’s .enso folder, both at the version’s path and at the current one.'

/** Options for {@link LocalVersioning}. */
export interface LocalVersioningOptions {
  /** Which repositories the user has agreed to have versioned. Nothing else is ever committed to. */
  readonly consent: VersioningConsent
}

/** The message of the error thrown for an operation on a repository that is not enabled. */
export function notEnabledMessage(repoRoot: string): string {
  return `Versioning is not enabled for the repository at ${repoRoot}.`
}

/**
 * Versioning of local projects in git repositories.
 *
 * A repository is versioned only once it is *enabled* (see {@link LocalVersioning.enable}): the
 * user's home folder or work monorepo may enclose their projects, and committing to it unasked
 * would be wrong. Automatic commits skip a repository that is not enabled, and the operations
 * that write to it (`commit`, `restore`, `setComment`) reject. Reading history never needs consent.
 */
export class LocalVersioning {
  private readonly consent: VersioningConsent

  /** Create versioning that commits only to the repositories `options.consent` has enabled. */
  constructor(options: LocalVersioningOptions) {
    this.consent = options.consent
  }

  /** Fails unless the repository at `repoRoot` is enabled. Call it only under the lock. */
  private async assertEnabledIn(repoRoot: string): Promise<void> {
    if (!(await this.consent.isEnabled(repoRoot))) throw new Error(notEnabledMessage(repoRoot))
  }

  /** Whether `projectPath` is in a repository, has unsaved changes, and when it was last saved. */
  async status(projectPath: string): Promise<VersioningStatus> {
    if ((await findGit()) == null) return NO_GIT
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) return NO_REPOSITORY
    return exclusive(repoRoot, () => this.statusIn(repoRoot, projectPath))
  }

  private async statusIn(repoRoot: string, projectPath: string): Promise<VersioningStatus> {
    const blocked = await blockedReason(repoRoot)
    const enabled = await this.consent.isEnabled(repoRoot)
    const optedOut = await this.consent.isOptedOut(repoRoot)
    try {
      const relative = await repoRelative(repoRoot, projectPath)
      const run = (args: string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
      const changes = await run([
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        ...projectPathspecs(relative),
      ])
      let lastVersion: VersionSummary | null = null
      if (
        await run(['rev-parse', '--verify', '--quiet', 'HEAD']).then(
          () => true,
          () => false,
        )
      ) {
        const log = (
          await run(['log', '-1', '--format=%H%x00%cI', '--', ...projectPathspecs(relative)])
        ).trim()
        const [id, date] = log.split('\0')
        if (id && date) lastVersion = { id, date }
      }
      return {
        git: true,
        repoRoot,
        changed: changes.trim() !== '',
        lastVersion,
        blocked,
        enabled,
        optedOut,
      }
    } catch (error) {
      const locked = lockMessage(error)
      if (locked == null) throw error
      return {
        git: true,
        repoRoot,
        changed: false,
        lastVersion: null,
        blocked: locked,
        enabled,
        optedOut,
      }
    }
  }

  /**
   * `git init` in `rootPath`, and the root `.gitignore`, and enable versioning for the new
   * repository. Returns the repository root. Runs under the lock of the repository it creates.
   */
  async init(rootPath: string): Promise<{ readonly repoRoot: string }> {
    return exclusive(rootPath, () => this.initIn(rootPath))
  }

  private async initIn(rootPath: string): Promise<{ readonly repoRoot: string }> {
    await runGit(rootPath, ['init'])
    const ignoreFile = path.join(rootPath, '.gitignore')
    let existing = ''
    try {
      existing = await fs.readFile(ignoreFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const lines = existing.split(/\r?\n/).map((line) => line.trim())
    if (!lines.includes(ENSO_IGNORE_LINES[0]!)) {
      const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
      await fs.appendFile(ignoreFile, separator + ENSO_IGNORE_LINES.join('\n') + '\n')
    }
    const repoRoot = await findRepoRoot(rootPath)
    if (repoRoot == null) throw new Error(`Failed to initialise a repository in ${rootPath}`)
    await this.consent.enable(repoRoot)
    return { repoRoot }
  }

  /**
   * Agree to have the repository at `repoRoot` versioned.
   * @throws {Error} when `repoRoot` is not the root of a repository.
   */
  async enable(repoRoot: string): Promise<void> {
    await exclusive(repoRoot, async () => {
      const found = await findRepoRoot(repoRoot).catch(() => null)
      if (found == null || (await repositoryKey(found)) !== (await repositoryKey(repoRoot)))
        throw new Error(`${repoRoot} is not the root of a git repository.`)
      await this.consent.enable(repoRoot)
    })
  }

  /** Stop versioning the repository at `repoRoot`. Its history is left as it is. */
  async disable(repoRoot: string): Promise<void> {
    await exclusive(repoRoot, () => this.consent.disable(repoRoot))
  }

  /**
   * Enable the repository at `repoRoot` if its root is `rootPath` (the user's local projects
   * folder) or inside it, unless the user opted out of it. Paths are compared by
   * {@link repositoryKey}, so a root reached through a link or junction (OneDrive), or spelt in
   * another case on Windows, still matches git's real path. A repository above the root (a home
   * folder's dotfiles, a work monorepo) is left for the user to decide. Returns whether the
   * repository is enabled afterwards.
   */
  async enableIfInside(repoRoot: string, rootPath: string): Promise<{ readonly enabled: boolean }> {
    if (await this.consent.isEnabled(repoRoot)) return { enabled: true }
    if (await this.consent.isOptedOut(repoRoot)) return { enabled: false }
    const repoKey = await repositoryKey(repoRoot)
    const rootKey = await repositoryKey(rootPath)
    const rootPrefix = rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep
    if (repoKey !== rootKey && !repoKey.startsWith(rootPrefix)) return { enabled: false }
    await this.enable(repoRoot)
    return { enabled: true }
  }

  /**
   * The repository containing `p` (which may no longer exist, as after a move), or `null` when
   * there is none or git is not installed.
   */
  async repositoryOf(p: string): Promise<string | null> {
    if ((await findGit()) == null) return null
    return findRepoRoot(await existingAncestor(p))
  }

  /**
   * Commit the move of a project from `oldPath` to `newPath`, when both are in the same
   * repository; otherwise nothing is recorded. `message` may be built from the repository-relative
   * paths. The commit carries an {@link MOVED_FROM_TRAILER} trailer naming the old path. The move
   * has already happened, so a failure is logged and never thrown, and waiting — the repository
   * lookups included — is bounded by {@link VERSIONING_TIMEOUT_MS}. Returns the failure's message,
   * if any.
   */
  async commitMove(
    oldPath: string,
    newPath: string,
    message: string | ((moved: MovedPaths) => string),
  ): Promise<string | undefined> {
    const work = async () => {
      const repoRoot = await this.repositoryOf(newPath)
      if (repoRoot == null || repoRoot !== (await this.repositoryOf(oldPath))) return
      await exclusive(repoRoot, async () => {
        if (!(await this.consent.isEnabled(repoRoot))) return
        const moved = {
          from: await repoRelative(repoRoot, oldPath),
          to: await repoRelative(repoRoot, newPath),
        }
        await this.commitIn(
          repoRoot,
          [oldPath, newPath],
          typeof message === 'string' ? message : message(moved),
          [`${MOVED_FROM_TRAILER}: ${moved.from}`],
        )
      })
    }
    try {
      await withinVersioningTimeout(work())
      return undefined
    } catch (error) {
      console.error(`Failed to commit the move of ${oldPath} to ${newPath}:`, error)
      return error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * Commit everything under `paths` (all in one repository). `null` when nothing changed.
   *
   * These are automatic, path-scoped snapshots, so the user's hooks (`--no-verify` and
   * {@link AUTOMATIC}'s `core.hooksPath`) and commit signing, made for hand-written commits, never
   * apply: they could block or hang a close, or push a snapshot somewhere.
   * @throws {Error} when the repository is not enabled (see {@link commitIfEnabled}).
   */
  async commit(paths: readonly string[], message: string): Promise<{ readonly id: string | null }> {
    const first = paths[0]
    if (first == null) return { id: null }
    // A path may have just been moved away, so look for the repository from one that exists.
    const repoRoot = await findRepoRoot(await existingAncestor(first))
    if (repoRoot == null) throw new Error(`${first} is not in a git repository`)
    return exclusive(repoRoot, async () => {
      await this.assertEnabledIn(repoRoot)
      return this.commitIn(repoRoot, paths, message)
    })
  }

  /**
   * {@link commit} for automatic saves (a close): when there is no repository, git is not
   * installed, or the repository is not enabled, nothing is recorded and `id` is `null`.
   */
  async commitIfEnabled(
    paths: readonly string[],
    message: string,
  ): Promise<{ readonly id: string | null }> {
    const first = paths[0]
    if (first == null) return { id: null }
    const repoRoot = await this.repositoryOf(first)
    if (repoRoot == null) return { id: null }
    return exclusive(repoRoot, async () => {
      if (!(await this.consent.isEnabled(repoRoot))) return { id: null }
      return this.commitIn(repoRoot, paths, message)
    })
  }

  /** {@link commit} without the lock; `trailers` form the message's last paragraph. */
  private async commitIn(
    repoRoot: string,
    paths: readonly string[],
    message: string,
    trailers: readonly string[] = [],
  ): Promise<{ readonly id: string | null }> {
    const blocked = await blockedReason(repoRoot)
    if (blocked != null) throw new Error(blocked)
    try {
      const allRelatives = await Promise.all(paths.map((p) => repoRelative(repoRoot, p)))
      const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
      const hasHead = await run(['rev-parse', '--verify', '--quiet', 'HEAD']).then(
        () => true,
        () => false,
      )
      // `git add` and `git commit` fail on a pathspec that matches nothing known to git (the old
      // path of a project that was never versioned, a new path holding only ignored files).
      const isTracked = async (relative: string) =>
        (await run(['ls-files', '--cached', '--', literal(relative)])).trim() !== '' ||
        (hasHead &&
          (await run(['ls-tree', '-r', '--name-only', 'HEAD', '--', literal(relative)])).trim() !==
            '')
      const toAdd: string[] = []
      for (const [i, relative] of allRelatives.entries()) {
        if ((await exists(paths[i]!)) || (await isTracked(relative))) toAdd.push(relative)
      }
      if (toAdd.length === 0) return { id: null }
      // `add` rejects an exclude pathspec that matches an ignored folder, so unstage `.enso` afterwards.
      await run(['add', '-A', '--', ...toAdd.map(literal)])
      await run([
        'reset',
        '--quiet',
        '--',
        ...toAdd.map((relative) => literal(ensoFolder(relative))),
      ])
      const relatives: string[] = []
      for (const relative of toAdd) if (await isTracked(relative)) relatives.push(relative)
      if (relatives.length === 0) return { id: null }
      const pathspecs = [...relatives.map(literal), ...relatives.map(excludeEnso)]
      const unchanged = await run(['diff', '--cached', '--quiet', '--', ...pathspecs]).then(
        () => true,
        (error: unknown) => {
          if (error instanceof CommandError && error.code === 1) return false
          throw error
        },
      )
      if (unchanged) return { id: null }
      await run([
        ...(await identityArgs(repoRoot)),
        ...AUTOMATIC,
        'commit',
        '--no-verify',
        '-m',
        message,
        ...(trailers.length > 0 ? ['-m', trailers.join('\n')] : []),
        '--',
        ...pathspecs,
      ])
      // Still under the lock, so HEAD is this commit.
      return { id: (await run(['rev-parse', 'HEAD'])).trim() }
    } catch (error) {
      throw lockMessage(error) != null ? new Error(lockMessage(error)!) : error
    }
  }

  /**
   * The project's versions, newest first, including those from before its renames and moves. Empty
   * if the repository has no commits for it.
   */
  async log(projectPath: string): Promise<readonly VersionEntry[]> {
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) return []
    const versions = await exclusive(repoRoot, () => this.logIn(repoRoot, projectPath))
    return versions.map(({ relativePath: _relativePath, ...version }) => version)
  }

  /**
   * The project's versions, newest first, following its moves back. The commits at the current
   * path are read newest first up to the first one carrying an {@link MOVED_FROM_TRAILER} trailer:
   * one naming another path moved the project in, so it is listed and the commits before it at that
   * path follow (at most {@link MAX_FOLLOWED_MOVES} moves); one naming this path moved an earlier
   * project away, so neither it nor anything older here is listed. Each version records the path
   * the project had then.
   *
   * A project at the repository root is never moved in or away, so trailers are not followed;
   * since `git log -- .` lists every commit, its history starts at the commit that last added the
   * root `package.yaml` (before it, the root was not this project).
   */
  private async logIn(repoRoot: string, projectPath: string): Promise<readonly LoggedVersion[]> {
    const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
    const hasCommit = (revision: string) =>
      run(['rev-parse', '--verify', '--quiet', revision]).then(
        () => true,
        () => false,
      )
    if (!(await hasCommit('HEAD'))) return []
    let relative = await repoRelative(repoRoot, projectPath)
    const atRoot = relative === '.'
    const rootSince =
      atRoot ?
        (
          await run(['log', '-1', '--format=%H', '--diff-filter=A', '--', literal('package.yaml')])
        ).trim()
      : ''
    let before: string | null = null
    const seen = new Set<string>()
    const commits: {
      readonly id: string
      readonly date: string
      readonly name: string
      readonly email: string
      readonly message: string
      readonly relativePath: string
    }[] = []
    for (let moves = 0; moves <= MAX_FOLLOWED_MOVES; moves++) {
      const output = await run([
        'log',
        '--format=%H%x00%cI%x00%an%x00%ae%x00%B%x1e',
        ...(before != null ? [`${before}^`] : []),
        '--',
        ...projectPathspecs(relative),
      ])
      const segment = output
        .split('\x1e')
        .filter((record) => record.trim() !== '')
        .map((record) => {
          const [id = '', date = '', name = '', email = '', message = ''] = record
            .replace(/^\r?\n/, '')
            .split('\0')
          return { id, date, name, email, message: message.trim(), relativePath: relative }
        })
      let movedIn: { readonly id: string; readonly from: string } | null = null
      for (const commit of segment) {
        if (seen.has(commit.id)) break
        const from = atRoot ? null : movedFrom(commit.message)
        // A move away from this path: what is older here belongs to the project that left.
        if (from === relative) break
        seen.add(commit.id)
        commits.push(commit)
        if (atRoot && commit.id === rootSince) break
        if (from != null) {
          movedIn = { id: commit.id, from }
          break
        }
      }
      if (movedIn == null || !(await hasCommit(`${movedIn.id}^`))) break
      before = movedIn.id
      relative = movedIn.from
    }
    // An absent notes ref lists nothing.
    const noted = new Set(
      (await run(['notes', NOTES_REF, 'list']))
        .split(/\r?\n/)
        .map((line) => line.split(' ')[1])
        .filter((id): id is string => !!id),
    )
    return Promise.all(
      commits.map(async ({ id, date, name, email, message, relativePath }, index) => ({
        id,
        date,
        author: { name, email },
        comment:
          noted.has(id) ?
            (await run(['notes', NOTES_REF, 'show', id])).replace(/\r?\n$/, '')
          : withoutMoveTrailer(message),
        isLatest: index === 0,
        relativePath,
      })),
    )
  }

  /** The text of `relativePath` (relative to the project) at version `id`. */
  async fileAt(projectPath: string, id: string, relativePath: string): Promise<string> {
    assertVersionId(id)
    const file = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
    if (file.startsWith('/') || /^[a-zA-Z]:/.test(file) || file.split('/').includes('..'))
      throw new Error(`${relativePath} is not inside the project`)
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) throw new Error(`${projectPath} is not in a git repository`)
    return exclusive(repoRoot, async () => {
      const current = await repoRelative(repoRoot, projectPath)
      // An id not in the log (which `fileAt` has always accepted) reads at the current path.
      const version = (await this.logIn(repoRoot, projectPath)).find((entry) => entry.id === id)
      const relative = version?.relativePath ?? current
      const target = relative === '.' ? file : `${relative}/${file}`
      if (!(await objectExists(repoRoot, `${id}:${target}`)))
        throw new Error(`${relativePath} does not exist in version ${id}`)
      return runGit(repoRoot, ['show', `${id}:${target}`], { queueKey: repoRoot })
    })
  }

  /** Set the comment shown for version `id`, as a git note (the commit itself is not rewritten). */
  async setComment(projectPath: string, id: string, comment: string): Promise<void> {
    assertVersionId(id)
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) throw new Error(`${projectPath} is not in a git repository`)
    await exclusive(repoRoot, async () => {
      await this.assertEnabledIn(repoRoot)
      await this.assertProjectVersionIn(repoRoot, projectPath, id)
      try {
        if (comment.trim() === '') {
          // The notes ref is a commit, so removing a note needs the identity just as adding one.
          await runGit(
            repoRoot,
            [
              ...(await identityArgs(repoRoot)),
              ...AUTOMATIC,
              'notes',
              NOTES_REF,
              'remove',
              '--ignore-missing',
              '--end-of-options',
              id,
            ],
            { queueKey: repoRoot },
          )
          return
        }
        await runGit(
          repoRoot,
          [
            ...(await identityArgs(repoRoot)),
            ...AUTOMATIC,
            'notes',
            NOTES_REF,
            'add',
            '-f',
            '-m',
            comment,
            '--end-of-options',
            id,
          ],
          { queueKey: repoRoot },
        )
      } catch (error) {
        throw lockMessage(error) != null ? new Error(lockMessage(error)!) : error
      }
    })
  }

  /** Fails unless `id` is a version of the project (see {@link assertVersionId}). */
  private async assertProjectVersionIn(
    repoRoot: string,
    projectPath: string,
    id: string,
  ): Promise<LoggedVersion> {
    assertVersionId(id)
    const entry = (await this.logIn(repoRoot, projectPath)).find((e) => e.id === id)
    if (entry == null) throw new Error(`${id} is not a version of this project`)
    return entry
  }

  /**
   * Restore the project to version `id`. The caller must ensure the project is closed: this does
   * not know whether the engine has it open. The state before the restore is saved as a version
   * first (if it had changes), so nothing is lost. The project's `.enso` folder is never touched.
   * Returns the id of the new version.
   */
  async restore(projectPath: string, id: string): Promise<{ readonly id: string }> {
    assertVersionId(id)
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) throw new Error(`${projectPath} is not in a git repository`)
    return exclusive(repoRoot, async () => {
      await this.assertEnabledIn(repoRoot)
      const version = await this.assertProjectVersionIn(repoRoot, projectPath, id)
      const relative = await repoRelative(repoRoot, projectPath)
      const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
      const moved = version.relativePath !== relative
      // Every precondition is checked before anything in the work tree or index changes.
      if (moved && (relative === '.' || version.relativePath === '.'))
        throw new Error('A version from another path cannot be restored at the repository root.')
      const source = version.relativePath === '.' ? `${id}^{tree}` : `${id}:${version.relativePath}`
      if (!(await objectExists(repoRoot, source)))
        throw new Error(`The project does not exist in version ${id}`)
      if (
        moved &&
        (await objectExists(repoRoot, `${id}:${ensoFolder(version.relativePath)}`)) &&
        (await run(['ls-files', '--cached', '--', literal(ensoFolder(relative))])).trim() !== ''
      )
        throw new Error(TRACKED_ENSO_MESSAGE)
      const saved = await this.commitIn(repoRoot, [projectPath], 'Saved before restore')
      // Once the work is saved, a failure says where it is, so the user can get it back.
      const failed = (error: unknown) => {
        const reason =
          lockMessage(error) ??
          (error instanceof CommandError ? error.stderr.trim() || error.message : null) ??
          (error instanceof Error ? error.message : String(error))
        if (saved.id == null)
          return lockMessage(error) != null ? new Error(lockMessage(error)!) : error
        return new Error(
          `Restoring failed; your work was saved as the version 'Saved before restore' and can be restored from the list. (${reason})`,
          { cause: error },
        )
      }
      try {
        if (!moved) {
          await run([
            'restore',
            `--source=${id}`,
            '--staged',
            '--worktree',
            '--',
            ...projectPathspecs(relative),
          ])
        } else {
          // The version is from before a move: its files were at another path. Everything at the
          // current path is tracked (the commit above), so drop it from the index, read the old
          // path's tree in under the current path, write it out, and remove what is left over.
          try {
            await run([
              'rm',
              '-r',
              '-q',
              '--cached',
              '--ignore-unmatch',
              '--',
              ...projectPathspecs(relative),
            ])
            await run(['read-tree', `--prefix=${relative}/`, source])
            await run(['restore', '--worktree', '--', ...projectPathspecs(relative)])
            await run(['clean', '-f', '-d', '-q', '--', ...projectPathspecs(relative)])
          } catch (error) {
            // Put the index back as the commit above left it, so no deletion stays staged.
            await run(['reset', '-q', '--', ...projectPathspecs(relative)]).catch(
              (resetError: unknown) =>
                console.error(`Failed to reset the index for ${relative}:`, resetError),
            )
            if (error instanceof CommandError && error.stderr.includes('Cannot bind'))
              throw new Error(TRACKED_ENSO_MESSAGE, { cause: error })
            throw error
          }
        }
      } catch (error) {
        throw failed(error)
      }
      const restored = await this.commitIn(
        repoRoot,
        [projectPath],
        `Restored version from ${version.date}`,
      ).catch((error: unknown) => {
        throw failed(error)
      })
      if (restored.id != null) return { id: restored.id }
      // Restoring the latest version changes nothing, so there is nothing new to commit.
      return { id }
    })
  }

  /**
   * Write the project as it was at version `id` into the new directory `targetPath`, which must
   * not exist (its parent is created if needed). The repository's index and work tree are not
   * touched. The copy has no `.enso` folder; the caller gives it a new project id and name.
   */
  async exportAt(projectPath: string, id: string, targetPath: string): Promise<void> {
    assertVersionId(id)
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) throw new Error(`${projectPath} is not in a git repository`)
    await exclusive(repoRoot, async () => {
      const version = await this.assertProjectVersionIn(repoRoot, projectPath, id)
      const relative = version.relativePath
      const tree = relative === '.' ? `${id}^{tree}` : `${id}:${relative}`
      if (!(await objectExists(repoRoot, tree)))
        throw new Error(`The project does not exist in version ${id}`)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      try {
        // Not recursive: creating it is what claims it, so an existing directory is never used.
        await fs.mkdir(targetPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error(`${targetPath} already exists`, { cause: error })
        throw error
      }
      let tmpDir: string | undefined
      try {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enso-export-'))
        const env = { GIT_INDEX_FILE: path.join(tmpDir, 'index') }
        await runGit(repoRoot, ['read-tree', tree], { queueKey: repoRoot, env })
        await runGit(
          repoRoot,
          [`--work-tree=${targetPath}`, 'checkout-index', '--all', '--force'],
          { queueKey: repoRoot, env },
        )
      } catch (error) {
        // This call created `targetPath`, so removing it removes nothing else.
        await fs.rm(targetPath, { recursive: true, force: true })
        throw error
      } finally {
        if (tmpDir != null)
          await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    })
  }
}
