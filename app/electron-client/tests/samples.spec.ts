/**
 * @file The bundled samples against the real shim: the first start writes the manifest, an edited
 * sample whose bundle changed has the "Update available" badge, and Reset Sample keeps the edited
 * copy beside a fresh one (`project-manager-shim/src/samples`).
 */
import fs from 'node:fs/promises'
import pathModule from 'node:path'
import { expect } from 'playwright/test'
import { test, waitForDashboard } from './electronTest'

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

test('An edited sample whose bundle changed can be reset, keeping the edit', async ({
  page,
  projectsDir,
}) => {
  await waitForDashboard(page)
  const samples = pathModule.join(projectsDir, 'Samples')
  const manifestPath = pathModule.join(samples, '.samples.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  expect(Object.keys(manifest.samples).sort()).toEqual(BUNDLED_SAMPLES)
  expect(Object.keys(manifest.data).length).toBeGreaterThan(0)

  // Edit the sample, and make the manifest say it was installed from an older bundle.
  const main = pathModule.join(samples, 'Sales_Overview', 'src', 'Main.enso')
  const bundled = await fs.readFile(main, 'utf8')
  const edited = `${bundled}\n# An edit.\n`
  await fs.writeFile(main, edited)
  manifest.samples['Sales_Overview'] = 'f'.repeat(64)
  await fs.writeFile(manifestPath, JSON.stringify(manifest))

  const driveView = page.getByTestId('drive-view')
  await driveView.getByTestId('asset-row').filter({ hasText: 'Samples' }).dblclick()
  const row = driveView.getByTestId('asset-row').filter({ hasText: 'Sales_Overview' })
  await expect(row.getByTestId('sample-update-badge')).toBeVisible()
  await expect(
    driveView
      .getByTestId('asset-row')
      .filter({ hasText: 'Text_Cleaning' })
      .getByTestId('sample-update-badge'),
  ).toHaveCount(0)

  await row.click({ button: 'right' })
  await page.getByRole('button', { name: 'Reset Sample' }).click()
  const kept = `Sales_Overview_edited_${dateStamp()}`
  await expect(page.getByText(`Your edited copy is kept as '${kept}'`)).toBeVisible()
  await expect(row.getByTestId('sample-update-badge')).toHaveCount(0)
  await expect(driveView.getByTestId('asset-row').filter({ hasText: kept })).toBeVisible()

  expect(await fs.readFile(main, 'utf8')).toBe(bundled)
  expect(await fs.readFile(pathModule.join(samples, kept, 'src', 'Main.enso'), 'utf8')).toBe(edited)
  expect(await fs.readFile(pathModule.join(samples, kept, 'package.yaml'), 'utf8')).toContain(
    `name: ${kept}`,
  )
})
