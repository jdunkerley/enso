/** @file Shared API types exposed on `window.api` for both GUI and Electron. */
import type { DownloadUrlOptions } from 'enso-common/src/download'
import type { JvmAotTrainingStatus } from 'enso-common/src/jvmAot'
import type {
  ClaudeDesktopStatus,
  McpClientKind,
  McpStatus,
  McpToolCallReply,
  McpToolCallRequest,
} from 'enso-common/src/mcp'
import type { Path } from 'enso-common/src/services/Backend'
import type { UpdateMode, UpdateStatus } from 'enso-common/src/updater'
import type { FileFilter } from './project-view/util/fileFilter'
import type { MenuItem, MenuItemHandler } from './project-view/util/menuItems'

export interface NavigationApi {
  readonly goBack: () => void
  readonly goForward: () => void
}

export interface MenuApi {
  readonly setMenuItemHandler: (name: MenuItem, callback: MenuItemHandler) => void
}

export interface SystemApi {
  readonly downloadURL: (options: DownloadUrlOptions) => Promise<void>
  readonly showItemInFolder: (fullPath: string) => void
  /** Reveal an engine log file; main refuses anything but a file under the engine log directory. */
  readonly showLogFileInFolder: (fullPath: string) => void
  readonly getFilePath: (item: File) => string
}

export interface FileBrowserApi {
  readonly openFileBrowser: (
    kind: 'default' | 'directory' | 'file' | 'filePath',
    defaultPath?: string,
    fileTypes?: FileFilter[],
  ) => Promise<string[] | undefined>
}

export interface ProjectInfo {
  readonly id: string
  readonly name: string
  readonly projectRoot: Path
  readonly parentDirectory: string
}

export interface ProjectManagementApi {
  readonly setOpenProjectHandler: (handler: (projectInfo: ProjectInfo) => void) => void
}

export interface VersionInfo {
  readonly version: string
  readonly build: string
  readonly electron: string
  readonly chrome: string
}

export interface LogApi {
  readonly log: (msg: any[]) => void
  readonly info: (msg: any[]) => void
  readonly warn: (msg: any[]) => void
  readonly error: (msg: any[]) => void
}

/** Automatic updates; see `app/electron-client/src/updater.ts`. */
export interface UpdaterApi {
  readonly mode: () => Promise<UpdateMode>
  readonly check: (allowPrerelease: boolean) => Promise<UpdateStatus>
  readonly download: () => Promise<void>
  readonly quitAndInstall: () => Promise<void>
  /** Subscribe to status changes. Returns a disposer. */
  readonly onStatus: (handler: (status: UpdateStatus) => void) => () => void
}

/**
 * The local secrets key, which only Electron main holds; see `app/electron-client/src/secretsKey.ts`.
 * The key's status comes from the shim's `secrets/status` route instead.
 */
export interface SecretsApi {
  /**
   * Copy the key to the clipboard. Main writes it, so the key never reaches the renderer.
   * Resolves `false` when there is no key.
   */
  readonly copyKey: () => Promise<boolean>
  /**
   * Delete the secrets file and the key, then create a new key. Rejects while any project is
   * running (see {@link isSecretsBlockedByProjects}).
   */
  readonly reset: () => Promise<void>
  /**
   * Replace the key with a new one, re-encrypting every secret. Rejects while any project is
   * running (see {@link isSecretsBlockedByProjects}), and when the key comes from
   * `ENSO_SECRETS_KEY`.
   */
  readonly rotate: () => Promise<void>
}

/** The JDK AOT cache's training at this launch; see `app/electron-client/src/jvmAotIpc.ts`. */
export interface JvmAotApi {
  /** The current status, for a window that loads while a training runs. */
  readonly trainingStatus: () => Promise<JvmAotTrainingStatus>
  /** Subscribe to status changes. Returns a disposer. */
  readonly onTrainingStatus: (handler: (status: JvmAotTrainingStatus) => void) => () => void
}

/**
 * The messages Electron main rejects `secrets.rotate` and `secrets.reset` with while a project is
 * running; they mirror `ROTATE_BLOCKED_BY_PROJECTS` and `RESET_BLOCKED_BY_PROJECTS` in
 * `app/electron-client/src/secretsKey.ts`. Electron prefixes a rejected IPC call's message, so
 * match with {@link isSecretsBlockedByProjects}, then show the localized text.
 */
const SECRETS_BLOCKED_BY_PROJECTS = {
  rotate: 'Close open projects to rotate the key.',
  reset: 'Close open projects to reset your secrets.',
} as const

/** Whether `error` is main refusing `secrets[action]` because a project is running. */
export function isSecretsBlockedByProjects(
  error: unknown,
  action: keyof typeof SECRETS_BLOCKED_BY_PROJECTS,
): boolean {
  return error instanceof Error && error.message.endsWith(SECRETS_BLOCKED_BY_PROJECTS[action])
}

/** The IDE's MCP server, which Electron main runs; see `app/electron-client/src/mcp/`. */
export interface McpApi {
  readonly onToolCall: (handler: (request: McpToolCallRequest) => void) => () => void
  readonly replyToolCall: (reply: McpToolCallReply) => void
  readonly status: () => Promise<McpStatus>
  readonly onStatusChanged: (handler: (status: McpStatus) => void) => () => void
  readonly setEnabled: (enabled: boolean) => Promise<McpStatus>
  readonly setPort: (port: number) => Promise<McpStatus>
  readonly replaceToken: () => Promise<McpStatus>
  /** Main writes the client's config, token included, to the clipboard. */
  readonly copyConfig: (client: McpClientKind) => Promise<void>
  /** Where Claude Desktop's configuration file stands. Main reads it; the token never comes here. */
  readonly claudeDesktopStatus: () => Promise<ClaudeDesktopStatus>
  /** Main adds the `enso` entry to Claude Desktop's configuration file, and returns the new status. */
  readonly setUpClaudeDesktop: () => Promise<ClaudeDesktopStatus>
}

export interface ElectronApi {
  readonly navigation: NavigationApi
  readonly menu: MenuApi
  readonly system?: SystemApi
  readonly projectManagement: ProjectManagementApi
  readonly fileBrowser: FileBrowserApi
  readonly versionInfo: VersionInfo
  readonly log: LogApi
  readonly updater: UpdaterApi
  readonly secrets: SecretsApi
  readonly mcp?: McpApi
  /** Absent outside Electron: in the browser build, nothing trains. */
  readonly jvmAot?: JvmAotApi
}
export type { FileFilter, MenuItem, MenuItemHandler }
