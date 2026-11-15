/** @file The text each MCP client is given to connect to the IDE (`src/mcp/clientConfigs.ts`). */
import { MCP_CLIENT_KINDS } from 'enso-common/src/mcp'
import { describe, expect, test } from 'vitest'

import { clientConfig } from '../../src/mcp/clientConfigs'

const URL = 'http://127.0.0.1:39417/mcp'
const TOKEN = 'tok-123_abc'

describe('clientConfig', () => {
  test.each(MCP_CLIENT_KINDS)('%s contains the URL and the token', (kind) => {
    const text = clientConfig(kind, URL, TOKEN)
    expect(text).toContain(URL)
    expect(text).toContain(TOKEN)
  })

  test('claudeCode is a shell command', () => {
    expect(clientConfig('claudeCode', URL, TOKEN)).toBe(
      `claude mcp add --transport http enso ${URL} --header "Authorization: Bearer ${TOKEN}"`,
    )
  })

  test('codex is TOML', () => {
    const text = clientConfig('codex', URL, TOKEN)
    expect(text).toContain('[mcp_servers.enso]')
    expect(text).toContain(`url = "${URL}"`)
    expect(text).toContain(`http_headers = { "Authorization" = "Bearer ${TOKEN}" }`)
  })

  test('copilotVsCode is JSON under "servers"', () => {
    const parsed: unknown = JSON.parse(clientConfig('copilotVsCode', URL, TOKEN))
    expect(parsed).toEqual({
      servers: {
        enso: { type: 'http', url: URL, headers: { Authorization: `Bearer ${TOKEN}` } },
      },
    })
  })

  test.each(['copilotCli', 'json'] as const)('%s is JSON under "mcpServers"', (kind) => {
    const parsed: unknown = JSON.parse(clientConfig(kind, URL, TOKEN))
    expect(parsed).toEqual({
      mcpServers: {
        enso: { type: 'http', url: URL, headers: { Authorization: `Bearer ${TOKEN}` } },
      },
    })
  })
})
