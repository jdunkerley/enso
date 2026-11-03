/**
 * @file Accessibility of the project view's save controls (#237): the top-bar dot and save icon,
 * the tab's ●, the save dialog and the repository prompt. axe runs on them only, against the
 * baseline in `accessibility-baseline/project-save.json`
 * (see `integration-test/accessibility.ts`).
 */
import { expect, test } from 'integration-test/base'
import { expectNoNewAxeViolations } from '../accessibility'

const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT_PATH = `${ROOT}/Mock_Project`
const SAVE_BUTTON = '[data-testid="action:graph.saveVersionWithComment"]'

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

  test('the dot, the tab’s ● and the save icon: no new axe violations', async ({
    page,
    editorPage,
  }) => {
    await editorPage
    await expect(page.getByTestId('project-changed-indicator')).toBeVisible()
    await expect(page.getByTestId('tab-changed-indicator')).toBeVisible()
    await expectNoNewAxeViolations(page, 'project-save-bar', {
      include: [
        SAVE_BUTTON,
        '[data-testid="project-changed-indicator"]',
        '[role="tab"]:has([data-testid="tab-changed-indicator"])',
      ],
    })
  })

  test('the save dialog: no new axe violations', async ({ page, editorPage }) => {
    await editorPage
    await page.getByTestId('action:graph.saveVersionWithComment').click()
    await expect(page.getByRole('textbox', { name: 'Comment (optional)' })).toBeFocused()
    await expectNoNewAxeViolations(page, 'project-save-dialog', { include: ['[role="dialog"]'] })
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

  test('the greyed save icon: no new axe violations', async ({ page, editorPage }) => {
    await editorPage
    await expect(page.getByTestId('action:graph.saveVersionWithComment')).toBeDisabled()
    await expectNoNewAxeViolations(page, 'project-save-blocked', { include: [SAVE_BUTTON] })
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

  test('the repository prompt: no new axe violations', async ({ page, editorPage }) => {
    await editorPage
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByTestId('repository-prompt')).toBeVisible()
    await expectNoNewAxeViolations(page, 'project-save-prompt', {
      include: ['[data-testid="repository-prompt"]'],
    })
  })
})
