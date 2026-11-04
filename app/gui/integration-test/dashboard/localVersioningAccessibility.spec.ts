/**
 * @file Accessibility of Settings → Local → Versions (#237): axe, against the baseline in
 * `accessibility-baseline/settings-versions.json` (see `integration-test/accessibility.ts`).
 */
import { expect, test } from 'integration-test/base'
import { expectNoNewAxeViolations } from '../accessibility'

const SECTION = '[data-testid="local-versions-section"]'

test.describe('with a repository above the projects folder, not used yet', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = '/home/user'
      },
    },
  })

  test('the offer to use it: no new axe violations', async ({ page, drivePage }) => {
    await drivePage.goToPage.settings().goToSettingsTab.local()
    await expect(page.getByTestId('local-versions-section')).toContainText('versions are not kept')
    await expectNoNewAxeViolations(page, 'settings-versions-offer', { include: [SECTION] })
  })
})

test.describe('with git and versions kept', () => {
  test.use({ setupApi: { local: (api) => void (api.versioning.git = true) } })

  test('no repository, then kept, then off: no new axe violations', async ({ page, drivePage }) => {
    await drivePage.goToPage.settings().goToSettingsTab.local()
    const section = page.getByTestId('local-versions-section')
    await expect(section).toContainText('Your projects are not in a git repository.')
    await expectNoNewAxeViolations(page, 'settings-versions-none', { include: [SECTION] })
    await section.getByRole('button', { name: 'Create repository' }).click()
    await expect(section).toContainText('Versions are kept in the git repository at')
    await expectNoNewAxeViolations(page, 'settings-versions-kept', { include: [SECTION] })
    await section.getByRole('button', { name: 'Stop keeping versions' }).click()
    await expect(section).toContainText('Versions are turned off for the git repository at')
    await expectNoNewAxeViolations(page, 'settings-versions-off', { include: [SECTION] })
  })
})

test.describe('without git', () => {
  test.use({ setupApi: { local: () => {} } })

  test('git was not found: no new axe violations', async ({ page, drivePage }) => {
    await drivePage.goToPage.settings().goToSettingsTab.local()
    await expect(page.getByTestId('local-versions-section')).toContainText('Git was not found.')
    await expectNoNewAxeViolations(page, 'settings-versions-nogit', { include: [SECTION] })
  })
})
