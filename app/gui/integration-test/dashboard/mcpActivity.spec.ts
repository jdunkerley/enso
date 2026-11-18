/**
 * @file The MCP activity icon at the right end of the top bar, against the mocked
 * `window.api.mcp`: it is there on the Drive with no tab open and with a project open, Enable turns
 * MCP on, a seeded activity record renders its client and calls, and its link opens Settings → AI.
 */
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'

/** What main would send: one client and one call of each outcome. */
const ACTIVITY = (now: number) => ({
  clients: [{ name: 'Claude Code', version: '2.0.14', lastSeenAt: now - 2000 }],
  calls: [
    {
      id: 5,
      client: 'Claude Code',
      tool: 'add_nodes',
      startedAt: now - 500,
      endedAt: null,
      outcome: 'running',
    },
    {
      id: 4,
      client: 'Claude Code',
      tool: 'get_graph',
      startedAt: now - 13_200,
      endedAt: now - 12_000,
      outcome: 'ok',
    },
    {
      id: 3,
      client: 'Claude Code',
      tool: 'evaluate_expression',
      startedAt: now - 41_000,
      endedAt: now - 40_000,
      outcome: 'refused',
    },
    {
      id: 2,
      client: 'Claude Code',
      tool: 'search_components',
      startedAt: now - 60_300,
      endedAt: now - 60_000,
      outcome: 'ok',
    },
    {
      id: 1,
      client: 'Claude Code',
      tool: 'get_visualization',
      startedAt: now - 181_000,
      endedAt: now - 180_000,
      outcome: 'error',
    },
  ],
})

async function emitActivity(page: Page) {
  // The page's clock is not the test's: the mock may run its own.
  const now = await page.evaluate(() => Date.now())
  await page.evaluate((activity) => {
    ;(window as unknown as { __mcpEmitActivity: (a: unknown) => void }).__mcpEmitActivity(activity)
  }, ACTIVITY(now))
}

const icon = (page: Page) => page.getByTestId('mcp-activity-button')

test('the icon is on the Drive with no tab open, off, and Enable turns MCP on', async ({
  page,
  drivePage,
}) => {
  void drivePage
  await expect(icon(page)).toBeVisible()
  await expect(icon(page)).toHaveAttribute('aria-label', TEXT.mcpActivityNameOff)

  await icon(page).click()
  const popover = page.getByTestId('mcp-activity-content')
  await expect(popover).toContainText(TEXT.mcpActivityOffText)
  await expect(popover).toContainText(TEXT.mcpWarning)
  await popover.getByRole('button', { name: TEXT.mcpActivityEnable }).click()

  await expect(icon(page)).toHaveAttribute('aria-label', TEXT.mcpActivityNameIdle)
  await expect(popover).toContainText('http://127.0.0.1:39417/mcp')
  await expect(popover).toContainText(TEXT.mcpActivityNoClient)
  await expect(popover.getByRole('button', { name: TEXT.mcpActivityEnable })).toHaveCount(0)

  // Escape closes it, and the focus returns to the icon.
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(icon(page)).toBeFocused()
})

test('a seeded record shows the client and one call of each outcome', async ({
  page,
  drivePage,
}) => {
  void drivePage
  await icon(page).click()
  await page
    .getByTestId('mcp-activity-content')
    .getByRole('button', { name: TEXT.mcpActivityEnable })
    .click()
  await emitActivity(page)

  await expect(icon(page)).toHaveAttribute(
    'aria-label',
    TEXT.mcpActivityNameActive.replace('$0', 'Claude Code'),
  )
  const clients = page.getByTestId('mcp-activity-clients')
  await expect(clients).toContainText('Claude Code 2.0.14')
  const calls = page.getByTestId('mcp-activity-calls').getByRole('listitem')
  await expect(calls).toHaveCount(5)
  await expect(calls.nth(0)).toContainText('add_nodes')
  await expect(calls.nth(0)).toContainText(TEXT.mcpActivityRunning)
  await expect(calls.nth(1)).toHaveAttribute('aria-label', /^get_graph, OK, /)
  await expect(calls.nth(2)).toContainText(TEXT.mcpActivityRefused)
  await expect(calls.nth(4)).toContainText(TEXT.mcpActivityError)
})

test('Settings → AI opens the AI tab and closes the popover', async ({ page, drivePage }) => {
  void drivePage
  await icon(page).click()
  await page.getByTestId('mcp-activity-settings').click()
  await expect(page.getByTestId('mcp-activity-content')).toBeHidden()
  await expect(page.getByTestId('mcp-settings-section')).toBeVisible()
  expect(decodeURIComponent(page.url())).toContain('SettingsTab="ai"')
})

test('the icon is on screen with a project open too', async ({ page, editorPage }) => {
  void editorPage
  await expect(icon(page)).toBeVisible()
  await expect(icon(page)).toHaveAttribute('aria-label', TEXT.mcpActivityNameOff)
})
