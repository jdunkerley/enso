/** @file Commonly used functions for electron tests */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  _electron,
  test as base,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from 'playwright/test'
import { electronExecutablePath } from './packagedIde'

const LOADING_TIMEOUT = 10000
/** The JDK AOT cache of every spec but the spare engine's (see `spareEngine`). */
const SHARED_JVM_AOT_DIR = path.join(os.tmpdir(), 'enso-test-jvm-aot', 'shared')

/**
 * The packaged engine is markedly slower on the Windows CI runner — real-time antivirus scanning
 * of the freshly-unpacked engine turns every Language Server round-trip (compile, execute,
 * visualise) into a multi-second wait, and specs that drive a long editing session accumulate
 * enough of those to blow their budget even though the app is healthy. Those specs are skipped
 * there; the lighter `Project Duplicate` smoke still runs, and Linux runs everything.
 * TODO(packaged-ide-windows-perf): profile and re-enable.
 */
export const SKIP_ON_WINDOWS_CI = process.env.CI != null && process.platform === 'win32'
export const SKIP_ON_WINDOWS_CI_REASON =
  'Slow on the Windows CI runner (see SKIP_ON_WINDOWS_CI in electronTest.ts)'
export { electronExecutablePath }

/**
 * Tests run on electron executable.
 *
 * Similar to playwright's test, but launches electron, and passes Page of the main window.
 */
export const test = base.extend<{
  testRunId: string
  projectsDir: string
  /**
   * Whether the launched Electron process should spawn the local Claude agent. Default `false`
   * — the test fixture sets `ENSO_AI_DISABLED=1` so a developer's locally-installed `claude` is
   * not accidentally invoked during a non-AI spec. AI specs override with
   * `test.use({ aiEnabled: true })`.
   */
  aiEnabled: boolean
  /**
   * Whether the app opens the Getting_Started sample, as a fresh install does. Default `false`:
   * every spec starts with a fresh projects directory, and the fixture passes
   * `--no-welcome-project` so that it does not pay for a project open and close. The spec that
   * checks the fresh-install landing overrides it with `test.use({ welcomeProject: true })`.
   */
  welcomeProject: boolean
  /**
   * Whether the app runs the JVM engine with its spare engine. Default `false`: every other spec
   * runs with `ENSO_SPARE_ENGINE=0`, so a spare never changes its timing, and with the engine mode
   * the shell gives (`ENSO_ENGINE_MODE`; unset is the app's default, the JVM). With it, the JDK AOT
   * cache is a fresh directory of the test's own (`ENSO_JVM_AOT_DIR`), so it is always trained
   * first, and deleted afterwards. Without it, the cache is one directory shared by every test of
   * the run (trained once, kept). Either way it is never the user's: a training keeps only the
   * two newest keys, so it could delete an installed IDE's cache.
   */
  spareEngine: boolean
  app: ElectronApplication
  page: Page
}>({
  // eslint-disable-next-line no-empty-pattern
  testRunId: async function ({}, use, testInfo) {
    await use(`${testInfo.titlePath.join('-')}-${Date.now()}`)
  },
  projectsDir: async function ({ testRunId }, use) {
    const projectsDir = path.join(os.tmpdir(), 'enso-test-projects', testRunId)
    await use(projectsDir)
  },
  aiEnabled: [false, { option: true }],
  welcomeProject: [false, { option: true }],
  spareEngine: [false, { option: true }],

  /** Setup for all tests: Create an electron-based app instance. */
  app: async function ({ projectsDir, testRunId, aiEnabled, welcomeProject, spareEngine }, use) {
    const args = [
      ...(process.env.ENSO_TEST_APP_ARGS?.split(',') ?? []),
      ...(welcomeProject ? [] : ['--no-welcome-project']),
    ]
    const jvmAotDir = path.join(os.tmpdir(), 'enso-test-jvm-aot', testRunId)
    const env = {
      ...process.env,
      ENSO_TEST: 'true',
      ENSO_TEST_PROJECTS_DIR: projectsDir.replace(/\\/g, '/'),
      ...(aiEnabled ? {} : { ENSO_AI_DISABLED: '1' }),
      // The spare spec is always the JVM; the others keep the shell's mode (CI runs one spec again
      // with `ENSO_ENGINE_MODE=native`).
      ...(spareEngine ?
        { ENSO_ENGINE_MODE: 'jvm', ENSO_SPARE_ENGINE: '1', ENSO_JVM_AOT_DIR: jvmAotDir }
      : { ENSO_SPARE_ENGINE: '0', ENSO_JVM_AOT_DIR: SHARED_JVM_AOT_DIR }),
    }
    const app = await _electron.launch({ executablePath: electronExecutablePath, args, env })
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      await use(app)
      await app.context().tracing.stop({ path: `test-traces/${testRunId}.zip` })
      await app.close()
    } finally {
      // On Windows a JVM that is still exiting can hold the cache's files for a moment.
      if (spareEngine) {
        await fs.rm(jvmAotDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    }
  },
  page: async function ({ app, viewport }, use) {
    const innerPage = await app.firstWindow()
    if (viewport) innerPage.setViewportSize(viewport)
    await use(innerPage)
  },
})

/**
 * The tab of the project a fresh install opens: the bundled `Getting_Started` sample
 * (`LOCAL_WELCOME_PROJECT_RELATIVE_PATH` in the GUI's `router/dashboardGuards.ts`). Only a spec
 * that sets `welcomeProject` sees it.
 */
export const WELCOME_PROJECT_TAB = 'Getting_Started'

/** Wait until the app has loaded: the drive (the fixture turns the welcome project off). */
export async function waitForDashboard(page: Page) {
  await expect(page.getByTestId('drive-view')).toBeVisible({ timeout: 60000 })
}

/**
 * Time budget for each stage of a test's first project. Each spec launches a fresh Electron
 * process, so its first project gets a cold Language Server.
 *
 * The two stages differ a lot on the Windows CI runner (2 vCPUs). The graph appears 13-25 s after
 * the project opens. The first visualization comes only once the Language Server has executed the
 * project and loaded every library's suggestions: 91-115 s, sometimes more (#169). Most of that is
 * per-process work, and retries were just as slow, so `globalSetup.ts` cannot warm it away. The
 * standard library is AOT-compiled into the packaged engine, so there is no IR cache to warm.
 * Specs that do not need the visualization should pass `waitForVisualization: false`.
 */
export const FIRST_PROJECT_TIMEOUT = 90000

/**
 * How long to wait for a project the app opens by itself (the welcome project) to show its first
 * visualization: the project open and a cold Language Server's first execution, with headroom.
 */
export const COLD_PROJECT_TIMEOUT = 180_000

/**
 * Create a new Enso project, and wait until its graph is shown and, unless `waitForVisualization`
 * is false, until its "Welcome To Enso!" table visualization has been computed.
 */
export async function createNewProject(
  page: Page,
  { waitForVisualization = true }: { waitForVisualization?: boolean } = {},
) {
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.GraphNode')).toHaveCount(1, { timeout: FIRST_PROJECT_TIMEOUT })
  if (!waitForVisualization) return

  const tableViz = page.locator('.TableVisualization')
  await expect(tableViz).toContainText('Welcome To Enso!', { timeout: FIRST_PROJECT_TIMEOUT })
}

/**
 * Close the welcome project's tab, if it is open. The fixture turns the welcome project off, so
 * this normally finds nothing: it does not wait for the tab to appear.
 */
export async function closeWelcome(page: Page) {
  const welcomeProjectTab = page.getByRole('tab', { name: WELCOME_PROJECT_TAB, exact: true })
  if (!(await welcomeProjectTab.isVisible())) return
  await expect(welcomeProjectTab.locator('.LoadingSpinner')).toHaveCount(0, {
    timeout: COLD_PROJECT_TIMEOUT,
  })
  await answerRepositoryPrompt(
    page,
    // The close button is the tab's sibling (`SelectableTab.vue`), hidden from the a11y tree.
    () =>
      page.locator('.SelectableTab', { has: welcomeProjectTab }).locator('.CloseButton').click(),
    () => expect(welcomeProjectTab).toHaveCount(0, { timeout: 30_000 }),
  )
}

/**
 * Closing a local project may first ask "Keep versions of your projects with git?" (the first save
 * or close in a folder that is not a repository, when git is installed), and the close waits for the
 * answer.
 *
 * This starts the close itself (`close`), so that it can race the prompt against the `project/close`
 * request rather than against the tab disappearing: the tab goes away the moment the close is
 * triggered, while the prompt appears up to a second or so later (the IDE first re-reads the
 * versioning status), and the request is sent only after the prompt has been answered. Answers the
 * prompt with "Not now" if it appeared, then waits for the request and for `closed`. Returns whether
 * the prompt appeared.
 */
export async function answerRepositoryPrompt(
  page: Page,
  close: () => Promise<unknown>,
  closed: () => Promise<unknown>,
): Promise<boolean> {
  const prompt = page.getByTestId('repository-prompt')
  const closeRequest = page.waitForRequest((request) =>
    request.url().endsWith('/api/project-service/project/close'),
  )
  // If `close` throws, nothing awaits the request, so it must not leave an unhandled rejection.
  closeRequest.catch(() => {})
  await close()
  await Promise.race([prompt.waitFor({ state: 'visible' }).catch(() => {}), closeRequest])
  const appeared = await prompt.isVisible()
  if (appeared) await prompt.getByTestId('alert-dialog-cancel').click()
  await closeRequest
  await closed()
  return appeared
}

/**
 * Finds the "newest" project (highest numbered "New Project N") in the user dasboard.
 * @param page - The Playwright Page instance
 * @returns Locator for the newest project
 */
export async function getNewestProject(page: Page): Promise<Locator> {
  await expect(page.getByTestId('drive-view')).toBeVisible({ timeout: LOADING_TIMEOUT })
  const projectsLocator = page.getByTestId('drive-view').getByText(/New Project \d+/)
  await expect(projectsLocator).not.toHaveCount(0)

  const projects = await page
    .getByTestId('drive-view')
    .getByText(/New Project \d+/)
    .all()

  const numbered = await Promise.all(
    projects.map(async (p) => {
      const text = await p.innerText()
      const num = parseInt(text.replace('New Project ', ''), 10)
      return { locator: p, num }
    }),
  )
  return numbered.reduce((a, b) => (a.num > b.num ? a : b)).locator
}

/**
 * Click the eye button, visualizing component data
 */
export async function visualizeData(page: Page) {
  const showViz = page.getByLabel('Show visualization (Space)')
  await showViz.click({ timeout: 5000 })
}

/**
 * Click the eye button to hide an already-shown visualization. Used between checkpoints in
 * multi-step AI tests so the next `.TableVisualization` locator only matches one element.
 *
 * When a visualization is open, the "Hide visualization (Space)" aria-label appears on both
 * the inline node-header toggle and the viz-panel toolbar toggle (both targeting the same
 * `isVisualizationEnabled` state, so clicking either dismisses the viz). `.first()` picks the
 * inline button deterministically and avoids Playwright's strict-mode duplicate-match error.
 */
export async function hideVisualization(page: Page) {
  const hideViz = page.getByLabel('Hide visualization (Space)').first()
  await hideViz.click({ timeout: 5000 })
}

/**
 * Open new component browser refefencing the last created component
 */
export async function createNewComponent(page: Page) {
  const moreButton = page.getByTestId('more-button').getByRole('button', { name: 'More' }).last()
  await moreButton.click()

  await page.keyboard.press('Enter')
}

/**
 * Open new component browser based on the name of referenced parent component
 */
export async function openComponentBrowser(page: Page, parentComponent: string) {
  await page.getByText(parentComponent, { exact: true }).click()
  await page.keyboard.press('Enter')
}

/**
 * Find textbox located in parent component and fill in text value
 */
export async function fillWidgetText(
  page: Page,
  containerName: string,
  value: string,
  index?: number,
) {
  const cont = page.getByText(containerName)

  const box = cont.getByTestId('widget-text-content')
  if (index) return box.nth(index).fill(value)
  else return box.fill(value)
}

/**
 * Wait for a file to appear.
 * This function retries to access the passed file every 5 sec, fails after 1 min.
 */
export async function waitForFile(pathToFile: string): Promise<void> {
  const start = Date.now()
  while (true) {
    try {
      await fs.access(pathToFile) // file exists
      return
    } catch {
      if (Date.now() - start > 60_000) {
        throw new Error(`File ${pathToFile} not found within 60 seconds`)
      }
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

/**
 * Put the bank data of the Getting Started exercises (a generated workbook, see `tests/fixtures`)
 * into `Samples/Data` of the projects directory.
 *
 * The IDE copies its bundled samples to `Samples` at start-up and skips that when the directory
 * exists, so this first waits for a bundled sample to be there. Returns the workbook's path.
 */
export async function addBankData(projectsDir: string): Promise<string> {
  const samples = path.join(projectsDir, 'Samples')
  await waitForFile(path.join(samples, 'Sales_Overview', 'package.yaml'))
  const target = path.join(samples, 'Data', 'sample_bank_data.xlsx')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(path.join(import.meta.dirname, 'fixtures', 'sample_bank_data.xlsx'), target)
  return target
}

/** Open drop-down menu in WidgetSelection with given label. */
export async function openDropdownInWidget(page: Page, label: string) {
  await page.locator('.WidgetSelection', { hasText: new RegExp(`^${label}$`) }).click()
  // Wait for any in-flight dropdown transitions to finish before returning, so subsequent
  // item clicks don't race with a leaving/entering animation.
  await expect(page.locator('.DropdownWidget[data-transitioning]')).toHaveCount(0)
}

/** How far (px) a component's outline may reach past the graph editor's edge and still count as shown. */
const SHOWN_TOLERANCE_PX = 8

/**
 * Click "Show All Components" (Ctrl+Shift+A), which zooms to the selected components or, with
 * nothing selected, to the whole graph, and wait until every element of `targets` sits inside the
 * graph editor and the view has stopped moving.
 *
 * The view is fitted to the components' sizes at the moment of the click, and a component keeps
 * growing for a while as its widgets load, so the click is repeated whenever the view settles with
 * a component still sticking out.
 */
async function showAll(page: Page, targets: Locator) {
  const showAllButton = page.getByLabel('Show All Components')
  const graphEditor = page.locator('.GraphEditor')
  const deadline = Date.now() + 30_000
  let previous = ''
  let state = ''
  let clicked = false
  while (Date.now() < deadline) {
    const bounds = await graphEditor.boundingBox()
    const boxes = await Promise.all((await targets.all()).map((t) => t.boundingBox()))
    state = JSON.stringify({ bounds, boxes })
    const settled = state === previous
    previous = state
    if (settled && bounds && boxes.length > 0 && boxes.every((b) => b != null)) {
      const inside = boxes.every(
        (box) =>
          box!.x >= bounds.x - SHOWN_TOLERANCE_PX &&
          box!.y >= bounds.y - SHOWN_TOLERANCE_PX &&
          box!.x + box!.width <= bounds.x + bounds.width + SHOWN_TOLERANCE_PX &&
          box!.y + box!.height <= bounds.y + bounds.height + SHOWN_TOLERANCE_PX,
      )
      if (inside && clicked) return
      if (!inside || !clicked) {
        await showAllButton.click()
        clicked = true
        previous = ''
      }
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`Components not shown within the graph editor: ${state}`)
}

/**
 * Bring the selected component wholly into view before using its widgets, as a user would.
 *
 * A new component is panned to so that its left edge shows, and it widens as its arguments are
 * filled in; a component wider than the space left runs off the right edge, under the right
 * panel's tabs, where its widgets cannot be clicked. Call this again once filled-in arguments have
 * widened the component, before using the arguments further right.
 */
export async function showSelectedComponent(page: Page) {
  const selected = page.locator('.GraphNode.selected')
  await expect(selected).toHaveCount(1)
  await showAll(page, selected)
}

/**
 * Bring every component into view, e.g. before picking a source component by its position in the
 * DOM. "Show All" zooms to the selection if there is one, so first deselect by clicking the graph's
 * background, at a point that no component covers.
 */
export async function showAllComponents(page: Page) {
  const nodes = page.locator('.GraphNode')
  const bounds = (await page.locator('.GraphEditor').boundingBox())!
  const occupied = page.locator('.GraphNode, .GraphVisualization, .GraphNodeComment')
  const boxes = (await Promise.all((await occupied.all()).map((n) => n.boundingBox()))).filter(
    (b) => b != null,
  )
  const MARGIN = 24
  // Stay clear of the top bar that overlays the graph, and of the edges.
  const TOP = 64
  let point: { x: number; y: number } | undefined
  for (let y = bounds.y + TOP; y < bounds.y + bounds.height - MARGIN && !point; y += MARGIN) {
    for (let x = bounds.x + MARGIN; x < bounds.x + bounds.width - MARGIN; x += MARGIN) {
      const covered = boxes.some(
        (b) =>
          x > b.x - MARGIN &&
          x < b.x + b.width + MARGIN &&
          y > b.y - MARGIN &&
          y < b.y + b.height + MARGIN,
      )
      if (!covered) {
        point = { x, y }
        break
      }
    }
  }
  if (!point) throw new Error('No empty graph background to click')
  await page.mouse.click(point.x, point.y)
  await expect(page.locator('.GraphNode.selected')).toHaveCount(0)
  await showAll(page, nodes)
}

/** Find and click + button in an empty Vector Widget inside provided locator. */
export function addFirstElementToWidgetVector(locator: Locator) {
  return locator.getByRole('list').filter({ hasText: /^$/ }).getByLabel('Add a new item').click()
}

/**
 * Leave the mouse where nothing is under it and it is off both rails (the left one runs the
 * window's full height, so the corner (0, 0) is on it): the empty bottom of the right rail.
 */
export async function parkMouse(page: Page): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  await page.mouse.move(width - 24, height - 100)
}
