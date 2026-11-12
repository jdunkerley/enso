/** @file Commonly used functions for electron tests */
import { execFile, type ExecFileException } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  type TestInfo,
} from 'playwright/test'
import { electronExecutablePath } from './packagedIde'

const LOADING_TIMEOUT = 10000

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
   * Whether the app runs with its spare engine. Default `false`: every other spec
   * runs with `ENSO_SPARE_ENGINE=0`, so a spare never changes its timing. With it, the JDK AOT
   * cache is a fresh directory of the test's own (`ENSO_JVM_AOT_DIR`), so it is always trained
   * first, and deleted afterwards: never the user's, since a training keeps only the two newest
   * keys and could delete an installed IDE's cache. Without it, there is no cache
   * (`ENSO_JVM_AOT=0`): on CI's two CPUs a training slowed every open, each open killed it so it
   * never finished, and its toast covered the controls the specs click.
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
  app: async function (
    { projectsDir, testRunId, aiEnabled, welcomeProject, spareEngine },
    use,
    testInfo,
  ) {
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
      ...(spareEngine ?
        { ENSO_SPARE_ENGINE: '1', ENSO_JVM_AOT_DIR: jvmAotDir }
      : { ENSO_SPARE_ENGINE: '0', ENSO_JVM_AOT: '0' }),
    }
    const app = await _electron.launch({ executablePath: electronExecutablePath, args, env })
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      await use(app)
      // Note [A Failed Test Dumps The Engine's Threads].
      if (testInfo.status !== testInfo.expectedStatus) {
        await dumpEngineState(app, testRunId, testInfo)
      }
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

/* Note [A Failed Test Dumps The Engine's Threads]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * On the Windows CI runner the JVM engine's first execution of a new project did not finish in
 * 300 s (#666), and its INFO log did not say why. When a test fails under CI, before the app
 * closes, this writes `test-traces/<run>-engine.txt`: the CPU time of the busiest processes, twice
 * 10 s apart (busy or waiting?), and the threads of every JVM. The bundled runtime has no `jcmd`, so
 * it uses the runner's own JDK (`JAVA_HOME_25_X64`, else `JAVA_HOME_21_X64`, else `JAVA_HOME`).
 * A missing tool is noted in the file, never fatal.
 *
 * The first dumps (#674) showed no deadlock: in each try one of the IDE's own Electron processes had
 * used 1,300 to 1,600 s of CPU while the engine's JVM had used ~50 s, and a `git status` of the
 * project timed out too. So the file also lists the command line of each `enso`/`java` process,
 * whose `--type=` names the Electron helper, and says when a command was killed by its timeout
 * (the first process list and `jcmd -l` failed with no other output then).
 *
 * Those dumps never reached anyone: with the hang each try took ~12 minutes, the job's time limit
 * cancelled the run in the third, and the traces are uploaded only on failure. So the dump is also
 * printed (the `line` reporter shows a test's output as it comes; `dot` did not), and it starts
 * with Electron's own `app.getAppMetrics()`: each of its processes' type and CPU time, asked of the
 * main process with a time limit, since that process may be the starved one.
 */
async function dumpEngineState(
  app: ElectronApplication,
  testRunId: string,
  testInfo: TestInfo,
): Promise<void> {
  if (process.env.CI == null) return
  const run = (file: string, args: string[]) =>
    new Promise<string>((resolve) =>
      execFile(file, args, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (error, out, err) =>
        resolve(`${out}${err}${error != null ? `\n(${describeFailure(error)})` : ''}`),
      ),
    )
  const processes = () =>
    process.platform === 'win32' ?
      run('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Id,ProcessName,CPU,WorkingSet64 | Format-Table -AutoSize | Out-String -Width 200',
      ])
    : run('ps', ['-eo', 'pid,ppid,pcpu,cputime,rss,comm', '--sort=-pcpu'])
  // Which of the IDE's processes is which: Electron's helpers say `--type=gpu-process`,
  // `--type=renderer` or `--type=utility` (the ydoc host); the main process says none.
  const commandLines = () =>
    process.platform === 'win32' ?
      run('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "Name=\'enso.exe\' or Name=\'java.exe\'" | ForEach-Object { \'{0} (parent {1}, {2:N0} s CPU): {3}\' -f $_.ProcessId, $_.ParentProcessId, (($_.KernelModeTime + $_.UserModeTime) / 1e7), "$($_.CommandLine)".Substring(0, [Math]::Min(400, "$($_.CommandLine)".Length)) }',
      ])
    : run('ps', ['-eo', 'pid,ppid,args', '--sort=-pcpu'])
  const sections = [`Test: ${testInfo.titlePath.join(' > ')} (${testInfo.status})`]
  sections.push(`Electron app metrics at ${new Date().toISOString()}:\n${await appMetrics(app)}`)
  sections.push(`Processes at ${new Date().toISOString()}:\n${await processes()}`)
  await new Promise((resolve) => setTimeout(resolve, 10_000))
  sections.push(`Processes at ${new Date().toISOString()}:\n${await processes()}`)
  sections.push(`Command lines at ${new Date().toISOString()}:\n${await commandLines()}`)
  const javaHome = [
    process.env.JAVA_HOME_25_X64,
    process.env.JAVA_HOME_21_X64,
    process.env.JAVA_HOME,
  ].find((home) => home != null && home !== '')
  const jcmd =
    javaHome && path.join(javaHome, 'bin', process.platform === 'win32' ? 'jcmd.exe' : 'jcmd')
  if (!jcmd || !existsSync(jcmd)) {
    sections.push('No jcmd: no JAVA_HOME_25_X64, JAVA_HOME_21_X64 or JAVA_HOME with one.')
  } else {
    const list = await run(jcmd, ['-l'])
    sections.push(`${jcmd} -l:\n${list}`)
    for (const line of list.split(/\r?\n/)) {
      const [pid, ...main] = line.trim().split(' ')
      if (pid == null || !/^\d+$/.test(pid) || main.join(' ').includes('JCmd')) continue
      sections.push(
        `Threads of ${pid} (${main.join(' ')}):\n${await run(jcmd, [pid, 'Thread.print'])}`,
      )
    }
  }
  const dump = sections.join('\n\n')
  await fs.mkdir('test-traces', { recursive: true })
  await fs.writeFile(`test-traces/${testRunId}-engine.txt`, dump)
  console.log(`==== Engine dump of ${testRunId} ====\n${dump}\n==== End of the engine dump ====`)
}

/**
 * Electron's view of its processes: pid, type (`Browser` is the main process, then `GPU`, `Tab`,
 * `Utility`), cumulative CPU seconds and the current CPU percentage. At most 30 s.
 */
async function appMetrics(app: ElectronApplication): Promise<string> {
  const metrics = app
    .evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map(
          (m) =>
            `${m.pid} ${m.type}${m.serviceName ? ` (${m.serviceName})` : ''}: ` +
            `${(m.cpu.cumulativeCPUUsage ?? 0).toFixed(1)} s CPU, ` +
            `${m.cpu.percentCPUUsage.toFixed(1)} % now`,
        )
        .join('\n'),
    )
    .catch((error: unknown) => `(failed: ${String(error)})`)
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => resolve('(no answer within 30 s)'), 30_000),
  )
  return Promise.race([metrics, timeout])
}

/** Why a command of the dump failed: Node's message alone was only "Command failed: <command>". */
function describeFailure(error: ExecFileException): string {
  if (error.killed) return `killed after 120 s: ${error.cmd ?? ''}`
  return `${error.message.trim()} (exit code ${error.code ?? '?'}, signal ${error.signal ?? 'none'})`
}

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
