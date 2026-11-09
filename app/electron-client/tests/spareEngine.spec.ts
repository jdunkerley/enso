/**
 * @file With the JVM engine, the dashboard starts a spare engine, and the next open uses it (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). The service logs
 * `Spare engine: ready …` and `Spare engine: used …` in the main process's output (stdout and
 * stderr).
 */
import { expect } from 'playwright/test'
import {
  createNewProject,
  SKIP_ON_WINDOWS_CI,
  SKIP_ON_WINDOWS_CI_REASON,
  test,
  waitForDashboard,
} from './electronTest'

// At file level, so that the skip comes before the fixture launches an app: a launch that the test
// body then skips still costs the Windows CI runner a start (and once failed loading the window).
test.skip(SKIP_ON_WINDOWS_CI, SKIP_ON_WINDOWS_CI_REASON)
test.use({ spareEngine: true })
// A retry would repeat the whole training: on CI, three tries could outlast the packaging job.
test.describe.configure({ retries: 0 })

test('an open uses the spare engine', async ({ app, page }) => {
  // The fixture's AOT cache directory is empty: the JVM default trains one first (~45 s on a
  // desktop), and no spare starts until that training has ended (`isTraining`, `onTrainingEnded`).
  test.setTimeout(400_000)
  const output: string[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => void output.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk: Buffer) => void output.push(chunk.toString()))
  const at = (text: string) => output.join('').indexOf(text)
  const said = (text: string) => at(text) >= 0
  const trainingEnded = () => said('JDK AOT cache: trained in') || said('training failed')
  await waitForDashboard(page)
  await expect.poll(trainingEnded, { timeout: 240_000 }).toBe(true)
  // `started (pid …)`, or `starting` when the spawn has no pid yet.
  await expect.poll(() => said('Spare engine: start'), { timeout: 30_000 }).toBe(true)
  // Not while the cache trained.
  expect(at('Spare engine: start')).toBeGreaterThan(
    Math.max(at('JDK AOT cache: trained in'), at('training failed')),
  )
  await expect.poll(() => said('Spare engine: ready'), { timeout: 60_000 }).toBe(true)
  await createNewProject(page, { waitForVisualization: false })
  await expect.poll(() => said('Spare engine: used'), { timeout: 60_000 }).toBe(true)
  // The project's engine log says so too (the shim's notice, `spareNotice`). It is a stderr line,
  // which the Logs tab shows with its Engine source only.
  await page.getByTestId('bottomDockButtons').getByTestId('action:graph.toggleLogs').click()
  const panel = page.getByTestId('engine-log-panel')
  await panel.getByTestId('engine-logs-sources-button').click()
  await page
    .getByRole('dialog', { name: 'Sources' })
    .getByRole('checkbox', { name: 'Engine' })
    .check()
  await expect(panel).toContainText('Engine: pre-started spare used', { timeout: 30_000 })
})
