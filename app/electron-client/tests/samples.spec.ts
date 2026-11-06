/**
 * @file The bundled samples against the real shim: the first start writes the manifest, opening a
 * sample is not an edit, an edited sample whose bundle changed has the "Update available" pill,
 * and updating it from the pill (outside version control) keeps the edited copy beside a fresh
 * one (`project-manager-shim/src/samples`).
 */
import fs from 'node:fs/promises'
import pathModule from 'node:path'
import { expect, type Page } from 'playwright/test'
import {
  closeWelcome,
  COLD_PROJECT_TIMEOUT,
  SKIP_ON_WINDOWS_CI,
  SKIP_ON_WINDOWS_CI_REASON,
  test,
  waitForDashboard,
  WELCOME_PROJECT_TAB,
} from './electronTest'

/** The samples the IDE bundles (`app/electron-client/samples`). */
const BUNDLED_SAMPLES = [
  'Getting_Started',
  'Local_Database',
  'Orders_And_Customers',
  'Sales_Overview',
  'Text_Cleaning',
]

/** Today as an edited copy's suffix: `yyyy_mm_dd`, local time. */
function dateStamp(now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}_${pad(now.getMonth() + 1)}_${pad(now.getDate())}`
}

/** The Drive row of the asset named exactly `name` (not, say, its `_edited_` copy). */
function assetRow(page: Page, name: string) {
  return page
    .getByTestId('drive-view')
    .getByTestId('asset-row')
    .filter({ has: page.getByTestId('asset-row-name').getByText(name, { exact: true }) })
}

/** The shim's samples status, as the Drive gets it. */
async function samplesStatus(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/project-service/samples/status', {
      method: 'POST',
      body: '{}',
    })
    return (await response.json()) as {
      result?: { samples: { name: string; state: string }[] }
    }
  })
}

test.describe('opening a sample', () => {
  // A fresh install opens Getting_Started. A cold project open is slow on the Windows runner.
  test.use({ welcomeProject: true })
  test.skip(SKIP_ON_WINDOWS_CI, SKIP_ON_WINDOWS_CI_REASON)

  test('Opening and closing a sample leaves it unedited', async ({ page, projectsDir }, info) => {
    test.setTimeout(COLD_PROJECT_TIMEOUT + 120_000)
    const main = pathModule.join(projectsDir, 'Samples', 'Getting_Started', 'src', 'Main.enso')
    const bundled = await fs.readFile(
      pathModule.join(import.meta.dirname, '..', 'samples', 'Getting_Started', 'src', 'Main.enso'),
      'utf8',
    )
    const tab = page.getByRole('tab', { name: WELCOME_PROJECT_TAB, exact: true })
    await expect(tab).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('.ScatterplotVisualization .scatterPoint')).toHaveCount(12, {
      timeout: COLD_PROJECT_TIMEOUT,
    })
    await closeWelcome(page)
    // What the IDE did to the file, for the record.
    const after = await fs.readFile(main, 'utf8')
    await fs.writeFile(info.outputPath('Main.enso.bundled'), bundled)
    await fs.writeFile(info.outputPath('Main.enso.after-open'), after)
    const status = await samplesStatus(page)
    expect(status.result?.samples.find((sample) => sample.name === 'Getting_Started')?.state).toBe(
      'current',
    )
  })
})

test('An edited sample whose bundle changed is updated from its pill, keeping the edit', async ({
  page,
  projectsDir,
}) => {
  await waitForDashboard(page)
  const samples = pathModule.join(projectsDir, 'Samples')
  const manifestPath = pathModule.join(samples, '.samples.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  expect(Object.keys(manifest.samples).sort()).toEqual(BUNDLED_SAMPLES)
  expect(Object.keys(manifest.data).length).toBeGreaterThan(0)

  // Edit the sample's code, and make the manifest say it was installed from an older bundle.
  const main = pathModule.join(samples, 'Sales_Overview', 'src', 'Main.enso')
  const bundled = await fs.readFile(main, 'utf8')
  const edited = `## An edit.\n${bundled}`
  await fs.writeFile(main, edited)
  manifest.samples['Sales_Overview'] = 'f'.repeat(64)
  await fs.writeFile(manifestPath, JSON.stringify(manifest))

  await assetRow(page, 'Samples').dblclick()
  const row = assetRow(page, 'Sales_Overview')
  await expect(row.getByTestId('sample-update-badge')).toBeVisible()
  await expect(assetRow(page, 'Text_Cleaning').getByTestId('sample-update-badge')).toHaveCount(0)

  const kept = `Sales_Overview_edited_${dateStamp()}`
  await row.getByTestId('sample-update-badge').click()
  await expect(page.getByRole('alertdialog')).toContainText(`kept as '${kept}'`)
  await page.getByRole('alertdialog').getByRole('button', { name: 'Update' }).click()
  await expect(page.getByText(`Your edited copy is kept as '${kept}'`)).toBeVisible()
  await expect(row.getByTestId('sample-update-badge')).toHaveCount(0)
  await expect(assetRow(page, kept)).toBeVisible()

  expect(await fs.readFile(main, 'utf8')).toBe(bundled)
  expect(await fs.readFile(pathModule.join(samples, kept, 'src', 'Main.enso'), 'utf8')).toBe(edited)
  expect(await fs.readFile(pathModule.join(samples, kept, 'package.yaml'), 'utf8')).toContain(
    `name: ${kept}`,
  )
})
