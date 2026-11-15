/**
 * @file The IDE's MCP server, end to end: an MCP client connects to the packaged app as an agent
 * app would, reads the open project through the tools, and builds a project from the dashboard
 * against the real engine. The server is turned on by the environment (`ENSO_MCP_ENABLED`,
 * `ENSO_MCP_PORT`, `ENSO_MCP_TOKEN`; `src/mcp/mcpController.ts`), so this spec never touches the
 * settings file's choice or the system keychain.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
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

/** An SDK client connected to the app's MCP server with the test's token. */
async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'enso-packaged-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }) as Parameters<Client['connect']>[0],
  )
  return client
}

test('an MCP client reads the open project and cannot write a file', async ({
  page,
  testRunId,
}, testInfo) => {
  await waitForDashboard(page)
  await createNewProject(page)

  const client = await connectClient()
  try {
    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args })

    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'get_guide',
        // The project tools that read.
        'evaluate_expression',
        'get_component_docs',
        'get_graph',
        'get_node',
        'search_components',
        // The project tools that edit or navigate.
        'add_function',
        'add_nodes',
        'collapse_nodes',
        'edit_node',
        'open_method',
        'remove_nodes',
        'select_nodes',
        'set_node_comment',
        'set_visualization',
        // The app tools.
        'close_project',
        'create_project',
        'get_app_state',
        'list_files',
        'list_projects',
        'open_project',
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

    // The Write rule: evaluation runs only in the Design environment, where the output context is
    // off, so an expression cannot write the file it names. The standard library's dry run writes
    // the data to `<name>_ensodryrun<digits>.<ext>` in the temporary directory instead and returns
    // that path; the test deletes it. (The project cannot be switched to Live from the UI, so the
    // Live refusal is covered by the unit tests in `app/gui/src/project-view/mcp/__tests__`.)
    const target = path.join(os.tmpdir(), `enso-mcp-write-rule-${Date.now()}.txt`)
    await fs.rm(target, { force: true })
    const enso = target.replace(/\\/g, '/')
    const write = await call('evaluate_expression', {
      expression: `("x".write "${enso}").to_text`,
    })
    const answer = `isError=${String(write.isError ?? false)}: ${textOf(write)}`
    console.log(`[${testRunId}] Write rule: evaluate_expression answered ${answer}`)
    await testInfo.attach('write-rule-answer', { body: answer, contentType: 'text/plain' })
    const dryRun = /\S*_ensodryrun\d+\.txt/.exec(textOf(write))?.[0]
    try {
      expect(write.isError, answer).toBeFalsy()
      expect(dryRun, `the answer names the dry-run file: ${answer}`).toBeDefined()
      // Give a write that the engine might finish late a moment to land.
      await page.waitForTimeout(2_000)
      expect(existsSync(target), `${target} must not exist; the tool answered ${answer}`).toBe(
        false,
      )
    } finally {
      await fs.rm(target, { force: true })
      if (dryRun != null) await fs.rm(dryRun, { force: true })
    }
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

interface NodeSummary {
  id: string
  name: string | null
  code: string
  type: string | null
  state: string
  message?: string
  comment?: string
  preview?: string
}

interface Graph {
  method: string
  source: string
  imports: string[]
  nodes: NodeSummary[]
  selection: string[]
}

/** How quickly an edit that runs code must answer, against its 20 s settle timeout. */
const EDIT_ANSWER_MS = 10_000

/** The states of a node that is neither an error nor a panic. */
const NOT_FAILED = ['value', 'pending', 'unknown']

test('an MCP client builds a project from the dashboard', async ({ page, testRunId }) => {
  // A cold engine's first execution of a new project, about twenty edits each waiting for its
  // execution, an 11 s pause, and a close and reopen.
  test.setTimeout(600_000)
  await waitForDashboard(page)

  const client = await connectClient()
  /** How long the last tool call took. */
  let lastCallMs = 0
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const start = Date.now()
    const result = await client.callTool({ name, arguments: args })
    lastCallMs = Date.now() - start
    return result
  }
  /** Logs a step's key result and time: the record of what the real engine answered. */
  const note = (step: string, value: unknown) =>
    console.log(`[${testRunId}] ${step} (${lastCallMs} ms): ${JSON.stringify(value)}`)
  /** The tool's text; fails the test on an error. */
  const callText = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await callTool(name, args)
    expect(result.isError, `${name} ${JSON.stringify(args)}: ${textOf(result)}`).toBeFalsy()
    return textOf(result)
  }
  /** The tool's value, parsed; fails the test on an error. */
  const callJson = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> =>
    JSON.parse(await callText(name, args)) as T
  /** The tool's error text; fails the test when the call succeeds. */
  const callError = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await callTool(name, args)
    expect(result.isError, `${name} must be refused: ${textOf(result)}`).toBe(true)
    return textOf(result)
  }
  const getGraph = () => callJson<Graph>('get_graph', {})
  const names = (graph: Graph) => graph.nodes.map((node) => node.name)
  const nodeNamed = (graph: Graph, name: string): NodeSummary => {
    const node = graph.nodes.find((n) => n.name === name)
    expect(node, `a node named ${name} in ${JSON.stringify(graph.nodes)}`).toBeDefined()
    return node!
  }
  /**
   * The edit that was just called saw the engine finish executing it (`settled`), and answered well
   * inside the 20 s settle timeout: it took 0.8-2.1 s on a desktop (an edit with no node-database
   * update waits out the 2 s graph wait), against 20-22 s when the execution was missed.
   */
  const expectSettled = (step: string, result: { settled?: boolean }) => {
    expect(result.settled, `${step}: settled`).toBe(true)
    expect(lastCallMs, `${step}: answered in time`).toBeLessThan(EDIT_ANSWER_MS)
  }
  const previewOf = async (nodeId: string) =>
    (await callJson<NodeSummary>('get_node', { node_id: nodeId })).preview ?? ''

  let projectPath: string | undefined
  try {
    // 1. The dashboard, the projects on the Drive, and a new project.
    const dashboard = await callJson<{ page: string; project: unknown; open_projects: unknown[] }>(
      'get_app_state',
    )
    note('get_app_state on the dashboard', dashboard)
    expect(dashboard.page).toBe('dashboard')
    expect(dashboard.project).toBeNull()
    expect(dashboard.open_projects).toEqual([])
    const listed = await callJson<{ directory: string; projects: unknown[] }>('list_projects')
    note('list_projects', listed)

    const projectName = 'Mcp_Build'
    const created = await callJson<{ name: string; path: string }>('create_project', {
      name: projectName,
    })
    note('create_project', created)
    expect(created.name).toBe(projectName)
    projectPath = created.path
    const onScreen = await callJson<{ page: string; project: unknown }>('get_app_state')
    note('get_app_state after create_project', onScreen)
    expect(onScreen.page).toBe('project')
    expect(onScreen.project).toEqual(created)

    // The template's first execution, so that each edit below settles in its 20 s.
    await expect
      .poll(async () => (await getGraph()).nodes.map((node) => node.state), { timeout: 180_000 })
      .toContain('value')

    // 2. Two nodes, the second using the first.
    const added = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['numbers = [1, 2, 3]', 'total = numbers.fold 0 (+)'],
    })
    note('add_nodes numbers, total', added)
    expectSettled('add_nodes', added)
    expect(added.nodes.map((node) => node.name)).toEqual(['numbers', 'total'])
    for (const node of added.nodes) expect(NOT_FAILED, JSON.stringify(node)).toContain(node.state)
    expect(added.nodes[1]!.type).toMatch(/Integer/)
    const numbersId = added.nodes[0]!.id
    const totalId = added.nodes[1]!.id
    const totalPreview = await previewOf(totalId)
    note('get_node total preview', totalPreview)
    expect(totalPreview).toContain('6')

    // 3. A new expression; the node keeps its name.
    const edited = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: totalId,
      expression: 'numbers.fold 10 (+)',
    })
    note('edit_node total', edited)
    expectSettled('edit_node total', edited)
    expect(edited.nodes[0]?.name).toBe('total')
    expect(edited.nodes[0]?.code).toBe('numbers.fold 10 (+)')
    const editedPreview = await previewOf(totalId)
    note('get_node total preview after edit_node', editedPreview)
    expect(editedPreview).toContain('16')

    // 4. A node that needs a library the new project does not import, with its import line.
    const xmlImport = 'from Standard.XML import all'
    expect((await getGraph()).imports).not.toContain(xmlImport)
    const withImport = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['tag = (XML_Document.parse "<greeting>hi</greeting>").name'],
      imports: [xmlImport],
    })
    note('add_nodes with an import', withImport)
    expectSettled('add_nodes with an import', withImport)
    const afterImport = await getGraph()
    note('get_graph imports', afterImport.imports)
    expect(afterImport.imports).toContain(xmlImport)
    const tag = nodeNamed(afterImport, 'tag')
    expect(NOT_FAILED, JSON.stringify(tag)).toContain(tag.state)
    const tagPreview = await previewOf(tag.id)
    note('get_node tag preview', tagPreview)
    expect(tagPreview).toContain('greeting')

    // 5. A node with an error, reported in the result, then fixed.
    const broken = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['pair = [4, 5].no_such_method'],
    })
    note('add_nodes with an unknown method', broken)
    expectSettled('add_nodes with an unknown method', broken)
    const pairId = broken.nodes[0]!.id
    expect(broken.nodes[0]!.state).toMatch(/^(error|panic)$/)
    const fixed = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: pairId,
      expression: '[4, 5].length',
    })
    note('edit_node fixing it', fixed)
    expectSettled('edit_node fixing it', fixed)
    expect(NOT_FAILED, JSON.stringify(fixed.nodes[0])).toContain(fixed.nodes[0]!.state)
    expect(await previewOf(pairId)).toContain('2')

    // 6. A comment, a visualization and a selection.
    const comment = 'The sum of the numbers, from ten.'
    const commented = await callJson<{ node: NodeSummary }>('set_node_comment', {
      node_id: totalId,
      text: comment,
    })
    note('set_node_comment', commented)
    expect(commented.node.comment).toBe(comment)
    const visualized = await callJson<{ node: NodeSummary }>('set_visualization', {
      node_id: totalId,
      visible: true,
    })
    note('set_visualization', visualized)
    expect(visualized.node.id).toBe(totalId)
    const selected = await callJson<{ selected: string[] }>('select_nodes', {
      node_ids: [numbersId, totalId],
    })
    note('select_nodes', selected)
    expect([...selected.selected].sort()).toEqual([numbersId, totalId].sort())
    const afterView = await getGraph()
    expect(nodeNamed(afterView, 'total').comment).toBe(comment)
    expect([...afterView.selection].sort()).toEqual([numbersId, totalId].sort())
    await expect(page.locator('.GraphNode.selected')).toHaveCount(2)

    // 7. The two named nodes into a function, then into it and back.
    const collapsed = await callJson<{ name: string; node: NodeSummary | null; settled: boolean }>(
      'collapse_nodes',
      { node_ids: [numbersId, totalId], name: 'sum_numbers' },
    )
    note('collapse_nodes', collapsed)
    expectSettled('collapse_nodes', collapsed)
    expect(collapsed.name).toBe('sum_numbers')
    expect(collapsed.node?.code).toContain('sum_numbers')
    const afterCollapse = await getGraph()
    note(
      'get_graph after collapse_nodes',
      afterCollapse.nodes.map((node) => [node.name, node.code]),
    )
    const callNode = afterCollapse.nodes.find((node) => node.code.includes('sum_numbers'))
    expect(callNode, JSON.stringify(afterCollapse.nodes)).toBeDefined()
    expect(names(afterCollapse)).not.toContain('numbers')
    const entered = await callJson<{ method: string }>('open_method', { node_id: callNode!.id })
    note('open_method into the function', entered)
    expect(entered.method).toBe('sum_numbers')
    const inside = await getGraph()
    note('get_graph inside', { method: inside.method, nodes: names(inside) })
    expect(inside.method).toBe('sum_numbers')
    expect(names(inside)).toEqual(expect.arrayContaining(['numbers', 'total']))
    const back = await callJson<{ method: string }>('open_method', {})
    note('open_method back', back)
    expect(back.method).toBe('main')

    // 8. A function written from scratch, called from a node.
    const addedFunction = await callJson<{ name: string; settled: boolean }>('add_function', {
      source: 'double x =\n    x * 2',
    })
    note('add_function', addedFunction)
    expectSettled('add_function', addedFunction)
    expect(addedFunction.name).toBe('double')
    const calling = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['doubled = Main.double 21'],
    })
    note('add_nodes calling it', calling)
    expectSettled('add_nodes calling it', calling)
    expect(NOT_FAILED, JSON.stringify(calling.nodes[0])).toContain(calling.nodes[0]!.state)
    const doubledPreview = await previewOf(calling.nodes[0]!.id)
    note('get_node doubled preview', doubledPreview)
    expect(doubledPreview).toContain('42')

    // 9. Undo in the window. A caller's step ends 10 s after its last edit, so this call is a step
    // of its own: one undo takes back both its nodes, and nothing before them.
    await page.waitForTimeout(11_000)
    const toUndo = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['undo_a = 1', 'undo_b = undo_a + 1'],
    })
    note('add_nodes before the undo', toUndo)
    expectSettled('add_nodes before the undo', toUndo)
    expect(toUndo.nodes.map((node) => node.name)).toEqual(['undo_a', 'undo_b'])
    await page.keyboard.press('ControlOrMeta+Z')
    await expect.poll(async () => names(await getGraph())).not.toContain('undo_a')
    const afterUndo = await getGraph()
    note('get_graph after one undo', names(afterUndo))
    expect(names(afterUndo)).not.toContain('undo_b')
    expect(names(afterUndo)).toEqual(expect.arrayContaining(['doubled', 'tag', 'pair']))

    // 10. Removing, listing, the Drive's path rule, closing and reopening.
    const removed = await callJson<{ removed: string[]; settled: boolean }>('remove_nodes', {
      node_ids: [pairId],
    })
    note('remove_nodes', removed)
    expectSettled('remove_nodes', removed)
    expect(removed.removed).toEqual([pairId])
    expect((await getGraph()).nodes.map((node) => node.id)).not.toContain(pairId)

    const files = await callJson<{ directory: string; entries: { name: string; kind: string }[] }>(
      'list_files',
    )
    note('list_files on the Drive root', files)
    expect(files.entries).toContainEqual(
      expect.objectContaining({ name: projectName, kind: 'project' }),
    )
    const openOutside = await callError('open_project', {
      path: path.join(os.homedir(), projectName),
    })
    note('open_project outside the Drive', openOutside)
    expect(openOutside).toContain('outside the Drive')
    const listOutside = await callError('list_files', { directory: os.homedir() })
    note('list_files outside the Drive', listOutside)
    expect(listOutside).toContain('outside the Drive')

    const closed = await callJson<{ closed: unknown; page: string; project: unknown }>(
      'close_project',
    )
    note('close_project', closed)
    expect(closed.closed).toEqual(created)
    expect(closed.page).toBe('dashboard')
    expect(closed.project).toBeNull()
    // The edits were saved with the project as they were made: closing wrote no more than that.
    const saved = await fs.readFile(path.join(created.path, 'src', 'Main.enso'), 'utf8')
    expect(saved).toContain('sum_numbers')
    expect(saved).toContain('double x =')
    expect(saved).toContain(xmlImport)

    const reopened = await callJson<{ name: string; path: string }>('open_project', {
      path: created.path,
    })
    note('open_project', reopened)
    expect(reopened).toEqual(created)
    const rebuilt = await getGraph()
    note(
      'get_graph after reopening',
      rebuilt.nodes.map((node) => [node.name, node.code, node.state]),
    )
    expect(names(rebuilt)).toEqual(expect.arrayContaining(['tag', 'doubled']))
    expect(names(rebuilt)).not.toContain('undo_a')
    expect(rebuilt.nodes.some((node) => node.code.includes('sum_numbers'))).toBe(true)
    expect(rebuilt.imports).toContain(xmlImport)

    await callJson('close_project')
  } finally {
    await client.close()
    // The engine lets go of the project's files a moment after the project closes.
    if (projectPath != null) {
      await fs.rm(projectPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }
})
