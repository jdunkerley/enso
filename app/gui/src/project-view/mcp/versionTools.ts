/**
 * @file The version MCP tool, `save_version`: saves a version of the open project in its local git
 * repository, as the user's Save a version does. Pure functions over {@link VersionToolDeps}. It
 * changes no module, so it works in Live mode and does not go through the edit session (nor end the
 * agent's undo step). An agent never turns versioning on: the tool reads the project's status
 * first, and refuses unless versions are already kept for it, because `save` would otherwise offer
 * to set a repository up.
 */
import type { SaveVersionOutcome } from '$/providers/localVersioning'
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { callerLabel, NOT_ON_SCREEN_ERROR } from './editSession'
import { toolError } from './editTools'
import { jsonResult } from './graphTools'

/** Most characters of a version's comment. */
export const VERSION_COMMENT_MAX_CHARS = 500
/** The answer when versions are not kept for the project (no git, or not turned on for it). */
export const VERSIONS_NOT_KEPT_ERROR =
  'Versions are not kept for this project. The user can turn them on with Save a version.'
/** The answer when the project's versioning status has not been read, or could not be. */
export const VERSION_STATUS_UNKNOWN_ERROR =
  'Versions cannot be saved now: the status of the project’s versions is not known yet. Try again in a moment.'
/** The answer to a comment of more than one line. */
export const VERSION_COMMENT_LINES_ERROR = 'The comment must be one line.'
/** The answer to a comment that is too long. */
export const VERSION_COMMENT_LENGTH_ERROR = `The comment must be at most ${VERSION_COMMENT_MAX_CHARS} characters.`

/** What `save_version` reads and does. */
export interface VersionToolDeps {
  readonly caller: McpCaller
  /** Whether the project's editor is on screen; a hidden project answers nothing. */
  readonly isActive: () => boolean
  /** The project's versioning status as last read (`statusOf`); undefined while it is unknown. */
  readonly status: () => VersioningStatus | undefined
  /** Saves a version with the comment (`save`); never rejects. */
  readonly save: (comment: string) => Promise<SaveVersionOutcome>
}

/**
 * `save_version`: saves a version of the project with `comment`, or `Saved by <caller>` without
 * one. Refused (in this order) when the project is off screen, the comment has a line break or is
 * over {@link VERSION_COMMENT_MAX_CHARS} characters, the status is not known yet, git is not found
 * or versions are not kept for the project (the agent never turns them on), and the repository is
 * blocked. Answers `{ saved: true }`, or `{ saved: false, reason }` when nothing had changed since
 * the last version, or an error with the reason the save failed.
 */
export async function saveVersion(
  deps: VersionToolDeps,
  { comment }: { comment?: string },
): Promise<McpToolResult> {
  if (!deps.isActive()) return toolError(NOT_ON_SCREEN_ERROR)
  if (comment != null) {
    if (/[\r\n]/.test(comment)) return toolError(VERSION_COMMENT_LINES_ERROR)
    if (comment.length > VERSION_COMMENT_MAX_CHARS) return toolError(VERSION_COMMENT_LENGTH_ERROR)
  }
  const status = deps.status()
  if (status == null) return toolError(VERSION_STATUS_UNKNOWN_ERROR)
  // Like `canSave`, but `enabled` must hold: `canSave` is true for a project whose versions are
  // off, because the user's save then offers to turn them on.
  if (!status.git || !status.enabled) return toolError(VERSIONS_NOT_KEPT_ERROR)
  if (status.blocked != null) {
    return toolError(`Versions cannot be saved now: ${status.blocked}.`)
  }
  const trimmed = comment?.trim() ?? ''
  const outcome = await deps.save(trimmed === '' ? `Saved by ${callerLabel(deps.caller)}` : trimmed)
  switch (outcome.kind) {
    case 'saved':
      return jsonResult({ saved: true })
    case 'nothingToSave':
      return jsonResult({ saved: false, reason: 'nothing has changed since the last version' })
    case 'failed':
      return toolError(`Could not save a version: ${outcome.reason}.`)
  }
}
