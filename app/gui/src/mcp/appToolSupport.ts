/**
 * @file What the MCP app tools share: the wire constants, the types of what they read and do
 * ({@link AppToolDeps}), and the helpers that check a folder against the Drive and list it.
 */
import { truncate } from '@/mcp/graphTools'
import type { McpToolResult } from 'enso-common/src/mcp'
import { resolveAllowedPath } from './appPaths'

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
  /**
   * Brings the tab of the open project at the path on screen, and resolves `true` once its project
   * tools answer, or `false` when they do not at the wait's end. Opens nothing: rejects when the
   * project has no tab.
   */
  readonly showProject: (path: string) => Promise<boolean>
  /** Closes the project on screen; `false` when no project tab is on screen. */
  readonly closeCurrentProject: () => Promise<boolean>
  readonly state: () => AppState
}

/** The Drive root and the saved local folders: the places a path may be in. */
export function roots(deps: AppToolDeps): string[] {
  return [deps.rootDirectory(), ...deps.savedDirectories()]
}

/** The answer for a path outside the Drive. */
export function outsideError(deps: AppToolDeps): McpToolResult {
  return {
    ok: false,
    error: `That folder is outside the Drive. Use a path under ${deps.rootDirectory()} (or a saved local folder).`,
  }
}

/** An error's message, or the value as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A project or file name, cut at {@link NAME_CHARS}. */
export function name(text: string): string {
  return truncate(text, NAME_CHARS)
}

/** The project with its name cut at {@link NAME_CHARS}. */
export function projectRef(project: ProjectRef): ProjectRef {
  return { name: name(project.name), path: project.path }
}

/** Lists the folder (the Drive root by default), or answers why it cannot. */
export async function listAllowed(
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
