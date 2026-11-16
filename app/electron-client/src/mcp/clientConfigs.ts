/**
 * @file The text a user pastes into an agent app so it can reach the IDE's MCP server. Each shape
 * is the client's own documented way of adding a remote (HTTP) server with a bearer-token header.
 * Each case names the documentation it was checked against (read on 2026-11-15).
 */
import type { McpClientKind } from 'enso-common/src/mcp'
import { claudeDesktopEntry } from './claudeDesktop'

/** The text to paste for a client: a shell command for claudeCode, TOML for codex, JSON for the rest. */
export function clientConfig(client: McpClientKind, url: string, token: string): string {
  const authorization = `Bearer ${token}`
  const server = { type: 'http', url, headers: { Authorization: authorization } }
  switch (client) {
    case 'claudeCode':
      // https://code.claude.com/docs/en/mcp (2026-11-15): the docs' example has `--transport`
      // before the name and `--header` after the URL.
      return `claude mcp add --transport http enso ${url} --header "Authorization: ${authorization}"`
    case 'claudeDesktop':
      // Confirmed working against Claude Desktop on Windows by the owner on 2026-11-15: it runs
      // the `mcp-remote` bridge from `claude_desktop_config.json`. The token is in `env`, not in
      // an argument, because Claude Desktop on Windows mishandles arguments that contain spaces
      // ("Bearer <token>"). (Its "Add custom connector" screen does not work: it connects from
      // Anthropic's servers.)
      return JSON.stringify({ mcpServers: { enso: claudeDesktopEntry(url, token) } }, null, 2)
    case 'codex':
      // https://developers.openai.com/codex/mcp (2026-11-15): `[mcp_servers.<name>]` in
      // `~/.codex/config.toml`; `http_headers` is a "map of header names to static values". The
      // docs show `http_headers` only with a non-auth header, so carrying `Authorization` there is
      // documented in principle but not shown. The documented alternative is `bearer_token_env_var`
      // (an environment variable name, which a paste cannot carry). `tool_timeout_sec` ("Timeout
      // (seconds) for the server to run a tool. Default: `60`.", the same page, now served at
      // https://learn.chatgpt.com/docs/extend/mcp?surface=cli, read 2026-11-15) is raised to 120:
      // the IDE gives an edit 60 s and an open 120 s, and a client that gives up first would retry
      // an edit that is still running.
      return [
        '[mcp_servers.enso]',
        `url = ${JSON.stringify(url)}`,
        `http_headers = { "Authorization" = ${JSON.stringify(authorization)} }`,
        'tool_timeout_sec = 120',
        '',
      ].join('\n')
    case 'copilotVsCode':
      // https://code.visualstudio.com/docs/agents/reference/mcp-configuration (2026-11-15):
      // `.vscode/mcp.json` or the user `mcp.json`; servers live under `servers`.
      return JSON.stringify({ servers: { enso: server } }, null, 2)
    case 'copilotCli':
      // https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
      // (2026-11-15): `~/.copilot/mcp-config.json`. Its example includes `tools`; the docs do not
      // say whether it is required, so `["*"]` (all tools) is included.
      return JSON.stringify({ mcpServers: { enso: { ...server, tools: ['*'] } } }, null, 2)
    case 'json':
      // The generic `mcpServers` block, which is also the `.mcp.json` shape Claude Code documents
      // (https://code.claude.com/docs/en/mcp, 2026-11-15).
      return JSON.stringify({ mcpServers: { enso: server } }, null, 2)
  }
}
