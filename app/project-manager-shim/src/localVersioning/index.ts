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

/** A saved version of a project, with who made it and its comment. */
export interface VersionEntry extends VersionSummary {
  readonly author: { readonly name: string; readonly email: string }
  /** The version's `refs/notes/enso` note if it has one, else its commit message. */
  readonly comment: string
  readonly isLatest: boolean
}

const NOTES_REF = '--ref=enso'

/**
 * Throws unless `id` is a full commit hash (40 or 64 hex digits, as {@link LocalVersioning.log}
 * returns). Ids come from callers over HTTP, so nothing git could read as an option or a revision
 * expression (`--output=…`, `HEAD~1`) may get through. Abbreviated ids are not accepted.
 */
export function assertVersionId(id: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id)) throw new Error(`Invalid version id: ${id}`)
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

/** A pathspec excluding the `.enso` folder of the project at `relative` (a version never holds it). */
function ensoFolder(relative: string): string {
  return relative === '.' ? '.enso' : `${relative}/.enso`
}

function excludeEnso(relative: string): string {
  return `:(exclude)${ensoFolder(relative)}`
}

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
        excludeEnso(relative),
      ])
      let lastVersion: VersionSummary | null = null
      if (
        await run(['rev-parse', '--verify', '--quiet', 'HEAD']).then(
          () => true,
          () => false,
        )
      ) {
        const log = (
          await run(['log', '-1', '--format=%H%x00%cI', '--', relative, excludeEnso(relative)])
        ).trim()
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
    try {
      const relatives = await Promise.all(paths.map((p) => repoRelative(repoRoot, p)))
      const pathspecs = [...relatives, ...relatives.map(excludeEnso)]
      const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
      // `add` rejects an exclude pathspec that matches an ignored folder, so unstage `.enso` afterwards.
      await run(['add', '-A', '--', ...relatives])
      await run(['reset', '--quiet', '--', ...relatives.map(ensoFolder)])
      const unchanged = await run(['diff', '--cached', '--quiet', '--', ...pathspecs]).then(
        () => true,
        (error: unknown) => {
          if (error instanceof CommandError && error.code === 1) return false
          throw error
        },
      )
      if (unchanged) return { id: null }
      await run([...(await identityArgs(repoRoot)), 'commit', '-m', message, '--', ...pathspecs])
      return { id: (await run(['rev-parse', 'HEAD'])).trim() }
    } catch (error) {
      throw lockMessage(error) != null ? new Error(lockMessage(error)!) : error
    }
  }

  /** The project's versions, newest first. Empty if the repository has no commits for it. */
  async log(projectPath: string): Promise<readonly VersionEntry[]> {
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) return []
    const run = (args: readonly string[]) => runGit(repoRoot, args, { queueKey: repoRoot })
    const hasHead = await run(['rev-parse', '--verify', '--quiet', 'HEAD']).then(
      () => true,
      () => false,
    )
    if (!hasHead) return []
    const relative = await repoRelative(repoRoot, projectPath)
    const output = await run([
      'log',
      '--format=%H%x00%cI%x00%an%x00%ae%x00%B%x1e',
      '--',
      relative,
      excludeEnso(relative),
    ])
    const commits = output
      .split('\x1e')
      .filter((record) => record.trim() !== '')
      .map((record) => {
        const [id = '', date = '', name = '', email = '', message = ''] = record
          .replace(/^\r?\n/, '')
          .split('\0')
        return { id, date, name, email, message: message.trim() }
      })
    // An absent notes ref lists nothing.
    const noted = new Set(
      (await run(['notes', NOTES_REF, 'list']))
        .split(/\r?\n/)
        .map((line) => line.split(' ')[1])
        .filter((id): id is string => !!id),
    )
    return Promise.all(
      commits.map(async ({ id, date, name, email, message }, index) => ({
        id,
        date,
        author: { name, email },
        comment:
          noted.has(id) ?
            (await run(['notes', NOTES_REF, 'show', id])).replace(/\r?\n$/, '')
          : message,
        isLatest: index === 0,
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
    const relative = await repoRelative(repoRoot, projectPath)
    const target = relative === '.' ? file : `${relative}/${file}`
    return runGit(repoRoot, ['show', `${id}:${target}`], { queueKey: repoRoot })
  }

  /** Set the comment shown for version `id`, as a git note (the commit itself is not rewritten). */
  async setComment(projectPath: string, id: string, comment: string): Promise<void> {
    assertVersionId(id)
    const repoRoot = await findRepoRoot(projectPath)
    if (repoRoot == null) throw new Error(`${projectPath} is not in a git repository`)
    if (!(await this.log(projectPath)).some((entry) => entry.id === id))
      throw new Error(`${id} is not a version of this project`)
    try {
      await runGit(
        repoRoot,
        [
          ...(await identityArgs(repoRoot)),
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
  }
}
