/**
 * @file Rebinding a graph editor shortcut in Settings → Keyboard shortcuts (#170): the open graph
 * editor takes the new key at once and ignores the old one, the command palette shows the new key,
 * the change survives a reload, and Reset brings the default back. A dashboard shortcut rebound
 * there works too.
 */
import type { Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import { TEXT } from '../actions'
import * as locate from './locate'

/** The new key for "Show/Hide Code Editor" (default `Mod+\``), which nothing else has. */
const NEW_KEY = 'ControlOrMeta+Shift+U'
const OLD_KEY = 'ControlOrMeta+`'

/** Open Settings → Keyboard shortcuts from the user menu, over the graph. */
async function openKeyboardShortcuts(page: Page) {
  await page.getByLabel(TEXT.userMenuLabel).locator('visible=true').click()
  await page.getByTestId('user-menu').getByRole('button', { name: TEXT.settingsShortcut }).click()
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await page
    .getByRole('button', { name: TEXT.keyboardShortcutsSettingsTab })
    .getByText(TEXT.keyboardShortcutsSettingsTab)
    .click()
  await expect(
    page.getByRole('columnheader', { name: TEXT.graphEditorBindingCategory }),
  ).toBeVisible()
}

/** The settings row of an action, by its name. */
function shortcutRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) })
}

/** Add a shortcut to the row's action through the capture dialog. */
async function addShortcut(page: Page, name: string, key: string) {
  await shortcutRow(page, name).getByRole('button', { name: TEXT.addShortcut }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(TEXT.noShortcutEntered)).toBeVisible()
  await expect(dialog.locator('form')).toBeFocused()
  await page.keyboard.press(key)
  await expect(dialog.getByText(TEXT.noShortcutEntered)).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: TEXT.confirm })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
}

async function backToProject(page: Page) {
  await page.getByRole('tab', { name: 'Mock Project' }).click()
  await expect(locate.graphEditor(page)).toBeVisible()
}

test('A rebound graph shortcut works at once, shows in the palette, persists and resets', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const codeEditor = page.locator('.CodeEditor')
  const name = TEXT.graphToggleCodeEditorShortcut

  await openKeyboardShortcuts(page)
  const row = shortcutRow(page, name)
  await expect(row).toContainText('`')
  await row.getByRole('button', { name: TEXT.removeShortcut }).click()
  await expect(row).not.toContainText('`')
  await addShortcut(page, name, NEW_KEY)
  await expect(row).toContainText('U')

  // The open graph editor takes the new key, and ignores the old one.
  await backToProject(page)
  await expect(codeEditor).toHaveCount(0)
  await page.keyboard.press(NEW_KEY)
  await expect(codeEditor).toBeVisible()
  // Had the old key still toggled the editor, the new key would show it again.
  await page.keyboard.press(OLD_KEY)
  await page.keyboard.press(NEW_KEY)
  await expect(codeEditor).toHaveCount(0)

  // The palette lists the action with its new key.
  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.locator('.CommandPalette')
  await palette.getByPlaceholder('Search actions...').fill(name)
  const entry = palette.getByRole('button', { name })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('U')
  await expect(entry).not.toContainText('`')
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)

  // The change survives a reload (the project is reopened with it).
  await page.reload()
  await expect(locate.graphEditor(page)).toBeVisible()
  await expect(page.locator('.ProjectView').getByTestId('spinner')).toHaveCount(0)
  await page.keyboard.press(NEW_KEY)
  await expect(codeEditor).toBeVisible()
  await page.keyboard.press(NEW_KEY)
  await expect(codeEditor).toHaveCount(0)

  // Reset brings the default back.
  await openKeyboardShortcuts(page)
  await expect(row).toContainText('U')
  await row.getByRole('button', { name: TEXT.resetShortcut }).click()
  await expect(row).toContainText('`')
  await expect(row).not.toContainText('U')
  await backToProject(page)
  await page.keyboard.press(OLD_KEY)
  await expect(codeEditor).toBeVisible()
  await page.keyboard.press(NEW_KEY)
  await page.keyboard.press(OLD_KEY)
  await expect(codeEditor).toHaveCount(0)
})

test('A rebound dashboard shortcut still works, over the graph too', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await openKeyboardShortcuts(page)
  await addShortcut(page, TEXT.aboutThisAppShortcut, 'ControlOrMeta+Shift+F')
  const about = page.getByRole('dialog', { name: TEXT.aboutThisAppShortcut })
  await page.keyboard.press('ControlOrMeta+Shift+F')
  await expect(about).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
  await backToProject(page)
  await page.keyboard.press('ControlOrMeta+Shift+F')
  await expect(about).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
})

test('A key another shortcut has where both are active is refused, and named', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await openKeyboardShortcuts(page)
  await shortcutRow(page, TEXT.graphFitAllShortcut)
    .getByRole('button', { name: TEXT.addShortcut })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('form')).toBeFocused()
  // Undo is the graph editor's too.
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(dialog).toContainText(`'${TEXT.graphUndoShortcut}'`)
  await expect(dialog.getByRole('button', { name: TEXT.confirm })).toBeDisabled()
  // Rename is the drive's, never active with the graph's.
  await page.keyboard.press('ControlOrMeta+R')
  await expect(dialog.getByRole('button', { name: TEXT.confirm })).toBeEnabled()
  await dialog.getByRole('button', { name: TEXT.cancel }).click()
  await expect(dialog).toHaveCount(0)
})
