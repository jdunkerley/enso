import type { FeatureFlags } from '$/providers/featureFlags'
import { UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { test as base, expect as baseExpect, type Locator, type Page } from 'playwright/test'
import DrivePageActions from './actions/DrivePageActions'
import type EditorPageActions from './actions/EditorPageActions'
import { mockLocalApi, type MockLocalApi } from './mock/localApi'
import { recordCloudRequests, registerMocks } from './mock/registerMocks'

export type * from 'playwright/test'

/** Wait for the app to load: no loading screen, and the drive (or a project) on screen. */
export async function waitForAppLoaded(page: Page) {
  await page.waitForLoadState()
  await baseExpect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 30_000 })
  await baseExpect(
    page.getByTestId('drive-view').or(page.locator('.ProjectView')).first(),
  ).toBeVisible({ timeout: 30_000 })
}

/**
 * The `$config` the page should boot with, injected before any app script runs. Supplied by
 * each Playwright project in `playwright.config.ts` so the AG Grid licence key is set
 * explicitly per project rather than inherited from whatever the build happened to bake in.
 * See `integration-test/CLAUDE.md` for how the licensed/unlicensed projects differ.
 *
 * Empty (the default) means "no override": nothing is injected and the page boots with whatever
 * Vite baked in. It is not a merge — a non-empty value replaces the whole config — so a project
 * that sets this must supply a complete one, as both integration projects do via `loadEnv`.
 *
 * Exported so `playwright.config.ts` can pass it to `defineConfig`'s generic parameter — without
 * that, `appConfig` in a project's `use` block is not a fixture `defineConfig`'s default type
 * parameter knows about, and TypeScript rejects it (#141).
 */
export type AppConfig = Record<string, string | undefined>

export const test = base.extend<{
  featureFlags: Partial<FeatureFlags>
  /**
   * Whether the mocked Electron API should report the local Claude agent as available. Most
   * specs assume `false`. AI specs opt in with `test.use({ aiAvailable: true })`.
   */
  aiAvailable: boolean
  appConfig: AppConfig
  setupApi: {
    local?: (api: MockLocalApi) => void
    addDefaultProject?: boolean
  }
  /**
   * Every request the page made to Enso Cloud (`CLOUD_URL`), as `METHOD url`. An automatic fixture:
   * each is aborted unless a later route answers it, and a test that leaves one recorded fails.
   */
  cloudRequests: string[]
  localApi: MockLocalApi
  drivePage: DrivePageActions
  editorPage: EditorPageActions
}>({
  featureFlags: [{}, { option: true }],
  aiAvailable: [false, { option: true }],
  appConfig: [{}, { option: true }],
  setupApi: [{}, { option: true }],
  cloudRequests: [
    async ({ page }, use) => {
      const requests = await recordCloudRequests(page)
      await use(requests)
      baseExpect(requests, 'requests to Enso Cloud').toEqual([])
    },
    { auto: true },
  ],
  localApi: async ({ page, setupApi }, use) => {
    const api = await mockLocalApi(page)
    if (setupApi?.addDefaultProject ?? true) {
      api.addProject({
        metadata: {
          id: UUID('135af445-bcfb-42fe-aa74-96f95e99c28b'),
          name: 'Mock Project',
          namespace: 'local',
          created: toRfc3339(new Date()),
        },
      })
    }

    setupApi.local?.(api)
    return use(api)
  },
  drivePage: async ({ page, localApi, featureFlags, aiAvailable, appConfig }, use) => {
    // Only make sure that the local API mock is registered; the spec uses it through `localApi`.
    const _ = { localApi }
    await registerMocks(page, featureFlags, { aiAvailable, appConfig })
    await page.goto('/')
    await waitForAppLoaded(page)
    await use(new DrivePageActions(page, {}))
  },

  editorPage: async ({ drivePage }, use) => {
    const editorPage = drivePage.driveTable
      .openProject('Mock Project')
      .expectProjectEditorOpened('Mock Project')
      .expectNodePositionsInitialized()
      .expectDocsPanel()
      .toggleDocsAssetPanel()
    await use(await editorPage)
    return
  },
})

export const expect = baseExpect.extend({
  /**
   * Ensures that at least one of the elements that the Locator points to,
   * is an attached and visible DOM node.
   */
  async toExist(locator: Locator) {
    // Counter-intuitive, but correct:
    // https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-be-visible
    const assertionName = 'toExist'
    let pass: boolean
    try {
      await expect(locator.first()).toBeVisible()
      pass = true
    } catch {
      pass = false
    }

    const message = () =>
      this.utils.matcherHint(assertionName, locator, '', {
        isNot: this.isNot,
      })

    return {
      message,
      pass,
      name: assertionName,
    }
  },

  async toHaveCountGreaterThan(locator: Locator, n: number) {
    const assertionName = 'toHaveCountGreaterThan'
    let pass: boolean
    try {
      await expect(locator.nth(n)).toBeVisible()
      pass = true
    } catch {
      pass = false
    }

    const message = () =>
      this.utils.matcherHint(assertionName, locator, '', {
        isNot: this.isNot,
      })

    return {
      message,
      pass,
      name: assertionName,
    }
  },

  /**
   * Ensures that the graph node the Locator points to is selected (or, negated, is not). Retries
   * like the built-in assertions: a custom matcher is not retried by Playwright, so it has to
   * delegate to one that is, in the requested direction. Checking once (as this used to, with a
   * 50 ms timeout) made the result depend on whether the app had caught up by then.
   */
  async toBeSelected(locator: Locator, options?: { timeout?: number }) {
    const assertionName = 'toBeSelected'
    const selectedClass = /(?<=^| )selected(?=$| )/
    let pass: boolean
    try {
      const expectation = this.isNot ? baseExpect(locator).not : baseExpect(locator)
      await expectation.toHaveClass(selectedClass, { timeout: options?.timeout ?? this.timeout })
      pass = !this.isNot
    } catch {
      // Do not log the error.
      pass = this.isNot
    }

    const message = () =>
      this.utils.matcherHint(assertionName, locator, '', {
        isNot: this.isNot,
      })

    return {
      message,
      pass,
      name: assertionName,
    }
  },
})
