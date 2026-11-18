/**
 * @file The MCP app tools: what the IDE is showing, the projects and files on the Drive, and
 * creating, opening, switching between and closing projects, so that an agent can start from
 * nothing. Their definitions (names, descriptions, argument schemas) are in
 * `app/electron-client/src/mcp/appTools.ts`. The handlers are pure functions over
 * {@link AppToolDeps}, which `useAppMcpTools` builds from the app's stores at call time.
 *
 * Every path an agent passes is checked against the Drive's root and the saved local folders
 * (`resolveAllowedPath`) before anything is listed, created or opened: these tools let an
 * external program look at the user's disk, and must not reach past the folders the Drive shows.
 *
 * This file narrows the arguments and assembles the tools, which are in `appStateTools.ts`,
 * `appDriveTools.ts` and `appProjectTools.ts`; `appToolSupport.ts` has what they share and
 * `appPaths.ts` the path checks.
 */
/* eslint-disable camelcase -- argument and result names are snake_case on the wire */
import type { McpToolResult } from 'enso-common/src/mcp'
import { listFiles, listProjects } from './appDriveTools'
import { closeProject, createProject, openProject, switchProject } from './appProjectTools'
import { getAppState } from './appStateTools'
import type { AppToolDeps } from './appToolSupport'
import type { McpToolHandler } from './toolDispatcher'

export { listFiles, listProjects } from './appDriveTools'
export { isAllowedPath, resolveAllowedPath } from './appPaths'
export { closeProject, createProject, openProject, switchProject } from './appProjectTools'
export { getAppState } from './appStateTools'
export {
  MAX_ENTRIES,
  NAME_CHARS,
  NO_PROJECT_AT_PATH_ERROR,
  NO_PROJECT_ON_SCREEN_ERROR,
  STILL_OPENING_ERROR,
  type AppState,
  type AppToolDeps,
  type DirectoryEntry,
  type ProjectRef,
} from './appToolSupport'

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
    switch_project: async ({ path }) => {
      if (typeof path !== 'string') return invalidArgument('path', 'a string')
      return switchProject(deps(), { path })
    },
    close_project: async () => closeProject(deps()),
  }
}
