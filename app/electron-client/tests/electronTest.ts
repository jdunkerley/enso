/** @file Commonly used functions for electron tests */
import { TEXTS } from 'enso-common/src/text'
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

const LOADING_TIMEOUT = 10000
const TEXT = TEXTS.english

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
const TEST_USER_FILE = path.join(import.meta.dirname, '../playwright/.auth/user.json')
const POSSIBLE_ELECTRON_PATHS = [
  '../../../dist/ide/linux-unpacked/enso',
  '../../../dist/ide/win-unpacked/Enso.exe',
  '../../../dist/ide/mac/Enso.app/Contents/MacOS/Enso',
  '../../../dist/ide/mac-arm64/Enso.app/Contents/MacOS/Enso',
]

/**
 * Enso Cloud test-user credentials, read from `playwright/.auth/user.json`.
 *
 * Empty strings when the file is missing or blank — a local-only build has no login screen, so
 * {@link loginAsTestUser} never uses them. Cloud specs that genuinely need a real account gate
 * themselves on `ENSO_TEST_CLOUD`.
 */
export const credentials: { readonly user: string; readonly password: string } = await fs
  .readFile(TEST_USER_FILE, { encoding: 'utf-8' })
  .then((contents) => {
    const parsed: unknown = JSON.parse(contents)
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      'user' in parsed &&
      typeof parsed.user === 'string' &&
      'password' in parsed &&
      typeof parsed.password === 'string'
    ) {
      return { user: parsed.user, password: parsed.password }
    }
    return { user: '', password: '' }
  })
  .catch(() => ({ user: '', password: '' }))

export const electronExecutablePath = await (async () => {
  try {
    const promises = POSSIBLE_ELECTRON_PATHS.map((p) => path.resolve(import.meta.dirname, p)).map(
      (p) => fs.access(p, fs.constants.X_OK).then(() => p),
    )
    return await Promise.any(promises)
  } catch {
    throw Error('Cannot find Enso package')
  }
})()

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

  /** Setup for all tests: Create an electron-based app instance. */
  app: async function ({ projectsDir, testRunId, aiEnabled }, use) {
    const args = process.env.ENSO_TEST_APP_ARGS?.split(',') ?? []
    const app = await _electron.launch({
      executablePath: electronExecutablePath,
      args,
      env: {
        ...process.env,
        ENSO_TEST: 'true',
        ENSO_TEST_PROJECTS_DIR: projectsDir.replace(/\\/g, '/'),
        ...(aiEnabled ? {} : { ENSO_AI_DISABLED: '1' }),
      },
    })
    // Set the password as global var before turning on tracing.
    // This way it will be not disclosed to anyone downloading traces of failed tests.
    ;(await app.firstWindow()).evaluate((password) => {
      ;(window as any).passwordOverride = password
    }, credentials.password)
    await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    await use(app)
    await app.context().tracing.stop({ path: `test-traces/${testRunId}.zip` })
    await app.close()
  },
  page: async function ({ app, viewport }, use) {
    const innerPage = await app.firstWindow()
    if (viewport) innerPage.setViewportSize(viewport)
    await use(innerPage)
  },
})

/**
 * Bring the app to a ready dashboard.
 *
 * On a build with Enso Cloud configured this logs in as the test user (credentials from
 * `playwright/.auth/user.json`) and accepts the Terms of Service / Privacy Policy. On a
 * local-only build there is no login screen — the app starts already signed in with a local
 * stand-in session — so this only waits for the app to finish loading.
 */
export async function loginAsTestUser(page: Page) {
  const loginHeading = page.getByText('Login to your account')
  const dashboardReady = page
    .getByTestId('drive-view')
    .or(page.getByRole('tab', { name: 'Getting Started with Enso Analytics' }))
  await expect(loginHeading.or(dashboardReady).first()).toBeVisible({ timeout: 60000 })
  if (!(await loginHeading.isVisible())) return

  await expect(page.getByRole('textbox', { name: 'email' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'password' })).toBeVisible()
  await page.getByRole('textbox', { name: 'email' }).fill(credentials.user)
  // Put some placeholder - the actual password was set in fixture (see above).
  await page.getByRole('textbox', { name: 'password' }).fill('mellon')
  await page.getByRole('button', { name: TEXT.login, exact: true }).click()

  await expect(
    page
      .getByRole('group', { name: TEXT.licenseAgreementCheckbox })
      .getByText(TEXT.licenseAgreementCheckbox),
  ).toBeVisible({ timeout: 60000 })
  await page
    .getByRole('group', { name: TEXT.licenseAgreementCheckbox })
    .getByText(TEXT.licenseAgreementCheckbox)
    .click()
  await page
    .getByRole('group', { name: TEXT.privacyPolicyCheckbox })
    .getByText(TEXT.privacyPolicyCheckbox)
    .click()

  await page.getByRole('button', { name: TEXT.accept }).click()
}

/**
 * Time budget for the first project of a test to become interactive. Each spec launches a fresh
 * Electron process whose Language Server has to JIT-warm and load the standard library on the
 * first project open; the IR cache is pre-warmed in `globalSetup.ts` so this is a load, not a
 * from-source compile, but on a slow CI runner it can still take a while.
 */
const FIRST_PROJECT_TIMEOUT = 90000

/** Create a new Enso project */
export async function createNewProject(page: Page) {
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.GraphNode')).toHaveCount(1, { timeout: FIRST_PROJECT_TIMEOUT })

  const tableViz = page.locator('.TableVisualization')
  await expect(tableViz).toContainText('Welcome To Enso!', { timeout: FIRST_PROJECT_TIMEOUT })
}

/** If welcome project is to be opened, navigate back to the dashboard. */
export async function closeWelcome(page: Page) {
  const welcomeProjectTab = page.getByRole('tab', { name: 'Getting Started with Enso Analytics' })
  const loadingIndicator = welcomeProjectTab.locator('.LoadingSpinner')
  await Promise.race([
    welcomeProjectTab
      .waitFor({ state: 'visible', timeout: 0 })
      .then(() => loadingIndicator.waitFor({ state: 'hidden' })),
    page.waitForTimeout(3000),
  ])
  if (await welcomeProjectTab.isVisible()) {
    await welcomeProjectTab.locator('.CloseButton').click()
  }
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
 * Wait for the Samples folder download
 * This function retries to access passed file every 5 sec, fails after 1 min
 */
export async function waitForDownload(pathToFile: string): Promise<void> {
  const start = Date.now()
  while (true) {
    try {
      await fs.access(pathToFile) // ✅ file exists
      return
    } catch {
      if (Date.now() - start > 60_000) {
        throw new Error(`File ${pathToFile} not found within 60 seconds`)
      }
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }
}

/** Open drop-down menu in WidgetSelection with given label. */
export async function openDropdownInWidget(page: Page, label: string) {
  await page.locator('.WidgetSelection', { hasText: new RegExp(`^${label}$`) }).click()
  // Wait for any in-flight dropdown transitions to finish before returning, so subsequent
  // item clicks don't race with a leaving/entering animation.
  await expect(page.locator('.DropdownWidget[data-transitioning]')).toHaveCount(0)
}

/** Find and click + button in an empty Vector Widget inside provided locator. */
export function addFirstElementToWidgetVector(locator: Locator) {
  return locator.getByRole('list').filter({ hasText: /^$/ }).getByLabel('Add a new item').click()
}
