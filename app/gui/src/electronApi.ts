/** @file Shared API types exposed on `window.api` for both GUI and Electron. */
import type * as saveAccessToken from 'enso-common/src/accessToken'
import type {
  AiAvailability,
  AiComponentIpcReply,
  AiComponentRequest,
  AiProgressEvent,
  AiToolCallReply,
  AiToolCallRequest,
} from 'enso-common/src/ai'
import type { DownloadUrlOptions } from 'enso-common/src/download'
import type { Path } from 'enso-common/src/services/Backend'
import type { FileFilter } from './project-view/util/fileFilter'
import type { MenuItem, MenuItemHandler } from './project-view/util/menuItems'

export interface AuthenticationApi {
  readonly openUrlInSystemBrowser: (url: string) => void
  readonly setDeepLinkHandler: (callback: (url: string) => void) => void
  readonly saveAccessToken: (accessToken: saveAccessToken.AccessToken | null) => void
}

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

export interface AiApi {
  /**
   * The local Claude agent's current availability: `starting` until its priming turn completes,
   * `ready` once the agent can serve turns, `unavailable` (with a displayable reason) when the
   * `claude` CLI is missing, failed to prime, or was disabled via `ENSO_AI_DISABLED=1`.
   * Availability changes over the life of the process — {@link AiApi.onAvailabilityChanged}
   * carries the updates, and {@link useAiAvailability} keeps both in one reactive store.
   */
  readonly availability: () => Promise<AiAvailability>
  /** Subscribe to {@link AiApi.availability} changes. Returns a disposer. */
  readonly onAvailabilityChanged: (handler: (availability: AiAvailability) => void) => () => void
  readonly generateComponent: (request: AiComponentRequest) => Promise<AiComponentIpcReply>
  /**
   * Subscribe to mid-turn tool calls; the handler must reply via {@link AiApi.replyToolCall}
   * with the matching `requestId`. Returns a disposer.
   */
  readonly onToolCall: (handler: (request: AiToolCallRequest) => void) => () => void
  readonly replyToolCall: (reply: AiToolCallReply) => void
  /**
   * Subscribe to live progress events for in-flight AI component requests.
   */
  readonly onProgress: (handler: (event: AiProgressEvent) => void) => () => void
  /**
   * Cancel an in-flight or queued AI component request. Settles the original
   * `generateComponent` promise with a structured cancellation error. Idempotent — cancelling
   * an unknown id is a no-op.
   */
  readonly cancel: (requestId: string) => void
}

export interface ElectronApi {
  readonly authentication: AuthenticationApi
  readonly navigation: NavigationApi
  readonly menu: MenuApi
  readonly system?: SystemApi
  readonly projectManagement: ProjectManagementApi
  readonly fileBrowser: FileBrowserApi
  readonly versionInfo: VersionInfo
  readonly log: LogApi
  readonly ai: AiApi
}
export type { FileFilter, MenuItem, MenuItemHandler }
