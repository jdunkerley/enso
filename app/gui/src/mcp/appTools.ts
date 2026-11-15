/**
 * @file The MCP app tools: what the IDE is showing, the projects and files on the Drive, and
 * creating, opening and closing a project, so that an agent can start from nothing. Their
 * definitions (names, descriptions, argument schemas) are in
 * `app/electron-client/src/mcp/appTools.ts`. The handlers are pure functions over
 * {@link AppToolDeps}, which `useAppMcpTools` builds from the app's stores at call time.
 *
 * Every path an agent passes is checked against the Drive's root and the saved local folders
 * ({@link resolveAllowedPath}) before anything is listed, created or opened: these tools let an
 * external program look at the user's disk, and must not reach past the folders the Drive shows.
 */
/* eslint-disable camelcase -- argument and result names are snake_case on the wire */
import { jsonResult, truncate } from '@/mcp/graphTools'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { McpToolHandler } from './toolDispatcher'

/** Most characters of a project or file name in a result. */
export const NAME_CHARS = 300
/** Most entries in a `list_projects` or `list_files` result; beyond it the result says `truncated`. */
export const MAX_ENTRIES = 500

export const NO_PROJECT_AT_PATH_ERROR = 'No project at that path.'
export const NO_PROJECT_ON_SCREEN_ERROR = 'No project is on screen.'
export const STILL_OPENING_ERROR = 'The project is still opening. Call get_app_state in a moment.'

/** One entry of a folder, as the local backend lists it. */
export interface DirectoryEntry {
  readonly name: string
  readonly path: string
  readonly kind: 'file' | 'folder' | 'project'
  /** A file's size. */
  readonly bytes?: number
  /** Whether a project has a tab in the IDE. */
  readonly open?: boolean
}

/** A project, by name and path. */
export interface ProjectRef {
  readonly name: string
  readonly path: string
}

/** What the IDE is showing. */
export interface AppState {
  readonly page: 'dashboard' | 'project' | 'settings' | 'logs'
  /** The project on screen. */
  readonly project: ProjectRef | null
  /** The projects with a tab. */
  readonly openProjects: readonly ProjectRef[]
}

/** What the app tools read and do. */
export interface AppToolDeps {
  /** The Drive's root folder. */
  readonly rootDirectory: () => string
  /** The local folders the user added to the Drive. */
  readonly savedDirectories: () => readonly string[]
  /** The entries of the folder. Rejects when it cannot be listed. */
  readonly listDirectory: (path: string) => Promise<readonly DirectoryEntry[]>
  /** Creates an empty project in the folder; resolves with its name and path. */
  readonly createProject: (name: string, directory: string) => Promise<ProjectRef>
  /**
   * Opens the project's tab (or shows it, when it has one), and resolves `true` once its project
   * tools answer, or `false` when it is still opening at the wait's end. Rejects with the error
   * the opening failed with.
   */
  readonly openProject: (path: string, name: string) => Promise<boolean>
  /** Closes the project on screen; `false` when no project tab is on screen. */
  readonly closeCurrentProject: () => Promise<boolean>
  readonly state: () => AppState
}

// === Paths ===

/** A path taken apart: its root (`C:`, `//server/share` or `` for POSIX) and its segments. */
interface ParsedPath {
  readonly prefix: string
  readonly segments: readonly string[]
}

/**
 * Whether paths compare as on Windows. Decided by the root's own form (a drive letter or a UNC
 * path), not by the platform the GUI runs on: this runs in the renderer, and the roots are what the
 * backend spells.
 */
function isWindowsForm(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || /^[\\/]{2}[^\\/]/.test(root)
}

/**
 * Parses an absolute path, resolving `.` and `..`; `null` when it is relative, empty, climbs above
 * its root, or is one Windows would read differently from how it is spelt.
 *
 * On Windows both separators count, the path must start with a drive (`C:\`) or a UNC share
 * (`\\server\share`), and device paths (`\\?\`, `\\.\`), segments with `:` (alternate data
 * streams) and segments ending in a dot or a space (which Windows strips, so `.. ` would be `..`)
 * are refused. On POSIX only `/` separates; a backslash is part of a name.
 */
function parsePath(path: string, windows: boolean): ParsedPath | null {
  if (path.includes('\0')) return null
  let prefix: string
  let rest: string
  if (windows) {
    const slashed = path.replace(/\\/g, '/')
    const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed)
    const unc = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(slashed)
    if (drive != null) {
      prefix = `${drive[1]!.toUpperCase()}:`
      rest = drive[2]!
    } else if (unc != null && unc[1] !== '?' && unc[1] !== '.') {
      prefix = `//${unc[1]}/${unc[2]}`
      rest = unc[3] ?? ''
    } else {
      return null
    }
  } else {
    if (!path.startsWith('/')) return null
    prefix = ''
    rest = path
  }
  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.pop() == null) return null
      continue
    }
    if (windows && (/[. ]$/.test(segment) || segment.includes(':'))) return null
    segments.push(segment)
  }
  return { prefix, segments }
}

function formatPath({ prefix, segments }: ParsedPath, windows: boolean): string {
  if (segments.length === 0)
    return windows && !prefix.startsWith('//') ? `${prefix}/` : prefix || '/'
  return `${prefix}/${segments.join('/')}`
}

/**
 * Windows compares names case-insensitively. Only ASCII letters are folded: a fuller folding
 * (`toLowerCase`) equates characters NTFS keeps apart (the Kelvin sign and `K`), which could pass
 * a folder outside the root as inside it. A non-ASCII name in another case is refused instead.
 */
function sameName(a: string, b: string, windows: boolean): boolean {
  if (!windows) return a === b
  const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase())
  return fold(a) === fold(b)
}

/**
 * The path, resolved, if it is one of the roots or inside one; `null` otherwise. It is spelt with
 * the root's own spelling followed by the rest of the path, with `/` separators, as the local
 * backend lists paths.
 *
 * Symbolic links and junctions are out of scope: a link inside a root that points outside it is
 * followed by whatever lists or opens the path. The Drive shows such links too.
 */
export function resolveAllowedPath(path: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    const windows = isWindowsForm(root)
    const parsedRoot = parsePath(root, windows)
    const parsed = parsePath(path, windows)
    if (parsedRoot == null || parsed == null) continue
    if (!sameName(parsed.prefix, parsedRoot.prefix, windows)) continue
    if (parsed.segments.length < parsedRoot.segments.length) continue
    const inside = parsedRoot.segments.every((segment, i) =>
      sameName(segment, parsed.segments[i]!, windows),
    )
    if (!inside) continue
    const below = parsed.segments.slice(parsedRoot.segments.length)
    return formatPath(
      { prefix: parsedRoot.prefix, segments: [...parsedRoot.segments, ...below] },
      windows,
    )
  }
  return null
}

/**
 * Whether the path is one of the roots or inside one, after resolving `.` and `..` and unifying
 * separators (and, on Windows, comparing ASCII letters case-insensitively). A relative or empty
 * path is never allowed. See {@link resolveAllowedPath}.
 */
export function isAllowedPath(path: string, roots: readonly string[]): boolean {
  return resolveAllowedPath(path, roots) != null
}

/** Whether two paths, both resolved against `root`'s form, name the same thing. */
function samePath(a: string, b: string, root: string): boolean {
  const windows = isWindowsForm(root)
  const parsedA = parsePath(a, windows)
  const parsedB = parsePath(b, windows)
  if (parsedA == null || parsedB == null) return false
  return (
    sameName(parsedA.prefix, parsedB.prefix, windows) &&
    parsedA.segments.length === parsedB.segments.length &&
    parsedA.segments.every((segment, i) => sameName(segment, parsedB.segments[i]!, windows))
  )
}

/** The folder holding the path; `null` for a root of the filesystem. */
function parentPath(path: string, root: string): string | null {
  const windows = isWindowsForm(root)
  const parsed = parsePath(path, windows)
  if (parsed == null || parsed.segments.length === 0) return null
  return formatPath({ prefix: parsed.prefix, segments: parsed.segments.slice(0, -1) }, windows)
}

// === The tools ===

function roots(deps: AppToolDeps): string[] {
  return [deps.rootDirectory(), ...deps.savedDirectories()]
}

function outsideError(deps: AppToolDeps): McpToolResult {
  return {
    ok: false,
    error: `That folder is outside the Drive. Use a path under ${deps.rootDirectory()} (or a saved local folder).`,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function name(text: string): string {
  return truncate(text, NAME_CHARS)
}

function projectRef(project: ProjectRef): ProjectRef {
  return { name: name(project.name), path: project.path }
}

/** `get_app_state`: the page on screen, the project on screen, the open ones and the Drive root. */
export function getAppState(deps: AppToolDeps): McpToolResult {
  const state = deps.state()
  return jsonResult({
    page: state.page,
    project: state.project != null ? projectRef(state.project) : null,
    open_projects: state.openProjects.map(projectRef),
    drive_root: deps.rootDirectory(),
  })
}

/** Lists the folder (the Drive root by default), or answers why it cannot. */
async function listAllowed(
  deps: AppToolDeps,
  directory: string | undefined,
): Promise<{ directory: string; entries: readonly DirectoryEntry[] } | McpToolResult> {
  const resolved = resolveAllowedPath(directory ?? deps.rootDirectory(), roots(deps))
  if (resolved == null) return outsideError(deps)
  try {
    return { directory: resolved, entries: await deps.listDirectory(resolved) }
  } catch (error) {
    return { ok: false, error: `Could not list that folder: ${errorMessage(error)}` }
  }
}

/** At most {@link MAX_ENTRIES} of the items, and whether some were left out. */
function capped<T>(items: readonly T[]): { items: readonly T[]; truncated?: true } {
  return items.length > MAX_ENTRIES ?
      { items: items.slice(0, MAX_ENTRIES), truncated: true }
    : { items }
}

/** `list_projects`: the projects in the folder, each `{ name, path, open }`. */
export async function listProjects(
  deps: AppToolDeps,
  { directory }: { directory?: string | undefined },
): Promise<McpToolResult> {
  const listed = await listAllowed(deps, directory)
  if ('ok' in listed) return listed
  const projects = listed.entries
    .filter((entry) => entry.kind === 'project')
    .map((entry) => ({ name: name(entry.name), path: entry.path, open: entry.open ?? false }))
  const { items, truncated } = capped(projects)
  return jsonResult({
    directory: listed.directory,
    projects: items,
    ...(truncated && { truncated }),
  })
}

/** `list_files`: every entry of the folder, each `{ name, path, kind, bytes? }`. */
export async function listFiles(
  deps: AppToolDeps,
  { directory }: { directory?: string | undefined },
): Promise<McpToolResult> {
  const listed = await listAllowed(deps, directory)
  if ('ok' in listed) return listed
  const entries = listed.entries.map((entry) => ({
    name: name(entry.name),
    path: entry.path,
    kind: entry.kind,
    ...(entry.bytes != null && { bytes: entry.bytes }),
  }))
  const { items, truncated } = capped(entries)
  return jsonResult({
    directory: listed.directory,
    entries: items,
    ...(truncated && { truncated }),
  })
}

/** Opens the project and waits until its project tools answer. */
async function openAndWait(deps: AppToolDeps, project: ProjectRef): Promise<McpToolResult> {
  try {
    const ready = await deps.openProject(project.path, project.name)
    if (!ready) return { ok: false, error: STILL_OPENING_ERROR }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
  return jsonResult(projectRef(project))
}

/**
 * `open_project`: opens the project at the path (or shows its tab), once its parent's listing shows
 * a project there, and answers `{ name, path }` when its project tools answer.
 */
export async function openProject(
  deps: AppToolDeps,
  { path }: { path: string },
): Promise<McpToolResult> {
  const allowedRoots = roots(deps)
  const resolved = resolveAllowedPath(path, allowedRoots)
  if (resolved == null) return outsideError(deps)
  const root = deps.rootDirectory()
  const parent = parentPath(resolved, root)
  if (parent == null) return { ok: false, error: NO_PROJECT_AT_PATH_ERROR }
  let siblings: readonly DirectoryEntry[]
  try {
    siblings = await deps.listDirectory(parent)
  } catch {
    return { ok: false, error: NO_PROJECT_AT_PATH_ERROR }
  }
  const project = siblings.find(
    (entry) => entry.kind === 'project' && samePath(entry.path, resolved, root),
  )
  if (project == null) return { ok: false, error: NO_PROJECT_AT_PATH_ERROR }
  return openAndWait(deps, { name: project.name, path: project.path })
}

/** Why a project name cannot be used; `null` when it can. */
function invalidProjectName(projectName: string): string | null {
  if (projectName.trim() === '') return 'A project name cannot be empty.'
  if (/[/\\]/.test(projectName)) return 'A project name cannot contain `/` or `\\`.'
  if (projectName === '.' || projectName === '..') return 'A project name cannot be `.` or `..`.'
  return null
}

/**
 * `create_project`: creates an empty project in the folder (the Drive root by default), unless a
 * project there has the name, opens it and answers `{ name, path }` when its project tools answer.
 */
export async function createProject(
  deps: AppToolDeps,
  { name: projectName, directory }: { name: string; directory?: string | undefined },
): Promise<McpToolResult> {
  const invalid = invalidProjectName(projectName)
  if (invalid != null) return { ok: false, error: invalid }
  const listed = await listAllowed(deps, directory)
  if ('ok' in listed) return listed
  const taken = listed.entries.some(
    (entry) => entry.kind === 'project' && entry.name === projectName,
  )
  if (taken) {
    return { ok: false, error: `A project called ${name(projectName)} is already in that folder.` }
  }
  let created: ProjectRef
  try {
    created = await deps.createProject(projectName, listed.directory)
  } catch (error) {
    return { ok: false, error: `Could not create the project: ${errorMessage(error)}` }
  }
  return openAndWait(deps, created)
}

/**
 * `close_project`: closes the project on screen and answers which one, and what is on screen
 * now.
 */
export async function closeProject(deps: AppToolDeps): Promise<McpToolResult> {
  const project = deps.state().project
  if (project == null) return { ok: false, error: NO_PROJECT_ON_SCREEN_ERROR }
  if (!(await deps.closeCurrentProject())) return { ok: false, error: NO_PROJECT_ON_SCREEN_ERROR }
  const now = deps.state()
  return jsonResult({
    closed: projectRef(project),
    page: now.page,
    project: now.project != null ? projectRef(now.project) : null,
  })
}

function invalidArgument(argument: string, expected: string): McpToolResult {
  return { ok: false, error: `The argument \`${argument}\` must be ${expected}.` }
}

/**
 * The app tools' handlers, by tool name. They narrow the arguments, which arrive as `unknown`
 * (main has validated them), and read `deps()` at each call.
 */
export function appToolHandlers(deps: () => AppToolDeps): Record<string, McpToolHandler> {
  return {
    get_app_state: async () => getAppState(deps()),
    list_projects: async ({ directory }) => {
      if (directory != null && typeof directory !== 'string') {
        return invalidArgument('directory', 'a string')
      }
      return listProjects(deps(), { directory: directory ?? undefined })
    },
    list_files: async ({ directory }) => {
      if (directory != null && typeof directory !== 'string') {
        return invalidArgument('directory', 'a string')
      }
      return listFiles(deps(), { directory: directory ?? undefined })
    },
    create_project: async ({ name, directory }) => {
      if (typeof name !== 'string') return invalidArgument('name', 'a string')
      if (directory != null && typeof directory !== 'string') {
        return invalidArgument('directory', 'a string')
      }
      return createProject(deps(), { name, directory: directory ?? undefined })
    },
    open_project: async ({ path }) => {
      if (typeof path !== 'string') return invalidArgument('path', 'a string')
      return openProject(deps(), { path })
    },
    close_project: async () => closeProject(deps()),
  }
}
