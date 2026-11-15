/**
 * @file The text a user pastes into an agent app so it can reach the IDE's MCP server. Each shape
 * is the client's own documented way of adding a remote (HTTP) server with a bearer-token header.
 *
 * The shapes below are those known when this was written; they were not re-checked against the
 * vendors' current documentation (no web access then). See the "To verify" item in the spec.
 */
import type { McpClientKind } from 'enso-common/src/mcp'

/** The text to paste for a client: a shell command for claudeCode, TOML for codex, JSON for the rest. */
export function clientConfig(client: McpClientKind, url: string, token: string): string {
  const authorization = `Bearer ${token}`
  const server = { type: 'http', url, headers: { Authorization: authorization } }
  switch (client) {
    case 'claudeCode':
      // `claude mcp add --transport http <name> <url> --header "Name: value"`.
      return `claude mcp add --transport http enso ${url} --header "Authorization: ${authorization}"`
    case 'codex':
      // `~/.codex/config.toml`: `[mcp_servers.<name>]` with `url` and `http_headers`.
      return [
        '[mcp_servers.enso]',
        `url = ${JSON.stringify(url)}`,
        `http_headers = { "Authorization" = ${JSON.stringify(authorization)} }`,
        '',
      ].join('\n')
    case 'copilotVsCode':
      // VS Code `mcp.json`: servers live under `servers`.
      return JSON.stringify({ servers: { enso: server } }, null, 2)
    case 'copilotCli':
    case 'json':
      // Copilot CLI `mcp-config.json`, and the common `mcpServers` shape.
      return JSON.stringify({ mcpServers: { enso: server } }, null, 2)
  }
}
