/** @file Shared types for the IDE's MCP server, which lets external agent apps read the open project. */

/** Who called a tool: the in-app chat, or an external client by its MCP name. */
export type McpCaller =
  { readonly kind: 'chat' } | { readonly kind: 'external'; readonly name: string }

export type McpToolResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string }

/** Main → window. `args` has passed the tool's schema. */
export interface McpToolCallRequest {
  readonly requestId: string
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly caller: McpCaller
  /**
   * How long main waits for the reply before it answers the caller that the call timed out. The
   * window must not apply an edit after that: it refuses a run whose turn comes too late.
   */
  readonly timeoutMs: number
}

/** Window → main. */
export interface McpToolCallReply {
  readonly requestId: string
  readonly result: McpToolResult
}

export const MCP_DEFAULT_PORT = 39417

export interface McpStatus {
  readonly enabled: boolean
  readonly port: number
  /** True while the server is listening. */
  readonly running: boolean
  /** Why an enabled server is not running (port taken, the token or settings file could not be written). */
  readonly error: string | null
  /**
   * True while `ENSO_MCP_ENABLED` or `ENSO_MCP_PORT` is in effect: the switch and the port are then
   * fixed, and changing either is refused.
   */
  readonly lockedByEnvironment: boolean
}

export const MCP_CLIENT_KINDS = [
  'claudeCode',
  'claudeDesktop',
  'codex',
  'copilotVsCode',
  'copilotCli',
  'json',
] as const
export type McpClientKind = (typeof MCP_CLIENT_KINDS)[number]

/** Where Claude Desktop's configuration file stands, for the Settings "Claude Desktop" block. */
export type ClaudeDesktopSetup =
  /** Claude Desktop's configuration folder does not exist. */
  | { readonly state: 'notInstalled' }
  /** The folder exists; the file has no `enso` entry. */
  | { readonly state: 'notSetUp' }
  /** An `enso` entry with the current address and token. */
  | { readonly state: 'setUp' }
  /** An `enso` entry with another address or token. */
  | { readonly state: 'outOfDate' }
  /** The file cannot be used (not valid JSON, not the expected shape). */
  | { readonly state: 'unreadable'; readonly reason: string }

/**
 * What the Settings block is given: the state, and the full path of Claude Desktop's configuration
 * file for the instructions (null on a platform without Claude Desktop). The path is shown whether
 * or not the file or its folder exists yet.
 */
export type ClaudeDesktopStatus = ClaudeDesktopSetup & { readonly configFile: string | null }
