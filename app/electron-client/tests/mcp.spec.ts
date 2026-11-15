/**
 * @file The IDE's MCP server, end to end: an MCP client connects to the packaged app as an agent
 * app would, and reads the open project through the tools. The server is turned on by the
 * environment (`ENSO_MCP_ENABLED`, `ENSO_MCP_PORT`, `ENSO_MCP_TOKEN`; `src/mcp/mcpController.ts`),
 * so this spec never touches the settings file's choice or the system keychain.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect } from 'playwright/test'
import { createNewProject, test, waitForDashboard } from './electronTest'

const TOKEN = 'test-token'

/** A port nothing listens on now: the OS picks one, and it is released at once. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address != null ?
          resolve(address.port)
        : reject(new Error('No port')),
      )
    })
  })
}

const PORT = await freePort()
const MCP_URL = `http://127.0.0.1:${PORT}/mcp`

test.use({
  extraEnv: { ENSO_MCP_ENABLED: '1', ENSO_MCP_PORT: String(PORT), ENSO_MCP_TOKEN: TOKEN },
})

/** The text of a tool result's single text item. */
function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as { type: string; text?: string }[]
  expect(content).toHaveLength(1)
  expect(content[0]?.type).toBe('text')
  return content[0]?.text ?? ''
}

test('an MCP client reads the open project and cannot write a file', async ({
  page,
  testRunId,
}, testInfo) => {
  await waitForDashboard(page)
  await createNewProject(page)

  const client = new Client({ name: 'enso-packaged-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }) as Parameters<Client['connect']>[0],
  )
  try {
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args })

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'evaluate_expression',
        'get_component_docs',
        'get_graph',
        'get_guide',
        'get_node',
        'search_components',
      ].sort(),
    )

    const guide = await call('get_guide', {})
    expect(guide.isError).toBeFalsy()
    expect(textOf(guide)).toContain('get_graph')

    const graphResult = await call('get_graph', {})
    expect(graphResult.isError, textOf(graphResult)).toBeFalsy()
    const graph = JSON.parse(textOf(graphResult)) as { nodes: unknown[]; source: string }
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.source).toContain('main')

    // The suggestion database may still be loading just after the open: it answers an error then.
    await expect
      .poll(
        async () => {
          const found = await call('search_components', { query: 'read' })
          if (found.isError) return []
          const { results } = JSON.parse(textOf(found)) as { results: { name: string }[] }
          return results.map((result) => result.name)
        },
        { timeout: 60_000 },
      )
      .toContainEqual(expect.stringMatching(/read$/))

    const sum = await call('evaluate_expression', { expression: '(1 + 2).to_text' })
    expect(sum.isError, textOf(sum)).toBeFalsy()
    expect(textOf(sum)).toBe('3')

    // The Write rule: evaluation runs in the Design environment, where the output context is off,
    // so an expression cannot write a file. An error answer is fine; the assertion is on the file.
    const target = path.join(os.tmpdir(), `enso-mcp-write-rule-${Date.now()}.txt`)
    await fs.rm(target, { force: true })
    const enso = target.replace(/\\/g, '/')
    const write = await call('evaluate_expression', {
      expression: `("x".write "${enso}").to_text`,
    })
    const answer = `isError=${String(write.isError ?? false)}: ${textOf(write)}`
    console.log(`[${testRunId}] Write rule: evaluate_expression answered ${answer}`)
    await testInfo.attach('write-rule-answer', { body: answer, contentType: 'text/plain' })
    // Give a write that the engine might finish late a moment to land.
    await page.waitForTimeout(2_000)
    const written = existsSync(target)
    await fs.rm(target, { force: true })
    expect(written, `${target} must not exist; the tool answered ${answer}`).toBe(false)
  } finally {
    await client.close()
  }

  const anonymous = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  expect(anonymous.status).toBe(401)
})
