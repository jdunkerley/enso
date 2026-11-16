/* eslint-disable camelcase -- tool argument and result names are snake_case on the wire */
/**
 * @file The MCP app tools driving the real app from the dashboard: a tool call is delivered as
 * Electron main would (`window.__mcpCall`, `mock/registerMocks.ts`) and the app shell's handlers
 * answer it, whatever page is showing.
 */
import assert from 'assert'
import { expect, test, type Page } from 'integration-test/base'

// Opening a project starts the editor: the first test of a worker can take ~20 s on a cold dev
// server, as in `mcpEdit.spec.ts`.
test.setTimeout(90_000)

/** The mocked Drive's root (`mock/localApi.ts`), and its default project. */
const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT = { name: 'Mock Project', path: `${ROOT}/Mock_Project` }
/** `NO_PROJECT_ERROR` in `$/mcp/toolDispatcher.ts`. */
const NO_PROJECT_ERROR = 'No project is open in Enso. Ask the user to open one.'

interface ToolResult {
  ok: boolean
  value?: string
  error?: string
}

async function call(page: Page, tool: string, args: object = {}): Promise<ToolResult> {
  return page.evaluate(
    ([tool, args]) =>
      (
        window as unknown as { __mcpCall: (tool: string, args: unknown) => Promise<ToolResult> }
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

test('get_app_state reports the dashboard and no project', async ({ drivePage, page }) => {
  await drivePage
  expect(await callOk(page, 'get_app_state')).toEqual({
    page: 'dashboard',
    project: null,
    open_projects: [],
    drive_root: ROOT,
  })
  // The project tools still say that no project is open.
  expect(await call(page, 'get_graph', { previews: false })).toEqual({
    ok: false,
    error: NO_PROJECT_ERROR,
  })
})

test("list_projects lists the Drive's projects", async ({ drivePage, page }) => {
  await drivePage
  expect(await callOk(page, 'list_projects')).toEqual({
    directory: ROOT,
    projects: [{ ...MOCK_PROJECT, open: false }],
  })
})

test('open_project opens the project, then the project tools answer', async ({
  drivePage,
  page,
}) => {
  await drivePage
  expect(await callOk(page, 'open_project', { path: MOCK_PROJECT.path })).toEqual(MOCK_PROJECT)
  await expect(page.getByRole('tab', { name: MOCK_PROJECT.name })).toHaveClass(/selected/)
  const graph = await callOk(page, 'get_graph', { previews: false })
  expect(graph.nodes.length).toBeGreaterThan(0)
  expect(await callOk(page, 'get_app_state')).toEqual({
    page: 'project',
    project: MOCK_PROJECT,
    open_projects: [MOCK_PROJECT],
    drive_root: ROOT,
  })
  expect(await callOk(page, 'list_projects')).toEqual({
    directory: ROOT,
    projects: [{ ...MOCK_PROJECT, open: true }],
  })
})

test('open_project refuses a path outside the Drive', async ({ drivePage, page }) => {
  await drivePage
  for (const path of ['/home/user/enso/Downloads', `${ROOT}/../Downloads`, 'Mock_Project']) {
    expect(await call(page, 'open_project', { path })).toEqual({
      ok: false,
      error: `That folder is outside the Drive. Use a path under ${ROOT} (or a saved local folder).`,
    })
  }
  await expect(page.getByRole('tab', { name: MOCK_PROJECT.name })).toBeHidden()
})

test('close_project returns to the dashboard', async ({ drivePage, page }) => {
  await drivePage
  await callOk(page, 'open_project', { path: MOCK_PROJECT.path })
  expect(await callOk(page, 'close_project')).toEqual({
    closed: MOCK_PROJECT,
    page: 'dashboard',
    project: null,
  })
  await expect(page.getByRole('tab', { name: MOCK_PROJECT.name })).toBeHidden()
  expect((await callOk(page, 'get_app_state')).page).toBe('dashboard')
  expect(await call(page, 'get_graph', { previews: false })).toEqual({
    ok: false,
    error: NO_PROJECT_ERROR,
  })
  expect(await call(page, 'close_project')).toEqual({
    ok: false,
    error: 'No project is on screen.',
  })
})

test('create_project creates a project and opens it', async ({ drivePage, page, localApi }) => {
  await drivePage
  const calls = localApi.trackCalls()
  const created = await callOk(page, 'create_project', { name: 'Sales' })
  expect(created).toEqual({ name: 'Sales', path: `${ROOT}/Sales` })
  expect(calls.createProject).toEqual([
    expect.objectContaining({ name: 'Sales', projectsDirectory: ROOT }),
  ])
  await expect(page.getByRole('tab', { name: 'Sales' })).toHaveClass(/selected/)
  expect((await callOk(page, 'get_app_state')).project).toEqual(created)
  await callOk(page, 'get_graph', { previews: false })
  const projects = (await callOk(page, 'list_projects')).projects
  expect(projects).toContainEqual({ ...created, open: true })
})
