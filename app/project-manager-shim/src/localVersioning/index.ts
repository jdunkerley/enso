/**
 * Versioning of local projects as git commits, using the user's own git CLI.
 *
 * Every commit is scoped to the paths given, so one project's changes are never recorded with
 * another's. Every git call for a repository goes through {@link runGit} with the repository root
 * as the queue key, so calls on one repository are serialised.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { CommandError } from '../childProcess/runCommand.js'
import { findGit, findRepoRoot, identityArgs, runGit } from './git.js'

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
}

/** Lines the root `.gitignore` must contain. */
export const ENSO_IGNORE_LINES: readonly string[] = ['**/.enso/', '*.bak']

const NO_GIT: VersioningStatus = {
  git: false,
  repoRoot: null,
  changed: false,
  lastVersion: null,
  blocked: null,
}
const NO_REPOSITORY: VersioningStatus = { ...NO_GIT, git: true }

/** In-progress operations that make a repository unusable, with the message to show. */
const BLOCKING_STATES: readonly (readonly [string, string])[] = [
  ['MERGE_HEAD', 'The repository is in the middle of a merge.'],
  ['rebase-merge', 'The repository is in the middle of a rebase.'],
  ['rebase-apply', 'The repository is in the middle of a rebase.'],
]

/** `p` relative to `repoRoot` (resolving links first), with `/` separators; `.` for the root. */
async function repoRelative(repoRoot: string, p: string): Promise<string> {
  const relative = path.relative(await fs.realpath(repoRoot), await fs.realpath(p))
  return relative === '' ? '.' : relative.split(path.sep).join('/')
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Why `repoRoot` cannot be used, or `null`. */
async function blockedReason(repoRoot: string): Promise<string | null> {
  for (const [name, message] of BLOCKING_STATES) {
    const gitPath = (
      await runGit(repoRoot, ['rev-parse', '--git-path', name], { queueKey: repoRoot })
    ).replace(/\r?\n$/, '')
    if (await exists(path.resolve(repoRoot, gitPath))) return message
  }
  return null
}

function lockMessage(error: unknown): string | null {
  return error instanceof CommandError && error.stderr.includes('index.lock') ?
      error.stderr.trim()
    : null
}

/** Versioning of local projects in git repositories. */
export class LocalVersioning {
  /** Whether `projectPath` is in a repository, has unsaved changes, and when it was last saved. */
  async status(projectPath: string): Promise<VersioningStatus> {
    if ((await findGit()) == null) return NO_GIT
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) return NO_REPOSITORY
    const blocked = await blockedReason(repoRoot)
    try {
      const relative = await repoRelative(repoRoot, projectPath)
      const run = (args: string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
      const changes = await run([
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        relative,
      ])
      let lastVersion: VersionSummary | null = null
      if (
        await run(['rev-parse', '--verify', '--quiet', 'HEAD']).then(
          () => true,
          () => false,
        )
      ) {
        const log = (await run(['log', '-1', '--format=%H%x00%cI', '--', relative])).trim()
        const [id, date] = log.split('\0')
        if (id && date) lastVersion = { id, date }
      }
      return { git: true, repoRoot, changed: changes.trim() !== '', lastVersion, blocked }
    } catch (error) {
      const locked = lockMessage(error)
      if (locked == null) throw error
      return { git: true, repoRoot, changed: false, lastVersion: null, blocked: locked }
    }
  }

  /** `git init` in `rootPath`, and the root `.gitignore`. Returns the repository root. */
  async init(rootPath: string): Promise<{ readonly repoRoot: string }> {
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
    return { repoRoot }
  }

  /** Commit everything under `paths` (all in one repository). `null` when nothing changed. */
  async commit(paths: readonly string[], message: string): Promise<{ readonly id: string | null }> {
    const first = paths[0]
    if (first == null) return { id: null }
    const repoRoot = await findRepoRoot(first)
    if (repoRoot == null) throw new Error(`${first} is not in a git repository`)
    const blocked = await blockedReason(repoRoot)
    if (blocked != null) throw new Error(blocked)
    const relatives = await Promise.all(paths.map((p) => repoRelative(repoRoot, p)))
    const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
    await run(['add', '-A', '--', ...relatives])
    const unchanged = await run(['diff', '--cached', '--quiet', '--', ...relatives]).then(
      () => true,
      (error: unknown) => {
        if (error instanceof CommandError && error.code === 1) return false
        throw error
      },
    )
    if (unchanged) return { id: null }
    await run([...(await identityArgs(repoRoot)), 'commit', '-m', message, '--', ...relatives])
    return { id: (await run(['rev-parse', 'HEAD'])).trim() }
  }
}
