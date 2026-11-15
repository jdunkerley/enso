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
        'Read what the Enso IDE is showing: whether a project is open on screen, and which. ' +
        'Call it first when you do not know whether a project is open.',
      inputSchema: {},
      run: forward('get_app_state'),
    },
    {
      name: 'list_projects',
      title: 'List projects',
      description:
        "List the Enso projects on disk in `directory` (it defaults to the Drive's root " +
        'folder). Each result has `name`, `path` and `open`. Pass a `path` from the result ' +
        'to `open_project`.',
      inputSchema: { directory: z.string().max(PATH_CHARS).optional() },
      run: forward('list_projects'),
    },
    {
      name: 'list_files',
      title: 'List files',
      description:
        "List the files and folders in `directory` (it defaults to the Drive's root folder), " +
        'to find a project or a data file to name in a node.',
      inputSchema: { directory: z.string().max(PATH_CHARS).optional() },
      run: forward('list_files'),
    },
    {
      name: 'create_project',
      title: 'Create a project',
      description:
        'Create a new empty project called `name` in `directory` (it defaults to the ' +
        "Drive's root folder) and open it. Returns when its graph is ready, so the " +
        'project tools work on it at once.',
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
        "Open the project at `path`, a project's `path` from `list_projects`. Returns when its graph is " +
        'ready, so the project tools work on it at once.',
      inputSchema: { path: z.string().max(PATH_CHARS) },
      run: forward('open_project', OPEN_TOOL_TIMEOUT_MS),
    },
    {
      name: 'close_project',
      title: 'Close the project on screen',
      description:
        'Close the project on screen, as when the user closes its tab. It does not delete ' +
        'the project.',
      inputSchema: {},
      run: forward('close_project'),
    },
  ]
}
