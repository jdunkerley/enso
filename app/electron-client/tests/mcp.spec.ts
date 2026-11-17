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

/** The image and the text of a tool result that is one image item and one text item. */
function imageOf(result: Awaited<ReturnType<Client['callTool']>>): {
  png: Buffer
  text: string
} {
  const content = result.content as {
    type: string
    text?: string
    data?: string
    mimeType?: string
  }[]
  expect(content.map((item) => item.type)).toEqual(['image', 'text'])
  expect(content[0]?.mimeType).toBe('image/png')
  return {
    png: Buffer.from(content[0]?.data ?? '', 'base64'),
    text: content[1]?.text ?? '',
  }
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
        'get_documentation',
        'get_graph',
        'get_graph_image',
        'get_node',
        'get_problems',
        'get_visualization',
        'list_visualizations',
        'search_components',
        // The project tools that edit or navigate.
        'add_function',
        'add_image',
        'add_nodes',
        'arrange_nodes',
        'collapse_nodes',
        'edit_node',
        'move_nodes',
        'open_method',
        'redo',
        'refresh',
        'remove_nodes',
        'save_version',
        'select_nodes',
        'set_documentation',
        'set_node_comment',
        'set_visualization',
        'undo',
        // The app tools.
        'close_project',
        'create_project',
        'get_app_state',
        'list_files',
        'list_projects',
        'open_project',
        'switch_project',
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

/** The first eight bytes of every PNG file. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A visualization's size as drawn, in scene units, and whether each is the default. */
interface VisualizationSize {
  width: number
  height: number
  default_width: boolean
  default_height: boolean
}

/** The text beside a `get_visualization` picture. */
interface PictureAbout {
  visualization: string
  shown: boolean
  changed: boolean
  available: string[]
  size: VisualizationSize
  /** The picture, in pixels. */
  width: number
  height: number
}

/** The size the test gives a visualization with `set_visualization`. */
const LARGE_SIZE: VisualizationSize = {
  width: 600,
  height: 400,
  default_width: false,
  default_height: false,
}

/** A node's place, with `get_graph { layout: true }`: its top-left and the room it takes. */
interface NodeLayout {
  id: string
  name: string | null
  position?: { x: number; y: number }
  area?: { x: number; y: number; width: number; height: number }
}

/** The states of a node that is neither an error nor a panic. */
const NOT_FAILED = ['value', 'pending', 'unknown']

test('an MCP client builds a project from the dashboard', async ({ page, testRunId }, testInfo) => {
  // A cold engine's first execution of a new project, about twenty-five edits each waiting for its
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
    const onScreen = await callJson<{
      page: string
      project: unknown
      open_projects: { name: string; path: string }[]
    }>('get_app_state')
    note('get_app_state after create_project', onScreen)
    expect(onScreen.page).toBe('project')
    expect(onScreen.project).toEqual(created)
    expect(onScreen.open_projects).toEqual([created])

    // Switching tabs: the project on screen answers itself; a path no tab has is refused with the
    // open projects listed, and nothing is opened.
    const switched = await callJson<{ name: string; path: string }>('switch_project', {
      path: created.path,
    })
    note('switch_project to the project on screen', switched)
    expect(switched).toEqual(created)
    const notOpen = path.join(path.dirname(created.path), 'No_Such_Project')
    const switchRefused = await callError('switch_project', { path: notOpen })
    note('switch_project to a path no tab has', switchRefused)
    expect(switchRefused).toContain('No open project has the path')
    expect(switchRefused).toContain(`Open projects: ${created.path}.`)
    expect(switchRefused).toContain('open_project')
    expect((await callJson<{ open_projects: unknown[] }>('get_app_state')).open_projects).toEqual([
      created,
    ])

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

    // The vector's visualization, hidden until now: the picture shows it, then its data.
    const picture = await callTool('get_visualization', { node_id: numbersId })
    expect(picture.isError, JSON.stringify(picture.content)).toBeFalsy()
    const { png, text } = imageOf(picture)
    note('get_visualization numbers (image)', text)
    const about = JSON.parse(text) as PictureAbout
    // The default size: 150 high, and as wide as the node or 200.
    expect(about.size).toMatchObject({ height: 150, default_width: true, default_height: true })
    expect(about.shown).toBe(true)
    expect(about.changed).toBe(false)
    // A PNG: the signature, then the size the text states, within the cap.
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(about.width)
    expect(png.readUInt32BE(20)).toBe(about.height)
    expect(about.width).toBeGreaterThan(100)
    expect(Math.max(about.width, about.height)).toBeLessThanOrEqual(1200)
    // Not one flat colour: a blank capture has no more than a handful of distinct bytes.
    expect(new Set(png.subarray(33)).size).toBeGreaterThan(32)
    await testInfo.attach('visualization.png', { body: png, contentType: 'image/png' })
    // The stale-frame check: a picture taken once everything has long been drawn is the same.
    await page.waitForTimeout(3_000)
    const again = await callTool('get_visualization', { node_id: numbersId })
    expect(again.isError, JSON.stringify(again.content)).toBeFalsy()
    const second = imageOf(again)
    await testInfo.attach('visualization-again.png', { body: second.png, contentType: 'image/png' })
    expect((JSON.parse(second.text) as { shown: boolean }).shown).toBe(false)
    expect(second.png.equals(png), 'the first picture is the settled one').toBe(true)

    const data = await callTool('get_visualization', { node_id: numbersId, format: 'data' })
    expect(data.isError, textOf(data)).toBeFalsy()
    note('get_visualization numbers (data)', textOf(data))
    expect(JSON.parse(textOf(data))).toMatchObject({ shown: false, truncated: false })

    // The same visualization made larger, then put back to its default size: the picture follows.
    const enlarged = await callJson<{ size: VisualizationSize; settled: boolean }>(
      'set_visualization',
      { node_id: numbersId, visible: true, width: 600, height: 400 },
    )
    note('set_visualization numbers 600 x 400', enlarged)
    expect(enlarged).toMatchObject({ size: LARGE_SIZE, settled: true })
    const large = await callTool('get_visualization', { node_id: numbersId })
    expect(large.isError, JSON.stringify(large.content)).toBeFalsy()
    const largeImage = imageOf(large)
    note('get_visualization numbers at 600 x 400 (image)', largeImage.text)
    const largeAbout = JSON.parse(largeImage.text) as PictureAbout
    expect(largeAbout).toMatchObject({
      visualization: about.visualization,
      shown: false,
      changed: false,
      size: LARGE_SIZE,
    })
    expect(largeImage.png.readUInt32BE(16)).toBe(largeAbout.width)
    expect(largeImage.png.readUInt32BE(20)).toBe(largeAbout.height)
    expect(largeAbout.width).toBeGreaterThan(about.width)
    expect(largeAbout.height).toBeGreaterThan(about.height)
    expect(new Set(largeImage.png.subarray(33)).size).toBeGreaterThan(32)
    await testInfo.attach('viz-600x400.png', { body: largeImage.png, contentType: 'image/png' })
    const reset = await callJson<{ size: VisualizationSize; settled: boolean }>(
      'set_visualization',
      { node_id: numbersId, visible: true, width: null, height: null },
    )
    note('set_visualization numbers back to the default size', reset)
    expect(reset.size).toMatchObject({ default_width: true, default_height: true })
    expect(reset.size).toEqual(about.size)
    const small = await callTool('get_visualization', { node_id: numbersId })
    expect(small.isError, JSON.stringify(small.content)).toBeFalsy()
    const smallImage = imageOf(small)
    note('get_visualization numbers at the default size again (image)', smallImage.text)
    const smallAbout = JSON.parse(smallImage.text) as PictureAbout
    expect(smallAbout.size).toEqual(about.size)
    expect({ width: smallAbout.width, height: smallAbout.height }).toEqual({
      width: about.width,
      height: about.height,
    })
    await testInfo.attach('viz-default-again.png', {
      body: smallImage.png,
      contentType: 'image/png',
    })

    // The node's other visualizations: offered, then one of them looked at by name.
    const offered = await callJson<{ shown: boolean; visualization: string; available: string[] }>(
      'list_visualizations',
      { node_id: numbersId },
    )
    note('list_visualizations numbers', offered)
    expect(offered.shown).toBe(true)
    expect(offered.visualization).toBe(about.visualization)
    expect(offered.available).toContain(about.visualization)
    expect(about.available).toEqual(offered.available)
    const otherName =
      offered.available.includes('JSON') && about.visualization !== 'JSON' ?
        'JSON'
      : offered.available.find((name) => name !== about.visualization)!
    expect(otherName).toBeDefined()
    const other = await callTool('get_visualization', {
      node_id: numbersId,
      visualization: otherName,
    })
    expect(other.isError, JSON.stringify(other.content)).toBeFalsy()
    const otherImage = imageOf(other)
    note('get_visualization numbers by name (image)', otherImage.text)
    const otherAbout = JSON.parse(otherImage.text) as { visualization: string; changed: boolean }
    expect(otherAbout).toMatchObject({ visualization: otherName, changed: true })
    expect(new Set(otherImage.png.subarray(33)).size).toBeGreaterThan(32)
    expect(otherImage.png.equals(png), 'the other picture is not the first one').toBe(false)
    await testInfo.attach('other-visualization.png', {
      body: otherImage.png,
      contentType: 'image/png',
    })
    // It stays switched, and is drawn: the same picture 3 s later.
    await page.waitForTimeout(3_000)
    const otherAgain = await callTool('get_visualization', {
      node_id: numbersId,
      visualization: otherName,
    })
    expect(otherAgain.isError, JSON.stringify(otherAgain.content)).toBeFalsy()
    const otherSecond = imageOf(otherAgain)
    await testInfo.attach('other-visualization-again.png', {
      body: otherSecond.png,
      contentType: 'image/png',
    })
    expect((JSON.parse(otherSecond.text) as { changed: boolean }).changed).toBe(false)
    expect(otherSecond.png.equals(otherImage.png), 'the other picture is the settled one').toBe(
      true,
    )

    // Images for the documentation, stored in the project's `images` folder on disk: a picture of
    // the vector's visualization, a PNG file from outside the Drive, and a text file named `.png`,
    // which is refused.
    const imagesFolder = path.join(created.path, 'images')
    /** The file on disk an `add_image` result's project-relative URL names. */
    const onDisk = (url: string) =>
      path.join(
        created.path,
        ...decodeURI(url)
          .split('/')
          .filter((segment) => segment !== ''),
      )
    const fromNode = await callJson<{
      path: string
      markdown: string
      bytes: number
      shown: boolean
      moved: boolean
    }>('add_image', { node_id: numbersId })
    note('add_image of the numbers visualization', fromNode)
    expect(fromNode.path).toBe('/images/numbers.png')
    expect(fromNode.markdown).toBe('![numbers](/images/numbers.png)')
    // Its visualization was on screen already.
    expect(fromNode.shown).toBe(false)
    expect(typeof fromNode.moved).toBe('boolean')
    const nodePng = await fs.readFile(onDisk(fromNode.path))
    expect(nodePng.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(nodePng.length).toBe(fromNode.bytes)
    expect(new Set(nodePng.subarray(33)).size).toBeGreaterThan(32)
    await testInfo.attach('add-image-node.png', { body: nodePng, contentType: 'image/png' })

    /** The documentation written below, read again after the project is reopened. */
    let savedDocumentation: string | undefined
    const sourceFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'enso-mcp-image-'))
    try {
      const chart = path.join(sourceFolder, 'chart.png')
      await fs.writeFile(chart, png)
      const fromFile = await callJson<{ path: string; markdown: string; bytes: number }>(
        'add_image',
        { path: chart },
      )
      note('add_image of a PNG file', fromFile)
      expect(fromFile).toEqual({
        path: '/images/chart.png',
        markdown: '![chart](/images/chart.png)',
        bytes: png.length,
      })
      expect((await fs.readFile(onDisk(fromFile.path))).equals(png)).toBe(true)

      const notPng = path.join(sourceFolder, 'notes.png')
      await fs.writeFile(notPng, 'These are notes, not a picture.\n')
      const notPngRefused = await callError('add_image', { path: notPng })
      note('add_image of a text file named .png', notPngRefused)
      expect(notPngRefused).toContain('The file is not a PNG image')
      expect(notPngRefused).not.toContain('These are notes')
      expect((await fs.readdir(imagesFolder)).sort()).toEqual(['chart.png', 'numbers.png'])

      // The documentation of `main`, replaced as a whole with text showing both images, then read
      // back; the same text again changes nothing.
      const before = await callJson<{ method: string; text: string; truncated: boolean }>(
        'get_documentation',
      )
      note('get_documentation of a new project', before)
      expect(before.method).toBe('main')
      expect(before.truncated).toBe(false)
      const documentation =
        'Adds up the numbers, from ten.\n\n' +
        `The numbers:\n\n${fromNode.markdown}\n\n` +
        `A chart from a file:\n\n${fromFile.markdown}`
      const documented = await callJson<{
        method: string
        characters: number
        settled: boolean
        unchanged?: boolean
      }>('set_documentation', { text: documentation })
      note('set_documentation', documented)
      expect(documented).toEqual({
        method: 'main',
        characters: documentation.length,
        settled: true,
      })
      const readBack = await callJson<{ method: string; text: string; truncated: boolean }>(
        'get_documentation',
      )
      note('get_documentation after set_documentation', readBack)
      expect(readBack).toEqual({ method: 'main', text: documentation, truncated: false })
      const docSavingSince = Date.now()
      await expect
        .poll(async () => fs.readFile(mainFile, 'utf8'), { timeout: 30_000, intervals: [100] })
        .toContain('Adds up the numbers, from ten.')
      note(
        'the documentation in Main.enso on disk, ms after it answered',
        Date.now() - docSavingSince,
      )
      expect(await fs.readFile(mainFile, 'utf8')).toContain(fromFile.markdown)
      const sameDocumentation = await callJson<{ unchanged?: boolean }>('set_documentation', {
        text: documentation,
      })
      note('set_documentation with the same text', sameDocumentation)
      expect(sameDocumentation.unchanged).toBe(true)
      savedDocumentation = documentation
    } finally {
      await fs.rm(sourceFolder, { recursive: true, force: true })
    }

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

    // 9. The layout: the positions, a node moved, the graph tidied, then a picture of it all.
    const layoutGraph = () =>
      callJson<{ nodes: NodeLayout[]; view: { scale: number } }>('get_graph', {
        previews: false,
        layout: true,
      })
    const laidOut = await layoutGraph()
    note(
      'get_graph with layout',
      laidOut.nodes.map((node) => [node.name, node.position, node.area]),
    )
    expect(laidOut.view.scale).toBeGreaterThan(0)
    for (const node of laidOut.nodes) {
      expect(node.position, JSON.stringify(node)).toBeDefined()
      expect(node.area, JSON.stringify(node)).toBeDefined()
    }
    const doubledNode = laidOut.nodes.find((node) => node.name === 'doubled')!
    expect(doubledNode, JSON.stringify(laidOut.nodes)).toBeDefined()
    const doubledTarget = {
      x: doubledNode.position!.x + 300,
      y: doubledNode.position!.y + 200,
    }
    const movedNodes = await callJson<{ moved: unknown[]; settled: boolean }>('move_nodes', {
      moves: [{ node_id: doubledNode.id, ...doubledTarget }],
    })
    note('move_nodes doubled', movedNodes)
    expectSettled('move_nodes', movedNodes)
    expect(movedNodes.moved).toEqual([{ id: doubledNode.id, position: doubledTarget }])
    const afterMove = await layoutGraph()
    expect(afterMove.nodes.find((node) => node.id === doubledNode.id)?.position).toEqual(
      doubledTarget,
    )
    const tidied = await callJson<{ action: string; arranged: number; settled: boolean }>(
      'arrange_nodes',
      { action: 'tidy' },
    )
    note('arrange_nodes tidy', tidied)
    expectSettled('arrange_nodes tidy', tidied)
    expect(tidied.action).toBe('tidy')
    expect(tidied.arranged).toBeGreaterThanOrEqual(0)
    const tidiedGraph = await layoutGraph()
    note(
      'get_graph with layout after tidy',
      tidiedGraph.nodes.map((node) => [node.name, node.position]),
    )
    const graphPicture = await callTool('get_graph_image', {})
    expect(graphPicture.isError, JSON.stringify(graphPicture.content)).toBeFalsy()
    const graphImage = imageOf(graphPicture)
    note('get_graph_image', graphImage.text)
    const graphAbout = JSON.parse(graphImage.text) as {
      scale: number
      width: number
      height: number
      nodes: number
    }
    expect(graphAbout.nodes).toBe(tidiedGraph.nodes.length)
    expect(graphAbout.scale).toBeGreaterThan(0)
    expect(graphAbout.scale).toBeLessThanOrEqual(1)
    expect(graphImage.png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(graphImage.png.readUInt32BE(16)).toBe(graphAbout.width)
    expect(graphImage.png.readUInt32BE(20)).toBe(graphAbout.height)
    expect(Math.max(graphAbout.width, graphAbout.height)).toBeLessThanOrEqual(1200)
    expect(new Set(graphImage.png.subarray(33)).size).toBeGreaterThan(32)
    await testInfo.attach('graph.png', { body: graphImage.png, contentType: 'image/png' })

    // 10. Undo in the window. A caller's step ends 10 s after its last edit, so this call is a step
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

    // 11. Removing a node with a user: the user is computed again, and the result waits for it.
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

    // 12. Removing, listing, the Drive's path rule, closing and reopening.
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
    // The documentation, read from the file the engine loaded, is the text that was set.
    const reread = await callJson<{ method: string; text: string }>('get_documentation')
    note('get_documentation after reopening', reread)
    expect(reread).toMatchObject({ method: 'main', text: savedDocumentation })

    await callJson('close_project')
  } finally {
    await client.close()
    // The engine lets go of the project's files a moment after the project closes.
    if (projectPath != null) {
      await fs.rm(projectPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }
})

/** What `get_problems` answers (the fields this spec reads). */
interface Problems {
  method: string
  nodes: {
    id: string
    name: string | null
    state: string
    message: string | null
    origin?: boolean
    warnings?: number
  }[]
  diagnostics: { kind: string; message: string; line?: number }[]
  errors: number
  warnings: number
  pending: number
  truncated: boolean
  messages_pending?: number
}

/** The answer of `undo` and `redo` (the fields this spec reads). */
interface HistoryAnswer {
  undone?: boolean
  redone?: boolean
  can_undo: boolean
  can_redo: boolean
}

/**
 * Code the user types in the Component Browser that really writes on this engine: the two-argument
 * `with_enabled_context context ~action` turns output on for its action, which appends `w` to the
 * file each time the node runs. (The GUI's own Write prefix, `with_enabled_context Context.Output
 * "design" <| …`, does not run here: the function takes two parameters.)
 */
const WRITE_CODE = (file: string) =>
  `Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output <| "w".write "${file}" on_existing_file=..Append`
/** The end of the refusal of `refresh` when the main module has code that enables output. */
const REFRESH_WRITE_REFUSED = 'Ask the user to refresh.'
/** The start of the refusal of `undo` when the agents have no step of their own to take back. */
const NOTHING_TO_UNDO = "There is nothing of the agents' to undo."
/** The start of the refusal of `undo` while the main module has code that enables output. */
const UNDO_OUTPUT_REFUSED = 'The project has code that enables output'

test('an MCP client undoes its edits, lists problems and refreshes, and none of it writes', async ({
  page,
  testRunId,
}, testInfo) => {
  // A cold engine's first execution of a new project, about fifteen edits each waiting for its
  // execution, an 11 s pause, and the waits that prove a file is not written again.
  test.setTimeout(600_000)
  await waitForDashboard(page)

  const client = await connectClient()
  let lastCallMs = 0
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const start = Date.now()
    const result = await client.callTool({ name, arguments: args })
    lastCallMs = Date.now() - start
    return result
  }
  const note = (step: string, value: unknown) =>
    console.log(`[${testRunId}] ${step} (${lastCallMs} ms): ${JSON.stringify(value)}`)
  const callJson = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await callTool(name, args)
    expect(result.isError, `${name} ${JSON.stringify(args)}: ${textOf(result)}`).toBeFalsy()
    return JSON.parse(textOf(result)) as T
  }
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
  /** `get_problems`, called again until the engine is done and every message has arrived. */
  const getProblems = async (): Promise<Problems> => {
    let last: Problems | undefined
    await expect
      .poll(
        async () => {
          last = await callJson<Problems>('get_problems')
          return last.pending === 0 && last.messages_pending == null
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe(true)
    return last!
  }

  const writeTarget = path.join(os.tmpdir(), `enso-mcp-refresh-write-${Date.now()}.txt`)
  const writeTargetEnso = writeTarget.replace(/\\/g, '/')
  await fs.rm(writeTarget, { force: true })
  let projectPath: string | undefined
  try {
    const created = await callJson<{ name: string; path: string }>('create_project', {
      name: 'Mcp_History',
    })
    projectPath = created.path
    const mainFile = path.join(created.path, 'src', 'Main.enso')
    await expect
      .poll(async () => (await getGraph()).nodes.map((node) => node.state), { timeout: 180_000 })
      .toContain('value')

    // 1. A dataflow error and a node that uses it: both carry the message, and only the first is
    // where to start.
    await callJson('add_nodes', {
      statements: ['bad = Error.throw "boom from the test"', 'after_bad = bad + 1'],
    })
    const chain = await getProblems()
    note('get_problems on an error and the node that uses it', chain)
    const bad = chain.nodes.find((node) => node.name === 'bad')
    const afterBad = chain.nodes.find((node) => node.name === 'after_bad')
    expect(bad, JSON.stringify(chain.nodes)).toMatchObject({ state: 'error', origin: true })
    expect(afterBad, JSON.stringify(chain.nodes)).toMatchObject({ state: 'error', origin: false })
    expect(bad?.message).toContain('boom from the test')
    expect(afterBad?.message).toContain('boom from the test')

    // 2. A compile error in the method on screen: its diagnostic has the module's 1-based line.
    await callJson('add_nodes', { statements: ['broken_ref = this_name_does_not_exist + 1'] })
    await expect
      .poll(async () => fs.readFile(mainFile, 'utf8'), { timeout: 30_000, intervals: [100] })
      .toContain('broken_ref = this_name_does_not_exist + 1')
    const source = await fs.readFile(mainFile, 'utf8')
    const brokenLine = source.split(/\r?\n/).findIndex((line) => line.includes('broken_ref =')) + 1
    expect(brokenLine).toBeGreaterThan(0)
    const compile = await getProblems()
    note('get_problems with a name that does not exist', { brokenLine, compile })
    await testInfo.attach('problems.json', {
      body: JSON.stringify({ brokenLine, chain, compile }, null, 1),
      contentType: 'application/json',
    })
    const diagnostic = compile.diagnostics.find((d) =>
      d.message.includes('this_name_does_not_exist'),
    )
    expect(diagnostic, JSON.stringify(compile.diagnostics)).toBeDefined()
    expect(diagnostic?.kind).toBe('error')
    expect(diagnostic?.line).toBe(brokenLine)

    // 3. `refresh` with errors on screen, and then on an ordinary project: it settles.
    const refreshedWithErrors = await callJson<{ refreshed: boolean; settled: boolean }>('refresh')
    note('refresh with errors on screen', refreshedWithErrors)
    expect(refreshedWithErrors).toEqual({ refreshed: true, settled: true })
    const graph = await getGraph()
    await callJson('remove_nodes', {
      node_ids: ['bad', 'after_bad', 'broken_ref'].map((name) => nodeNamed(graph, name).id),
    })
    const refreshed = await callJson<{ refreshed: boolean; settled: boolean }>('refresh')
    note('refresh on an ordinary project', refreshed)
    expect(refreshed).toEqual({ refreshed: true, settled: true })
    expect(lastCallMs, 'refresh answered in time').toBeLessThan(EDIT_ANSWER_MS)

    // A function with an argument: its input node, as the graph editor draws it, must report too.
    await callJson('add_function', { source: 'triple x =\n    y = x * 3\n    y' })
    const calling = await callJson<{ nodes: NodeSummary[] }>('add_nodes', {
      statements: ['tripled = Main.triple 5'],
    })
    const inside = await callJson<{ method: string }>('open_method', {
      node_id: calling.nodes[0]!.id,
    })
    expect(inside.method).toBe('triple')
    note('the nodes of a function with an argument', (await getGraph()).nodes)
    const refreshedInside = await callJson<{ refreshed: boolean; settled: boolean }>('refresh')
    note('refresh inside a function with an argument', refreshedInside)
    expect(refreshedInside).toEqual({ refreshed: true, settled: true })
    expect(lastCallMs, 'refresh answered in time').toBeLessThan(EDIT_ANSWER_MS)
    note('the nodes of the function after the refresh', (await getGraph()).nodes)
    await callJson('open_method', {})

    // 4. Undo and redo of one step of the agent's own. A pause of 11 s ends the step the removal
    // above belongs to, so these two nodes are a step of their own.
    await page.waitForTimeout(11_000)
    await callJson('add_nodes', { statements: ['hist_a = 1', 'hist_b = hist_a + 1'] })
    expect(names(await getGraph())).toEqual(expect.arrayContaining(['hist_a', 'hist_b']))
    const undone = await callJson<HistoryAnswer>('undo')
    note('undo', undone)
    expect(undone).toMatchObject({ undone: true, can_redo: true })
    expect(names(await getGraph())).not.toContain('hist_a')
    expect(names(await getGraph())).not.toContain('hist_b')
    const redone = await callJson<HistoryAnswer>('redo')
    note('redo', redone)
    expect(redone).toMatchObject({ redone: true, can_redo: false })
    expect(names(await getGraph())).toEqual(expect.arrayContaining(['hist_a', 'hist_b']))
    expect(await callError('redo')).toContain('nothing')

    // 5. A version: saved, or nothing to save; refused when the user has not turned versions on.
    const version = await callTool('save_version', { comment: 'Saved by the packaged test' })
    note('save_version', textOf(version))
    if (version.isError) expect(textOf(version)).toContain('Versions are not kept')
    else expect(JSON.parse(textOf(version))).toHaveProperty('saved')

    // 6. THE WRITE RULE: an agent never causes a write the user did not click for. The user (here
    // the test, typing code in the Component Browser as the user does) makes a node that really
    // writes its file each time it runs. The same code through `add_nodes` is refused (the other
    // test).
    const userCreatesNode = async (code: string) => {
      await page.keyboard.press('Escape')
      await page.getByTestId('add-component-button').click()
      await expect(page.locator('.ComponentBrowser')).toBeVisible()
      const input = page.getByTestId('component-editor-content')
      await expect(input).toBeFocused()
      await input.fill(code)
      await page.keyboard.press('Enter')
      await expect(page.locator('.ComponentBrowser')).toBeHidden()
    }
    const fileNow = async () => ({
      content: await fs.readFile(writeTarget, 'utf8'),
      mtime: (await fs.stat(writeTarget)).mtimeMs,
    })
    await userCreatesNode(WRITE_CODE(writeTargetEnso))
    await expect
      .poll(() => existsSync(writeTarget), { timeout: 120_000, intervals: [250] })
      .toBe(true)
    // Long enough for any second run while the new node settles to have written.
    await page.waitForTimeout(8_000)
    const written = await fileNow()
    note('the write node has written its file', written)
    // (a) The user's node wrote once.
    expect(written.content, 'the node wrote exactly once').toBe('w')
    const writeNodeGraph = await getGraph()
    const writeNode = writeNodeGraph.nodes.find((node) => node.code.includes(writeTargetEnso))
    expect(writeNode, JSON.stringify(writeNodeGraph.nodes)).toBeDefined()
    /** The file is as the user's node left it, after `ms` for anything running to write. */
    const expectUnchanged = async (step: string, ms = 5_000) => {
      await page.waitForTimeout(ms)
      expect(await fileNow(), `${step}: the file was not written again`).toEqual(written)
    }

    // (b) `refresh` is refused, and nothing is written.
    const refreshRefused = await callError('refresh')
    note('refresh with code that writes', refreshRefused)
    expect(refreshRefused).toContain(REFRESH_WRITE_REFUSED)
    await expectUnchanged('refresh refused', 8_000)

    // (c) An agent's edit elsewhere while that code is there, then `undo`: refused, and the edit
    // stays.
    await callJson('add_nodes', { statements: ['after_write = 1'] })
    await expectUnchanged('an agent added a node')
    const undoWithWrite = await callError('undo')
    note('undo of an agent edit while the write node exists', undoWithWrite)
    expect(undoWithWrite).toContain(UNDO_OUTPUT_REFUSED)
    expect(names(await getGraph())).toContain('after_write')
    await expectUnchanged('undo refused')

    // (d) The agent removes the write node; `undo` is refused, and it does not come back.
    const removed = await callJson<{ removed: string[] }>('remove_nodes', {
      node_ids: [writeNode!.id],
    })
    expect(removed.removed).toEqual([writeNode!.id])
    const undoRemoval = await callError('undo')
    note('undo after removing the write node', undoRemoval)
    expect(undoRemoval).toContain(NOTHING_TO_UNDO)
    const afterUndo = await getGraph()
    expect(afterUndo.nodes.some((node) => node.code.includes(writeTargetEnso))).toBe(false)
    expect(names(afterUndo)).toContain('after_write')
    await expectUnchanged('the removal was not undone', 8_000)

    // (e) With the code gone, the agents' own history works again, from here on.
    await callJson('add_nodes', { statements: ['after_gone = 2'] })
    const undoneAfter = await callJson<HistoryAnswer>('undo')
    note('undo with the write code gone', undoneAfter)
    expect(undoneAfter).toEqual({ undone: true, can_undo: false, can_redo: true })
    const graphAfterUndo = await getGraph()
    expect(names(graphAfterUndo)).not.toContain('after_gone')
    expect(graphAfterUndo.nodes.some((node) => node.code.includes(writeTargetEnso))).toBe(false)
    const redoneAfter = await callJson<HistoryAnswer>('redo')
    expect(redoneAfter).toEqual({ redone: true, can_undo: true, can_redo: false })
    expect(names(await getGraph())).toContain('after_gone')
    const refreshedAfter = await callJson<{ refreshed: boolean; settled: boolean }>('refresh')
    note('refresh with the write code gone', refreshedAfter)
    expect(refreshedAfter).toEqual({ refreshed: true, settled: true })
    await expectUnchanged('undo, redo and refresh with the code gone')

    // The control: the detection is real. The user makes the write node again, through the UI,
    // and the file changes.
    await userCreatesNode(WRITE_CODE(writeTargetEnso))
    await expect
      .poll(async () => (await fileNow()).content, { timeout: 120_000, intervals: [250] })
      .not.toBe(written.content)
    note('the user made the write node again', await fileNow())
    await callJson('close_project')
  } finally {
    await client.close()
    await fs.rm(writeTarget, { force: true })
    if (projectPath != null) {
      await fs.rm(projectPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }
})
