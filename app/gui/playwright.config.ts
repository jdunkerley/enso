/** @file Playwright browser testing configuration. */
/**
 * Note that running Playwright in CI poses a number of issues:
 * - `backdrop-filter: blur` is disabled, due to issues with Chromium's `--disable-gpu` flag
 * (see below).
 * - System validation dialogs are not reliable between computers, as they may have different
 * default fonts.
 */
import net from 'node:net'
import path from 'node:path'
import url from 'node:url'
import { defineConfig } from 'playwright/test'
import invariant from 'tiny-invariant'
import { loadEnv } from 'vite'

const UNSAFE_SKIP_BUILD = process.env.PW_UNSAFE_SKIP_BUILD === 'true'
const DEBUG = process.env.DEBUG_TEST === 'true'
const isCI = process.env.CI === 'true'
const isProd = process.env.PROD === 'true'
const TIMEOUT_MS = DEBUG ? 100_000_000 : 25_000
const ACTION_TIMEOUT_MS = DEBUG ? 100_000_000 : 15_000
const EXPECT_TIMEOUT_MS = DEBUG ? 100_000_000 : 10_000

// We tend to use less CPU on CI to reduce the number of failures due to timeouts.
// Instead of using workers on CI, we use shards to run tests in parallel.
const WORKERS = isCI ? 2 : '35%'

const dirName = path.dirname(url.fileURLToPath(import.meta.url))

// === AG Grid licensed / unlicensed test configurations ===
//
// The AG Grid licence key is normally baked in at build time, but `src/config.ts` prefers
// `window.$config` when it is already set — so both code paths can be exercised against a single
// build by injecting the config per project (see `integration-test/mock/registerMocks.ts`).
//
// `appConfig` below is derived from the very `.env.testing` file the test build itself loads, so
// the injected object matches what the build produced, field for field. The AG Grid key is then
// set explicitly per project rather than being inherited: without that, a licence key present in
// the build environment would silently make the "unlicensed" project licensed.
const testingEnv = loadEnv('testing', dirName, 'ENSO_IDE_')
const appConfig = Object.fromEntries(
  Object.entries(testingEnv).map(([key, value]) => [key.replace(/^ENSO_IDE_/, ''), value]),
)
const agGridLicenseKey = appConfig.AG_GRID_LICENSE_KEY
const unlicensedAppConfig = { ...appConfig, AG_GRID_LICENSE_KEY: undefined }

if (!agGridLicenseKey) {
  console.log(
    'No ENSO_IDE_AG_GRID_LICENSE_KEY configured — skipping the AG Grid licensed project. ' +
      'Only the Community (unlicensed) table code paths will be covered.',
  )
}

const viteServerKind =
  UNSAFE_SKIP_BUILD ? 'preview'
  : !isCI && !isProd ? 'dev'
  : 'build|preview'

async function findFreePortInRange(min: number, max: number) {
  invariant(min <= max, 'Minimum port must be less than maximum port.')
  for (let portToCheck = min; portToCheck <= max; portToCheck++) {
    if (await checkAvailablePort(portToCheck)) return portToCheck
  }

  throw new Error('Failed to find a free port.')
}

function checkAvailablePort(port: number) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server
      .unref()
      .on('error', (e: any) => ('EADDRINUSE' === e.code ? resolve(false) : reject(e)))
      .listen(port, () => {
        server.close(() => resolve(true))
      })
  })
}

const portFromEnv = parseInt(process.env.PLAYWRIGHT_PORT ?? '', 10)
const port = Number.isFinite(portFromEnv) ? portFromEnv : await findFreePortInRange(5300, 5999)

if (!Number.isFinite(portFromEnv) || !Number.isFinite(port)) {
  // Avoid spamming this log in each worker thread.
  console.log(`Selected playwright server port: ${port}`)
}

// Make sure to set the env to actual port that is being used. This is necessary for wFemaiorkers to
// pick up the same configuration.
process.env.PLAYWRIGHT_PORT = `${port}`

export default defineConfig({
  fullyParallel: true,
  ...(WORKERS ? { workers: WORKERS } : {}),
  forbidOnly: isCI,
  // Make test preview use the same port as test URL, so that svg icons are properly displayed.
  // When reusing running dev server, the port will have to be different and icons will unfortunately
  // not show properly. This is only a visual glitch in the reporter and does not impact test results.
  // Pair `list` (live progress on stdout) with `html` (browsable report on disk). The HTML
  // reporter is configured with `open: 'never'` so the local run does not block holding open a
  // background server after the suite finishes — open the report explicitly with
  // `pnpm exec playwright show-report` when you actually need it.
  reporter:
    isCI ?
      [['list'], ['blob']]
    : [['list'], ['html', { open: 'never', port: await findFreePortInRange(port, port + 5) }]],
  retries: isCI ? 1 : 0,
  timeout: TIMEOUT_MS,
  expect: {
    toHaveScreenshot: { threshold: 0 },
    timeout: EXPECT_TIMEOUT_MS,
  },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1920, height: 1750 },
    actionTimeout: ACTION_TIMEOUT_MS,
    trace: 'retain-on-failure',
    headless: !DEBUG,
    screenshot: 'only-on-failure',
    launchOptions:
      DEBUG ?
        {}
      : {
          ignoreDefaultArgs: ['--headless'],
          args: [
            // Much closer to headful Chromium than classic headless.
            '--headless=new',
            // Required for `backdrop-filter: blur` to work.
            '--use-angle=swiftshader',
            // `--disable-gpu` disables `backdrop-filter: blur`, which is not handled by
            // the software (CPU) compositor. This flag MUST stay if screenshot testing/
            // visual regression testing is needed, as CI does not have a GPU.
            '--disable-gpu',
            // Fully disable GPU process.
            '--disable-software-rasterizer',
            // Disable text subpixel antialiasing.
            '--font-render-hinting=medium',
            '--disable-skia-runtime-opts',
            '--disable-system-font-check',
            '--disable-font-subpixel-positioning',
            '--disable-lcd-text',
          ],
        },
  },
  projects: [
    // Setup project
    {
      name: 'Setup',
      testDir: './integration-test',
      testMatch: 'setup.ts',
    },
    {
      // Runs the whole suite with no AG Grid licence, exercising the Community fallbacks.
      name: 'Integration Tests',
      testDir: './integration-test',
      testMatch: '**/*.spec.ts',
      dependencies: ['Setup'],
      use: {
        storageState: path.join(dirName, './playwright/.auth/user.json'),
        appConfig: unlicensedAppConfig,
      },
    },
    // Re-runs only the grid-dependent specs (tagged `@ag-grid`) with a licence configured, so the
    // AG Grid Enterprise path keeps its coverage too. Registered only when a key is available —
    // an invalid key would exercise a watermarked, licence-erroring grid rather than the real
    // licensed behaviour, which is worse than honestly skipping it.
    ...(agGridLicenseKey ?
      [
        {
          name: 'Integration Tests (AG Grid licensed)',
          testDir: './integration-test',
          testMatch: '**/*.spec.ts',
          grep: /@ag-grid/,
          dependencies: ['Setup'],
          use: {
            storageState: path.join(dirName, './playwright/.auth/user.json'),
            appConfig,
          },
        },
      ]
    : []),
  ],
  webServer: [
    {
      command: runVite(...viteServerKind.split('|')),
      timeout: 480 * 1000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
      port,
    },
  ],
})

function runVite(...commands: string[]) {
  const portArgs = (cmd: string) => (cmd !== 'build' ? `--strictPort --port ${port}` : '')
  // Avoid using npm commands for faster startup and compatibility with bazel environment
  return commands
    .map((c) => `node_modules/.bin/vite -c vite.test.config.ts ${portArgs(c)} ${c}`)
    .join(' && ')
}
