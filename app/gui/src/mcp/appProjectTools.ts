/**
 * @file `create_project`, `open_project`, `switch_project` and `close_project`, the MCP app tools
 * that change which projects are open and which is on screen.
 */
import { toolError } from '@/mcp/editTools'
import { jsonResult } from '@/mcp/graphTools'
import type { McpToolResult } from 'enso-common/src/mcp'
import { parentPath, resolveAllowedPath, samePath } from './appPaths'
import {
  errorMessage,
  listAllowed,
  name,
  NO_PROJECT_AT_PATH_ERROR,
  NO_PROJECT_ON_SCREEN_ERROR,
  outsideError,
  projectRef,
  roots,
  STILL_OPENING_ERROR,
  type AppToolDeps,
  type DirectoryEntry,
  type ProjectRef,
} from './appToolSupport'

/** Answers `{ name, path }` once `ready` resolves `true`, or why not. */
async function answerWhenReady(
  project: ProjectRef,
  ready: () => Promise<boolean>,
): Promise<McpToolResult> {
  try {
    if (!(await ready())) return { ok: false, error: STILL_OPENING_ERROR }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
  return jsonResult(projectRef(project))
}

/** Opens the project and waits until its project tools answer. */
function openAndWait(deps: AppToolDeps, project: ProjectRef): Promise<McpToolResult> {
  return answerWhenReady(project, () => deps.openProject(project.path, project.name))
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
  // A root is a folder of the Drive, not a project in it; and the parent is listed only when it is
  // itself in the Drive, so that nothing outside the Drive is ever listed.
  const isRoot = allowedRoots.some((allowedRoot) => samePath(allowedRoot, resolved, root))
  const parent = parentPath(resolved, root)
  if (isRoot || parent == null || resolveAllowedPath(parent, allowedRoots) == null) {
    return { ok: false, error: NO_PROJECT_AT_PATH_ERROR }
  }
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

/**
 * `switch_project`: brings the tab of the open project at the path on screen and answers
 * `{ name, path }` once its project tools answer. The path is compared, exactly, with the open
 * projects' paths as `get_app_state` reports them, and never resolved against the disk: this opens
 * and creates nothing.
 */
export async function switchProject(
  deps: AppToolDeps,
  { path }: { path: string },
): Promise<McpToolResult> {
  const state = deps.state()
  const project = state.openProjects.find((open) => open.path === path)
  if (project == null) {
    const open =
      state.openProjects.length === 0 ?
        'No project is open.'
      : `Open projects: ${state.openProjects.map((open) => open.path).join(', ')}.`
    return toolError(
      `No open project has the path \`${path}\`. ${open} Use \`open_project\` to open one that is closed.`,
    )
  }
  if (state.project?.path === path) return jsonResult(projectRef(project))
  return answerWhenReady(project, () => deps.showProject(project.path))
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
