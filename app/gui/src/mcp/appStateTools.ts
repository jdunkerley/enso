/** @file `get_app_state`, the MCP app tool that says what the IDE is showing. */
/* eslint-disable camelcase -- result names are snake_case on the wire */
import { jsonResult } from '@/mcp/graphTools'
import type { McpToolResult } from 'enso-common/src/mcp'
import { projectRef, type AppToolDeps } from './appToolSupport'

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
