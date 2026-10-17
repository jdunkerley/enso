/** @file Settings → Local → Versions, against the mocked versioning routes. */
import { expect, test } from 'integration-test/base'
import { expectScreenshot } from '../screenshot'

test.use({ setupApi: { local: (api) => void (api.versioning.git = true) } })

test('Create repository creates one at the root; Stop turns versions off', async ({
  page,
  drivePage,
  localApi,
}) => {
  await drivePage.goToPage.settings().goToSettingsTab.local()
  const section = page.getByTestId('local-versions-section')
  await expect(section).toContainText('Your projects are not in a git repository.')
  await section.getByRole('button', { name: 'Create repository' }).click()
  await expect(section).toContainText(
    'Versions are kept in the git repository at /home/user/enso/enso-projects.',
  )
  await expectScreenshot(section, 'local-versions-settings.png')
  await section.getByRole('button', { name: 'Stop keeping versions' }).click()
  await expect(section).toContainText('Versions are turned off for the git repository at')
  expect(localApi.versioning.optedOut).toBe(true)
})

test('Use this repository turns versions back on after Stop', async ({
  page,
  drivePage,
  localApi,
}) => {
  await drivePage.goToPage.settings().goToSettingsTab.local()
  const section = page.getByTestId('local-versions-section')
  await section.getByRole('button', { name: 'Create repository' }).click()
  await section.getByRole('button', { name: 'Stop keeping versions' }).click()
  await expectScreenshot(section, 'local-versions-settings-off.png')
  await section.getByRole('button', { name: 'Use this repository' }).click()
  await expect(section).toContainText('Versions are kept in the git repository at')
  expect(localApi.versioning.optedOut).toBe(false)
  expect(localApi.versioning.enabled).toBe(true)
})

test.describe('with a repository above the projects folder, not used yet', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = '/home/user'
      },
    },
  })

  test('the section offers to use it', async ({ page, drivePage, localApi }) => {
    await drivePage.goToPage.settings().goToSettingsTab.local()
    const section = page.getByTestId('local-versions-section')
    await expect(section).toContainText(
      'Your projects are in the git repository at /home/user, but versions are not kept there.',
    )
    await expectScreenshot(section, 'local-versions-settings-not-enabled.png')
    await section.getByRole('button', { name: 'Use this repository' }).click()
    await expect(section).toContainText('Versions are kept in the git repository at /home/user.')
    expect(localApi.versioning.enabled).toBe(true)
  })
})

test.describe('without git', () => {
  test.use({ setupApi: { local: () => {} } })

  test('the section says git was not found and offers nothing', async ({ page, drivePage }) => {
    await drivePage.goToPage.settings().goToSettingsTab.local()
    const section = page.getByTestId('local-versions-section')
    await expect(section).toContainText('Git was not found.')
    await expectScreenshot(section, 'local-versions-settings-no-git.png')
    await expect(section.getByRole('button')).toHaveCount(0)
  })
})
