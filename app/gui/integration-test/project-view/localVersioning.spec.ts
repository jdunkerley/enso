/**
 * @file Saving versions of a local project: Ctrl/Cmd+S, the save dialog, the changed indicator,
 * the repository prompt and closing. The shim's `versioning/*` routes are mocked
 * (`mock/localVersioning.ts`, `mock/versioning/saveRoutes.ts`); git is absent unless a test says.
 */
import { expect, test } from 'integration-test/base'
import { posix } from 'node:path'
import { TEXT } from '../actions'
import { expectScreenshot } from '../screenshot'

const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT_PATH = posix.join(ROOT, 'Mock_Project')
const saveButton = 'action:graph.saveVersionWithComment'

test.describe('with versions kept at the root, and changes', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = ROOT
        api.versioning.enabled = true
        api.versioning.changed.add(MOCK_PROJECT_PATH)
      },
    },
  })

  test('the dot and the tab’s ● show changes; Ctrl+S saves "Saved" and clears them', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    const dot = page.getByTestId('project-changed-indicator')
    await expect(dot).toBeVisible()
    await expect(page.getByTestId('tab-changed-indicator')).toBeVisible()
    await expectScreenshot(
      page.getByTestId(saveButton).locator('xpath=../..'),
      'changed-top-bar.png',
    )
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, 'Saved']])
    await expect(dot).toBeHidden()
    await expect(page.getByTestId('tab-changed-indicator')).toBeHidden()
    await expect(page.getByTestId(saveButton)).toBeDisabled()
  })

  test('the save icon asks for a comment; Enter saves with it', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.getByTestId(saveButton).click()
    const comment = page.getByRole('textbox', { name: 'Comment (optional)' })
    await expect(comment).toBeFocused()
    await expectScreenshot(page.getByRole('dialog'), 'save-version-dialog.png')
    await comment.fill('Joined the sales table')
    await comment.press('Enter')
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, 'Joined the sales table']])
  })

  test('Ctrl+Shift+S opens the dialog; an empty comment saves "Saved"', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+Shift+S')
    await page.getByTestId('save-version-save').click()
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, 'Saved']])
  })

  test('a close whose version could not be saved shows a warning toast', async ({
    page,
    editorPage,
  }) => {
    // Registered after the mock's own close route, so it takes precedence.
    await page.route('/api/project-service/project/close', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: { versioningWarning: 'the repository is locked' },
        }),
      }),
    )
    await editorPage.goToPage.drive().driveTable.rightClickRow('Mock Project')
    await page.getByTestId('context-menu').getByRole('button', { name: TEXT.closeShortcut }).click()
    await expect(page.getByTestId('toast-host')).toContainText(
      'its version could not be saved: the repository is locked',
    )
  })
})

test.describe('with a blocked repository', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = ROOT
        api.versioning.enabled = true
        api.versioning.blocked = 'The repository is in the middle of a merge.'
        api.versioning.changed.add(MOCK_PROJECT_PATH)
      },
    },
  })

  test('the icon is greyed, with git’s message as its label', async ({ page, editorPage }) => {
    await editorPage
    const save = page.getByTestId(saveButton)
    await expect(save).toBeDisabled()
    await expect(save).toHaveAttribute('aria-label', /in the middle of a merge/)
    await expectScreenshot(save, 'save-blocked.png')
  })
})

test.describe('with git and no repository', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.changed.add(MOCK_PROJECT_PATH)
      },
    },
  })

  test('Ctrl+S offers to create one; Create creates it and saves', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+S')
    const prompt = page.getByTestId('repository-prompt')
    await expect(prompt).toContainText(
      `Keep versions of your projects with git? This creates a repository in ${ROOT}.`,
    )
    await expectScreenshot(prompt, 'create-repository-prompt.png')
    await prompt.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.repoRoot).toBe(ROOT)
  })

  test('"Don\'t ask again for this folder" stops asking', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+S')
    await page.getByTestId('repository-prompt-dont-ask-again').click()
    await expect(page.getByTestId('repository-prompt')).toBeHidden()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('toast-host')).toContainText('Versions are off for this folder')
    await expect(page.getByTestId('repository-prompt')).toBeHidden()
    expect(localApi.versioning.repoRoot).toBeNull()
  })

  test('closing a project with no repository offers Create; Not now still closes it', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage.goToPage.drive().driveTable.rightClickRow('Mock Project')
    await page.getByTestId('context-menu').getByRole('button', { name: TEXT.closeShortcut }).click()
    const prompt = page.getByTestId('repository-prompt')
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('tab', { name: 'Mock Project' })).toHaveCount(0)
    expect(localApi.versioning.repoRoot).toBeNull()
  })
})

test.describe('with an existing repository outside the root', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = '/home/user'
        api.versioning.changed.add(MOCK_PROJECT_PATH)
      },
    },
  })

  test('Ctrl+S asks to use it; Use enables it and saves', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+S')
    const prompt = page.getByTestId('repository-prompt')
    await expect(prompt).toContainText(
      'Keep versions of your projects in the existing repository at /home/user?',
    )
    await expectScreenshot(prompt, 'use-repository-prompt.png')
    await prompt.getByRole('button', { name: 'Use' }).click()
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.enabled).toBe(true)
  })
})

test('without git there is no save icon, no dot, and Ctrl+S asks nothing', async ({
  page,
  editorPage,
}) => {
  await editorPage
  await expect(page.getByTestId(saveButton)).toHaveCount(0)
  await expect(page.getByTestId('project-changed-indicator')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+S')
  await expect(page.getByTestId('repository-prompt')).toHaveCount(0)
})
