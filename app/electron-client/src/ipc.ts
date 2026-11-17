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
  /** Reveal an engine log file; main accepts only a file under the engine log directory. */
  showLogFileInFolder = 'show-log-file-in-folder',
  /** Download a file using its URL. */
  downloadURL = 'download-url',
  handleMenuItem = 'handle-menu-item',
  /** Main → renderer: an MCP tool call the window must run; it replies with the same `requestId`. */
  mcpToolCall = 'mcp-tool-call',
  /** Renderer → main: reply to a previously-issued {@link Channel.mcpToolCall}. */
  mcpToolReply = 'mcp-tool-reply',
  /** Renderer → main: query the MCP server's `McpStatus` (from `enso-common/src/mcp`). */
  mcpStatus = 'mcp-status',
  /** Main → renderer: broadcast whenever the MCP server's `McpStatus` changes. */
  mcpStatusChanged = 'mcp-status-changed',
  /** Renderer → main: enable or disable the MCP server; resolves with the new `McpStatus`. */
  mcpSetEnabled = 'mcp-set-enabled',
  /** Renderer → main: change the MCP server's port; resolves with the new `McpStatus`. */
  mcpSetPort = 'mcp-set-port',
  /** Renderer → main: replace the MCP bearer token; resolves with the new `McpStatus`. */
  mcpReplaceToken = 'mcp-replace-token',
  /** Renderer → main: write an MCP client's config, token included, to the clipboard. */
  mcpCopyConfig = 'mcp-copy-config',
  /** Renderer → main: where Claude Desktop's configuration stands (a `ClaudeDesktopSetup`). */
  mcpClaudeDesktopStatus = 'mcp-claude-desktop-status',
  /** Renderer → main: add the IDE's entry to Claude Desktop's configuration; resolves with the new `ClaudeDesktopSetup`. */
  mcpClaudeDesktopSetUp = 'mcp-claude-desktop-set-up',
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
   * Renderer → main: query this launch's JDK AOT cache training (`JvmAotTrainingStatus` from
   * `enso-common/src/jvmAot`), so that a window loaded mid-training learns of it.
   */
  jvmAotTrainingStatus = 'jvm-aot-training-status',
  /** Main → renderer: broadcast whenever the JDK AOT cache training's status changes. */
  jvmAotTrainingStatusChanged = 'jvm-aot-training-status-changed',
  /**
   * Renderer → main: copy the local secrets key to the clipboard. Main writes the clipboard itself,
   * so the key never reaches the renderer; resolves `false` when there is no key.
   */
  secretsCopyKey = 'secrets-copy-key',
  /**
   * Renderer → main: delete the local secrets file and key, then create a new key. Rejects while
   * any project is running.
   */
  secretsReset = 'secrets-reset',
  /**
   * Renderer → main: rotate the local secrets key, re-encrypting the file. Rejects while any
   * project is running, and when the key comes from `ENSO_SECRETS_KEY`.
   */
  secretsRotate = 'secrets-rotate',
}
