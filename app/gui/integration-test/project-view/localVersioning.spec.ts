/**
 * @file Saving versions of a local project: Ctrl/Cmd+S, the save dialog, the changed indicator,
 * the repository prompt and closing. The shim's `versioning/*` routes are mocked
 * (`mock/localVersioning.ts`, `mock/versioning/saveRoutes.ts`); git is absent unless a test says.
 */
import { expect, test } from 'integration-test/base'
import { posix } from 'node:path'
import type { Page } from 'playwright/test'
import { TEXT } from '../actions'
import { expectScreenshot } from '../screenshot'

const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT_PATH = posix.join(ROOT, 'Mock_Project')
const saveButton = 'action:graph.saveVersionWithComment'

/**
 * Records the keys whose `preventDefault` is called from now on (`window.preventedKeys`): the
 * browser's own Ctrl+S ("Save page") is cancelled only if somebody prevents it.
 */
async function spyOnPreventedKeys(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = ((window as any).preventedKeys = [])
    const original = KeyboardEvent.prototype.preventDefault
    KeyboardEvent.prototype.preventDefault = function (this: KeyboardEvent) {
      seen.push(this.key.toLowerCase())
      original.call(this)
    }
  })
}

const preventedKeys = (page: Page) => page.evaluate(() => (window as any).preventedKeys as string[])

/** The dialogs are translucent over a blurred page, which renders slightly differently each time. */
const BLUR_TOLERANT = { threshold: 0.3, maxDiffPixelRatio: 0.02 }

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
    await expectScreenshot(page.getByRole('dialog'), 'save-version-dialog.png', BLUR_TOLERANT)
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

  test('Ctrl+S saves from the code editor too, and the browser’s own save does not fire', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+`')
    const editor = page.locator('.CodeEditor .cm-content')
    await editor.click()
    await expect(editor).toBeFocused()
    // CodeMirror does not prevent Ctrl+S, so the key was taken by the save: the toast and the
    // commit show it ran, and the default (a "Save page" dialog in a browser) was cancelled.
    await spyOnPreventedKeys(page)
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, 'Saved']])
    expect(await preventedKeys(page)).toContain('s')
  })

  test('Ctrl+S in the drive, or on its category buttons, does not save the project', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    const drive = page.getByTestId('drive-view')
    await expect(drive).toBeVisible()
    await spyOnPreventedKeys(page)
    // A data row, not the header; Ctrl+S has no drive action, so nothing else happens.
    await drive.getByRole('row', { name: /Mock Project/ }).click()
    await expect(page.locator('[data-panel-side="left"]').locator(':focus')).toHaveCount(1)
    await page.keyboard.press('ControlOrMeta+S')
    // The left bar's category buttons are outside the drive's panel; Ctrl+Shift+S is the drive's
    // Download, with nothing selected there.
    await page.locator('.LeftPanel .leftBar button').first().focus()
    await page.keyboard.press('ControlOrMeta+S')
    await page.keyboard.press('ControlOrMeta+Shift+S')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('toast-host')).not.toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([])
    // Not the save's, so not prevented either: the browser keeps its own.
    expect(await preventedKeys(page)).not.toContain('s')
  })

  test('Ctrl+S typed in the command palette does not save the project', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+K')
    const input = page.locator('.CommandPalette input')
    await expect(input).toBeFocused()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('toast-host')).not.toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([])
  })

  test('Ctrl+Shift+S works from the code editor and opens the dialog', async ({
    page,
    editorPage,
  }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+`')
    await page.locator('.CodeEditor .cm-content').click()
    await page.keyboard.press('ControlOrMeta+Shift+S')
    await expect(page.getByRole('textbox', { name: 'Comment (optional)' })).toBeFocused()
  })

  test('Ctrl+S saves from the documentation panel', async ({ page, editorPage, localApi }) => {
    await editorPage
    const docs = page.getByTestId('documentation-editor-content')
    if (!(await docs.isVisible())) await editorPage.toggleDocsAssetPanel()
    await expect(docs.locator('.cm-line').first()).toBeVisible()
    await docs.focus()
    await expect(docs).toBeFocused()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('toast-host')).toContainText('Version saved')
    expect(localApi.versioning.commits).toEqual([[MOCK_PROJECT_PATH, 'Saved']])
  })

  test('a loading toast shows while the version is saved', async ({ page, editorPage }) => {
    await editorPage
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('/api/project-service/versioning/commit', async (route) => {
      await gate
      await route.fallback()
    })
    await page.keyboard.press('ControlOrMeta+S')
    const toast = page.getByTestId('toast-host')
    await expect(toast).toContainText('Saving a version…')
    release()
    await expect(toast).toContainText('Version saved')
    await expect(toast).not.toContainText('Saving a version…')
  })

  test('a save asked for once the commit is requested is queued after it, with its comment', async ({
    page,
    editorPage,
  }) => {
    await editorPage
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let reached!: () => void
    const commitRequested = new Promise<void>((resolve) => (reached = resolve))
    const messages: string[] = []
    await page.route('/api/project-service/versioning/commit', async (route, request) => {
      messages.push(String(request.postDataJSON()?.message))
      reached()
      await gate
      await route.fallback()
    })
    await page.keyboard.press('ControlOrMeta+S')
    await commitRequested
    await page.keyboard.press('ControlOrMeta+Shift+S')
    await page.getByRole('textbox', { name: 'Comment (optional)' }).fill('Added a filter')
    await page.getByTestId('save-version-save').click()
    release()
    // The first save commits; the second one is made after it, with the comment.
    await expect.poll(() => messages.length).toBe(2)
    expect(messages[1]).toBe('Added a filter')
    await expect(page.getByTestId('toast-host')).not.toContainText('was not kept')
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

test.describe('with versions kept and nothing changed', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = ROOT
        api.versioning.enabled = true
      },
    },
  })

  test('Ctrl+S and Ctrl+Shift+S say there is nothing to save', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    const toast = page.getByTestId('toast-host')
    await expect(page.getByTestId(saveButton)).toBeDisabled()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(toast).toContainText('Nothing has changed since the last version')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Shift+S')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(localApi.versioning.commits).toEqual([])
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
    await expectScreenshot(prompt, 'create-repository-prompt.png', BLUR_TOLERANT)
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
    await expectScreenshot(prompt, 'use-repository-prompt.png', BLUR_TOLERANT)
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
