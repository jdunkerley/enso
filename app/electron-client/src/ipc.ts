/**
 * @file Inter-Process communication configuration of the application. IPC allows the web-view
 * content to exchange information with the Electron application.
 */

// ===============
// === Channel ===
// ===============

/** Channel names used by the IPC protocol. */
export enum Channel {
  /** Channels for passing log messages from renderer to main process. */
  log = 'log',
  info = 'info',
  warn = 'warn',
  error = 'error',
  /** Channel for importing a project or project bundle from the given path. */
  importProjectFromPath = 'import-project-from-path',
  /** Channel for opening project */
  openProject = 'open-project',
  goBack = 'go-back',
  goForward = 'go-forward',
  /** Channel for selecting files and directories using the system file browser. */
  openFileBrowser = 'open-file-browser',
  /** Show a file or folder in the system file browser. */
  showItemInFolder = 'show-item-in-folder',
  /** Download a file using its URL. */
  downloadURL = 'download-url',
  handleMenuItem = 'handle-menu-item',
  /** Run the local Claude agent to generate a User Defined Component body. */
  generateAiComponent = 'generate-ai-component',
  /** Main → renderer: tool call from the in-flight Claude turn; the renderer must echo `requestId`. */
  aiToolCall = 'ai-tool-call',
  /** Renderer → main: reply to a previously-issued {@link Channel.aiToolCall}. */
  aiToolReply = 'ai-tool-reply',
  /**
   * Main → renderer: live progress events while a Claude turn runs. Each carries the originating
   * request's id so the renderer can route to the correct placeholder. Payload shape is
   * {@link AiProgressEvent} from `enso-common/src/ai`.
   */
  aiProgress = 'ai-progress',
  /**
   * Renderer → main: cancel an in-flight or queued AI component request, identified by the
   * `requestId` carried in the original {@link generateAiComponent} payload.
   */
  cancelAiComponent = 'cancel-ai-component',
  /**
   * Renderer → main: query whether the local Claude agent can serve turns. Resolves with the
   * current `AiAvailability` snapshot (from `enso-common/src/ai`) — `starting` until the
   * priming turn completes, and always `unavailable` when `ENSO_AI_DISABLED=1` is set in the
   * main process environment.
   */
  aiAvailability = 'ai-availability',
  /**
   * Main → renderer: broadcast whenever the local Claude agent's `AiAvailability`
   * changes — priming completing, the child crashing, a context rotation. Sent to every live
   * renderer, since availability is process-wide rather than per-request.
   */
  aiAvailabilityChanged = 'ai-availability-changed',
  /** Renderer → main: query the update mode (`auto` or `manual`). */
  updaterMode = 'updater-mode',
  /** Renderer → main: check for an update; resolves with the resulting `UpdateStatus`. */
  updaterCheck = 'updater-check',
  /** Renderer → main: download the update found by the last check. */
  updaterDownload = 'updater-download',
  /** Renderer → main: quit and install the downloaded update. */
  updaterQuitAndInstall = 'updater-quit-and-install',
  /** Main → renderer: broadcast whenever the `UpdateStatus` changes. */
  updaterStatus = 'updater-status',
  /**
   * Renderer → main: copy the local secrets key to the clipboard. Main writes the clipboard itself,
   * so the key never reaches the renderer; resolves `false` when there is no key.
   */
  secretsCopyKey = 'secrets-copy-key',
  /** Renderer → main: delete the local secrets file and key, then create a new key. */
  secretsReset = 'secrets-reset',
}
