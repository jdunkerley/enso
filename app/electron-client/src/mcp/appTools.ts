/** @file Definitions of the tools that work on the app: its projects, not one graph. The window runs them; main forwards. */
import { z } from 'zod'
import type { ToolDefinition } from './toolRegistry'
import { OPEN_TOOL_TIMEOUT_MS, WINDOW_TOOL_TIMEOUT_MS, type WindowBridge } from './windowBridge'

/** Most characters of a directory or project path. */
const PATH_CHARS = 1_000
/** Most characters of a project name. */
const NAME_CHARS = 100

export const APP_TOOL_NAMES = [
  'get_app_state',
  'list_projects',
  'list_files',
  'create_project',
  'open_project',
  'close_project',
] as const

/** The app tools, each forwarding its arguments to the window through `bridge`. */
export function appTools(bridge: Pick<WindowBridge, 'call'>): ToolDefinition[] {
  const forward =
    (name: string, timeoutMs: number = WINDOW_TOOL_TIMEOUT_MS): ToolDefinition['run'] =>
    (args, caller) =>
      bridge.call(name, args, caller, timeoutMs)
  return [
    {
      name: 'get_app_state',
      title: 'Get the app state',
      description:
        'Read what the Enso IDE is showing. Returns `page` (`dashboard`, `project`, `settings` ' +
        'or `logs`), `project` (the project on screen, `{ name, path }`, or null), ' +
        "`open_projects` (each project with a tab) and `drive_root` (the Drive's root folder). " +
        'Call it first when you do not know whether a project is open.',
      inputSchema: {},
      run: forward('get_app_state'),
    },
    {
      name: 'list_projects',
      title: 'List projects',
      description:
        "List the Enso projects in `directory` (it defaults to the Drive's root folder; it " +
        'must be that folder, a local folder the user added to the Drive, or inside one). ' +
        'Returns `{ directory, projects }`, each project `{ name, path, open }` (`open`: it ' +
        'has a tab), at most 500 with `truncated: true` beyond. Pass a `path` from the ' +
        'result to `open_project`.',
      inputSchema: { directory: z.string().max(PATH_CHARS).optional() },
      run: forward('list_projects'),
    },
    {
      name: 'list_files',
      title: 'List files',
      description:
        "List the files and folders in `directory` (it defaults to the Drive's root folder; " +
        'it must be that folder, a local folder the user added to the Drive, or inside one), ' +
        'to find a project or a data file to name in a node. Returns `{ directory, entries }`, ' +
        'each entry `{ name, path, kind, bytes }` (`kind`: `file`, `folder` or `project`; ' +
        '`bytes` for files only), at most 500 with `truncated: true` beyond.',
      inputSchema: { directory: z.string().max(PATH_CHARS).optional() },
      run: forward('list_files'),
    },
    {
      name: 'create_project',
      title: 'Create a project',
      description:
        'Create a new empty project called `name` in `directory` (it defaults to the ' +
        "Drive's root folder; it must be in the Drive, as for `list_projects`) and open it. " +
        'A name a project in that folder already has is refused. Returns `{ name, path }` ' +
        'when its graph is ready, so the project tools work on it at once. If it is still ' +
        'opening after 100 seconds, the error says so: call `get_app_state` a moment later.',
      inputSchema: {
        name: z.string().min(1).max(NAME_CHARS),
        directory: z.string().max(PATH_CHARS).optional(),
      },
      run: forward('create_project', OPEN_TOOL_TIMEOUT_MS),
    },
    {
      name: 'open_project',
      title: 'Open a project',
      description:
        "Open the project at `path`, a project's `path` from `list_projects` (a path outside " +
        'the Drive is refused). A project already open is brought on screen. Returns ' +
        '`{ name, path }` when its graph is ready, so the project tools work on it at once. ' +
        'If it is still opening after 100 seconds, the error says so: call `get_app_state` ' +
        'a moment later. If it fails to open, the error says why.',
      inputSchema: { path: z.string().max(PATH_CHARS) },
      run: forward('open_project', OPEN_TOOL_TIMEOUT_MS),
    },
    {
      name: 'close_project',
      title: 'Close the project on screen',
      description:
        'Close the project on screen, as when the user closes its tab. Edits already made ' +
        'are kept: the project is saved to disk as it is edited, and a save still pending is ' +
        'written as it closes. When the project keeps versions, closing also saves a version ' +
        '("Saved on close"); otherwise none is saved, and the user is not asked whether to ' +
        'start keeping them. It does not delete the project. Returns `{ closed, page, project }`: the ' +
        'project closed and what is on screen now (another tab, or the dashboard). An error ' +
        'when no project is on screen.',
      inputSchema: {},
      run: forward('close_project'),
    },
  ]
}
