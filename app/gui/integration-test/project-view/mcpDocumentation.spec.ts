/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The MCP documentation tools, `get_documentation` and `set_documentation`, and the window
 * handler `store_image` behind `add_image`, driving the real editor: a call is delivered as
 * Electron main would (`window.__mcpCall`, `mock/registerMocks.ts`), and the spec checks the
 * documentation panel, the undo stack and the mock project's `images` folder.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'
import {
  mockExecutionEnvironment,
  mockImageNames,
  restoreMockImages,
  setMockExecutionMode,
} from 'integration-test/mock/lsHandler'
import * as locate from './locate'

// Each test opens the project; the first of a worker can take ~20 s on a cold dev server.
test.setTimeout(60_000)
test.afterEach(restoreMockImages)

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

/**
 * Delivers the tool call as Electron main would, and resolves with its result. Documentation
 * changes nothing the engine runs, so an edit settles at once and the mock need report nothing.
 */
function call(page: Page, tool: string, args: object = {}): Promise<ToolResult> {
  return page.evaluate(
    ([tool, args]) =>
      (
        window as unknown as {
          __mcpCall: (tool: string, args: unknown) => Promise<ToolResult>
        }
      ).__mcpCall(tool as string, args),
    [tool, args] as const,
  )
}

/** The tool's value, parsed; fails the test on an error. */
async function callOk(page: Page, tool: string, args: object = {}) {
  const result = await call(page, tool, args)
  assert(result.ok, `${tool} failed: ${result.error}`)
  return JSON.parse(result.value!)
}

async function nodeId(page: Page, name: string): Promise<string> {
  const graph = await callOk(page, 'get_graph', { previews: false })
  const node = graph.nodes.find((n: { name: string | null }) => n.name === name)
  assert(node != null, `no node ${name}`)
  return node.id
}

/** The start of the main method's documentation in the mock project (`mock/lsHandler.ts`). */
const MAIN_DOCS_START = 'The main method'
const NEW_DOCS = '# Totals by region\n\nSums the sales of each region.'

test('set_documentation replaces the documentation the panel shows, as one undo step', async ({
  editorPage,
  page,
}) => {
  await editorPage.toggleDocsAssetPanel()
  const docs = page.getByTestId('documentation-editor-content')
  await expect(docs).toContainText(MAIN_DOCS_START)
  const before = await callOk(page, 'get_documentation')
  expect(before.method).toBe('main')
  expect(before.text.startsWith(MAIN_DOCS_START)).toBe(true)
  expect(before.truncated).toBe(false)

  expect(await callOk(page, 'set_documentation', { text: NEW_DOCS })).toEqual({
    method: 'main',
    characters: NEW_DOCS.length,
    settled: true,
  })
  expect(await callOk(page, 'get_documentation')).toEqual({
    method: 'main',
    text: NEW_DOCS,
    truncated: false,
  })
  // The panel is bound to the same text, so it shows the agent's edit while open.
  await expect(docs).toContainText('Sums the sales of each region.')
  await expect(docs).not.toContainText(MAIN_DOCS_START)

  // The same text again is no edit.
  expect((await callOk(page, 'set_documentation', { text: NEW_DOCS })).unchanged).toBe(true)

  await locate.graphEditor(page).click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(docs).toContainText(MAIN_DOCS_START)
  expect((await callOk(page, 'get_documentation')).text).toBe(before.text)
})

test("after open_method the tools read and write that function's documentation", async ({
  editorPage,
  page,
}) => {
  await editorPage.mockUserDefinedFunctionInfo('final', 'func1')
  const main = (await callOk(page, 'get_documentation')).text
  const final = await nodeId(page, 'final')
  expect(await callOk(page, 'open_method', { node_id: final })).toEqual({ method: 'func1' })

  expect(await callOk(page, 'get_documentation')).toEqual({
    method: 'func1',
    text: 'A User Defined Function',
    truncated: false,
  })
  await callOk(page, 'set_documentation', { text: 'Subtracts five from what func2 gives.' })
  expect((await callOk(page, 'get_documentation')).text).toBe(
    'Subtracts five from what func2 gives.',
  )

  expect(await callOk(page, 'open_method')).toEqual({ method: 'main' })
  expect(await callOk(page, 'get_documentation')).toEqual({
    method: 'main',
    text: main,
    truncated: false,
  })
})

test('in Live mode the documentation is read but not replaced', async ({ editorPage, page }) => {
  await editorPage
  const before = await callOk(page, 'get_documentation')
  setMockExecutionMode('live')
  await expect.poll(mockExecutionEnvironment).toBe('Live')

  expect(await callOk(page, 'get_documentation')).toEqual(before)
  const refused = await call(page, 'set_documentation', { text: NEW_DOCS })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('Live mode')
  expect(await callOk(page, 'get_documentation')).toEqual(before)
})

/** A PNG of one pixel, as main sends an image to `store_image`: base64. */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('store_image keeps every image, and the documentation shows the Markdown it answers', async ({
  editorPage,
  page,
}) => {
  await editorPage.toggleDocsAssetPanel()
  const docs = page.getByTestId('documentation-editor-content')
  await expect(docs).toContainText(MAIN_DOCS_START)
  const bytes = Buffer.from(PIXEL_PNG, 'base64').length

  // Main sends the name it settled on (`add_image` forces the extension).
  const first = await callOk(page, 'store_image', { data: PIXEL_PNG, name: 'agent chart.png' })
  expect(first).toEqual({
    path: '/images/agent%20chart.png',
    markdown: '![agent chart](/images/agent%20chart.png)',
    bytes,
  })
  // The same name again is never written over: it gets a name of its own.
  const second = await callOk(page, 'store_image', { data: PIXEL_PNG, name: 'agent chart.png' })
  expect(second).toEqual({
    path: '/images/agent%20chart_1.png',
    markdown: '![agent chart_1](/images/agent%20chart_1.png)',
    bytes,
  })
  expect(mockImageNames()).toEqual(
    expect.arrayContaining(['image.png', 'agent chart.png', 'agent chart_1.png']),
  )

  // Storing is not an edit: the documentation is unchanged until the agent sends the Markdown.
  expect((await callOk(page, 'get_documentation')).text.startsWith(MAIN_DOCS_START)).toBe(true)
  await callOk(page, 'set_documentation', {
    text: `# Chart\n\n${first.markdown}\n\n${second.markdown}\n`,
  })
  for (const alt of ['agent chart', 'agent chart_1']) {
    const image = docs.getByAltText(alt, { exact: true })
    await expect(image).toHaveCount(1)
    // Loaded from the stored bytes: an image that failed has no natural size.
    await expect(image).toHaveJSProperty('naturalWidth', 1)
  }

  const refused = await call(page, 'store_image', { data: 'not base64!', name: 'x.png' })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain('not base64')
})
