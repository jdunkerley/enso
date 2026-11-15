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
  /** Why an enabled server is not running (port taken, no keychain). */
  readonly error: string | null
}

export const MCP_CLIENT_KINDS = [
  'claudeCode',
  'codex',
  'copilotVsCode',
  'copilotCli',
  'json',
] as const
export type McpClientKind = (typeof MCP_CLIENT_KINDS)[number]
