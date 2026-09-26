import { expect, test, type Page } from 'integration-test/base'
import * as locate from './locate'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Bounding boxes of all graph nodes, keyed by their binding name.
 *
 * These are screen-space (CSS pixel) boxes from Playwright's `boundingBox()`, which depend on the
 * current zoom/pan. That is fine for the checks used here (column alignment, overlap, and
 * before/after equality), since they only compare boxes captured at the same zoom level; no
 * absolute distance (such as the 40px theme gap) is asserted in screen pixels.
 */
async function boxes(page: Page) {
  const nodes = locate.graphNode(page)
  const count = await nodes.count()
  const result = new Map<string, Box>()
  for (let i = 0; i < count; i++) {
    const node = nodes.nth(i)
    const name = (await node.locator('.binding').first().textContent())?.trim() ?? `#${i}`
    const box = await node.boundingBox()
    if (box) result.set(name, box)
  }
  return result
}

// `Map` has no enumerable own properties, so `JSON.stringify` on a `Map` always yields `'{}'`.
// Compare its entries instead.
const serializeBoxes = (map: Map<string, Box>) => JSON.stringify([...map])

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('Tidy up lays out the graph in columns without overlaps, and undo restores it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await boxes(page)
  await page.keyboard.press('ControlOrMeta+Shift+L')
  await expect.poll(async () => serializeBoxes(await boxes(page))).not.toBe(serializeBoxes(before))
  const after = await boxes(page)

  // `data` has five children (`filtered`, `aggregated`, `autoscoped`, `selected`, `table`), all
  // tied at the same pre-tidy x; the one whose *centre* x ends up closest to `data`'s continues
  // its column ("the child whose centre x is closest to its parent's continues the parent's
  // column"). With the mock's collapsed/default node widths that is `aggregated`, not `filtered`
  // (their differing widths break the tie, despite the shared left edge) -- verified against the
  // actual layout output rather than assumed.
  const data = after.get('data')!
  const aggregated = after.get('aggregated')!
  expect(Math.abs(aggregated.x + aggregated.width / 2 - (data.x + data.width / 2))).toBeLessThan(2)
  expect(aggregated.y).toBeGreaterThan(data.y + data.height)

  // No two components overlap.
  const list = [...after.values()]
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i]!, list[j]!)).toBe(false)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(async () => serializeBoxes(await boxes(page))).toBe(serializeBoxes(before))
})

test('with a selection only the selected components move; the button sits in the Align menu', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await boxes(page)

  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'five')).click()
  await page.waitForTimeout(300)
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'sum')).click({ modifiers: ['Shift'] })

  // The Align dropdown trigger has no native `title` attribute; `MenuButton` renders the
  // `DropdownMenu`'s `title` prop as `aria-label` instead, so it is exposed as an accessible
  // label rather than a browser tooltip.
  await page.getByLabel('Align', { exact: true }).click()

  // Use the OS-independent `data-testid` hook rather than an exact accessible-name match: the
  // button's accessible name includes the shortcut suffix (e.g. "Tidy Up (Ctrl + Shift + L)"),
  // whose wording differs between OSes.
  const tidyButton = page.getByTestId('action:components.tidyUp')
  await expect(tidyButton).toBeVisible()
  // Read the icon now, but assert on it only after the functional checks below: the dropdown
  // panel (and this locator's target) unmounts once the button is clicked and closes the menu, so
  // the href has to be captured while the panel is still open.
  const iconHref = await tidyButton.locator('svg use').getAttribute('href')

  await tidyButton.click()
  await expect
    .poll(async () => JSON.stringify((await boxes(page)).get('sum')))
    .not.toBe(JSON.stringify(before.get('sum')))

  const after = await boxes(page)
  for (const [name, box] of before) {
    if (name === 'five' || name === 'sum') continue
    expect(after.get(name)).toEqual(box)
  }

  // The button is in the Align dropdown and uses the `tidy_up` icon.
  expect(iconHref).toMatch(/#tidy_up$/)
})
