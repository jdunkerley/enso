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

/** The GUI's per-node Write prefix (`app/gui/src/project-view/util/ast/node.ts`). */
const WRITE_PREFIX =
  'Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output "design" <| '
/** The start of the refusal of code that turns the output context on. */
const WRITE_REFUSED = 'Only the user can turn Write on.'
/** The start of the refusal of code that looks a method up by reflection. */
const REFLECTION_REFUSED = 'Code that looks a method up by reflection (Meta.meta) is refused.'
/** The refusal of code that binds a runtime builtin. */
const BUILTIN_REFUSED = 'Code that binds a runtime builtin (@Builtin_Method) is refused.'
/** The start of the refusal of code that evaluates text as code. */
const EVAL_REFUSED = 'Code that evaluates text as code (Debug.eval) is refused.'
/** The start of the refusal of code that looks a method up by a name in text. */
const NAME_LOOKUP_REFUSED =
  'Code that looks a method up by a name in text (Polyglot.get_member, Polyglot.invoke) is refused.'

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
   * The edit that was just called saw the engine report results for the nodes it changed
   * (`settled`), and answered well inside the 20 s settle timeout: 0.13-1.4 s on a desktop,
   * against 20-22 s when the engine's report was missed. The 10 s bound leaves room for a slower
   * machine (CI's Windows runner has 2 CPUs).
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
    // The edit reaches the project's file while the project is open: no close, no Write.
    const mainFile = path.join(created.path, 'src', 'Main.enso')
    const savingSince = Date.now()
    await expect
      .poll(async () => fs.readFile(mainFile, 'utf8'), { timeout: 30_000, intervals: [100] })
      .toContain('total = numbers.fold 0 (+)')
    note('the edit in Main.enso on disk, ms after add_nodes answered', Date.now() - savingSince)
    expect(added.nodes.map((node) => node.name)).toEqual(['numbers', 'total'])
    // Read just after a get_graph preview: the result itself, not a re-read, has the values.
    for (const node of added.nodes) expect(node.state, JSON.stringify(node)).toBe('value')
    expect(added.nodes[0]!.type).toMatch(/Vector/)
    expect(added.nodes[1]!.type).toMatch(/Integer/)
    const numbersId = added.nodes[0]!.id
    const totalId = added.nodes[1]!.id
    const totalPreview = await previewOf(totalId)
    note('get_node total preview', totalPreview)
    expect(totalPreview).toContain('6')

    // Code that turns Write on by the routes the guard knows (the Write prefix, `with_enabled_context`
    // / `with_enabled` anywhere, reflection, a runtime builtin, text evaluated as code, a method
    // looked up by a name in text) is refused by every tool that takes code, and the file it names
    // is not written.
    const writeTarget = path.join(os.tmpdir(), `enso-mcp-write-prefix-${Date.now()}.txt`)
    const writeTargetEnso = writeTarget.replace(/\\/g, '/')
    await fs.rm(writeTarget, { force: true })
    try {
      const writeCode = `${WRITE_PREFIX}"x".write "${writeTargetEnso}"`
      const addRefused = await callError('add_nodes', { statements: [`w = ${writeCode}`] })
      note('add_nodes with the Write prefix', addRefused)
      expect(addRefused).toContain(WRITE_REFUSED)
      const editRefused = await callError('edit_node', {
        node_id: numbersId,
        expression: writeCode,
      })
      note('edit_node with the Write prefix', editRefused)
      expect(editRefused).toContain(WRITE_REFUSED)
      const evaluateRefused = await callError('evaluate_expression', {
        expression: `(${writeCode}).to_text`,
      })
      note('evaluate_expression with the Write prefix', evaluateRefused)
      expect(evaluateRefused).toContain(WRITE_REFUSED)
      const methodRefused = await callError('evaluate_expression', {
        expression: `(Context.Output.with_enabled <| "x".write "${writeTargetEnso}").to_text`,
      })
      note('evaluate_expression with Context.Output.with_enabled', methodRefused)
      expect(methodRefused).toContain(WRITE_REFUSED)
      // The two routes past the names that review found, both of which wrote the file before they
      // were refused: a method name built by reflection, and a function bound to the runtime's
      // builtin.
      const reflection = `(Meta.meta .x).rename ("with_" + "enabled") . value Standard.Base.Runtime.Context.Output ("x".write "${writeTargetEnso}")`
      const reflectionEvaluated = await callError('evaluate_expression', {
        expression: `(${reflection}).to_text`,
      })
      note('evaluate_expression with a method name built by reflection', reflectionEvaluated)
      expect(reflectionEvaluated).toContain(REFLECTION_REFUSED)
      const reflectionAdded = await callError('add_nodes', { statements: [`r = ${reflection}`] })
      note('add_nodes with a method name built by reflection', reflectionAdded)
      expect(reflectionAdded).toContain(REFLECTION_REFUSED)
      const builtinAdded = await callError('add_function', {
        source: 'go c e ~a = @Builtin_Method "Runtime.with_context_builtin"',
      })
      note('add_function bound to a runtime builtin', builtinAdded)
      expect(builtinAdded).toBe(BUILTIN_REFUSED)
      // Two more that a later review found, both of which wrote the file before they were refused:
      // text evaluated as code, with the enabling names only inside the text, and the enabling
      // method looked up by a name in text through polyglot interop.
      const evaluated = `Standard.Base.Runtime.Debug.eval ("Standard.Base.Runtime.with_" + "enabled_context Standard.Base.Runtime.Context.Output <| 'x'.write '${writeTargetEnso}'")`
      const evalEvaluated = await callError('evaluate_expression', {
        expression: `(${evaluated}).to_text`,
      })
      note('evaluate_expression with Debug.eval', evalEvaluated)
      expect(evalEvaluated).toContain(EVAL_REFUSED)
      const evalAdded = await callError('add_nodes', { statements: [`d = ${evaluated}`] })
      note('add_nodes with Debug.eval', evalAdded)
      expect(evalAdded).toContain(EVAL_REFUSED)
      const lookup = `(Polyglot.get_member Standard.Base.Runtime.Context.Output ("with_" + "enabled")) ("x".write "${writeTargetEnso}")`
      const lookupEvaluated = await callError('evaluate_expression', {
        expression: `(${lookup}).to_text`,
      })
      note('evaluate_expression with Polyglot.get_member', lookupEvaluated)
      expect(lookupEvaluated).toContain(NAME_LOOKUP_REFUSED)
      const lookupAdded = await callError('add_nodes', { statements: [`g = ${lookup}`] })
      note('add_nodes with Polyglot.get_member', lookupAdded)
      expect(lookupAdded).toContain(NAME_LOOKUP_REFUSED)
      // Give a write that the engine might finish late a moment to land.
      await page.waitForTimeout(2_000)
      expect(existsSync(writeTarget), `${writeTarget} must not exist`).toBe(false)
      const afterRefusals = await getGraph()
      expect(names(afterRefusals)).not.toContain('w')
      expect(names(afterRefusals)).not.toContain('r')
      expect(names(afterRefusals)).not.toContain('d')
      expect(names(afterRefusals)).not.toContain('g')
      expect(afterRefusals.source).not.toContain('Builtin_Method')
    } finally {
      await fs.rm(writeTarget, { force: true })
    }

    // 3. A new expression; the node keeps its name.
    const edited = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: totalId,
      expression: 'numbers.fold 10 (+)',
    })
    note('edit_node total', edited)
    expectSettled('edit_node total', edited)
    const editSavingSince = Date.now()
    await expect
      .poll(async () => fs.readFile(mainFile, 'utf8'), { timeout: 30_000, intervals: [100] })
      .toContain('total = numbers.fold 10 (+)')
    note('the edit_node in Main.enso on disk, ms after it answered', Date.now() - editSavingSince)
    expect(edited.nodes[0]?.name).toBe('total')
    expect(edited.nodes[0]?.code).toBe('numbers.fold 10 (+)')
    expect(edited.nodes[0]?.state).toBe('value')
    expect(edited.nodes[0]?.type).toMatch(/Integer/)
    const editedPreview = await previewOf(totalId)
    note('get_node total preview after edit_node', editedPreview)
    expect(editedPreview).toContain('16')

    // Two edits back to back, on a node and then on its user, while the user is still being
    // computed for the first: the second result must describe the second edit, not a value the
    // engine computed for the first one.
    const firstOfTwo = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: numbersId,
      expression: '[1, 2, 3, 4]',
    })
    note('edit_node numbers (first of two)', firstOfTwo)
    expectSettled('edit_node numbers (first of two)', firstOfTwo)
    const secondOfTwo = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: totalId,
      expression: 'numbers.length.to_text',
    })
    note('edit_node total (second of two)', secondOfTwo)
    expectSettled('edit_node total (second of two)', secondOfTwo)
    expect(secondOfTwo.nodes[0]!.state).toBe('value')
    expect(secondOfTwo.nodes[0]!.type).toMatch(/Text/)
    expect(await previewOf(totalId)).toContain('4')
    const restored = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: totalId,
      expression: 'numbers.fold 10 (+)',
    })
    note('edit_node total back to a fold', restored)
    expectSettled('edit_node total back to a fold', restored)
    expect(restored.nodes[0]!.state).toBe('value')
    expect(restored.nodes[0]!.type).toMatch(/Integer/)
    // The same text again: the code does not change.
    const sameText = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('edit_node', {
      node_id: totalId,
      expression: 'numbers.fold 10 (+)',
    })
    note('edit_node total to the same text', sameText)
    expectSettled('edit_node total to the same text', sameText)
    expect(sameText.nodes[0]!.type).toMatch(/Integer/)
    expect(await previewOf(totalId)).toContain('20')

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
    expect(fixed.nodes[0]!.state).toBe('value')
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

    // 10. Removing a node with a user: the user is computed again, and the result waits for it.
    const pairOfNodes = await callJson<{ nodes: NodeSummary[]; settled: boolean }>('add_nodes', {
      statements: ['base = 5', 'uses_base = base + 1'],
    })
    note('add_nodes base, uses_base', pairOfNodes)
    expectSettled('add_nodes base, uses_base', pairOfNodes)
    const removedWithUser = await callJson<{ removed: string[]; settled: boolean }>(
      'remove_nodes',
      { node_ids: [pairOfNodes.nodes[0]!.id] },
    )
    note('remove_nodes base (used by uses_base)', removedWithUser)
    expectSettled('remove_nodes base (used by uses_base)', removedWithUser)
    const usesBase = nodeNamed(await getGraph(), 'uses_base')
    note('uses_base after its input was removed', usesBase)

    // 11. Removing, listing, the Drive's path rule, closing and reopening.
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
