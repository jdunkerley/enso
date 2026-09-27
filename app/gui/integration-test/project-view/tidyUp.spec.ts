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

/**
 * Assert that `child` continues `parent`'s column: same left x, top strictly below the parent's
 * bottom.
 *
 * `toBeCloseTo(x, 0)` (tolerance 0.5px) is the suite's usual precision for a screen-space match
 * (see `aligningNodes.spec.ts`); it's enough here too, because the layout places these two left
 * edges at the exact same *scene* x, so any screen-space gap is only floating-point/zoom-transform
 * rounding, not a real layout discrepancy.
 */
function expectContinuesColumn(child: Box, parent: Box) {
  expect(child.x).toBeCloseTo(parent.x, 0)
  expect(child.y).toBeGreaterThan(parent.y + parent.height)
}

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
  // tied at the same pre-tidy left x -- an exact tie, so the one continuing `data`'s column is
  // decided by code order ("ties go to code order"). `filtered` is the first of them -- verified
  // against the actual layout output rather than assumed.
  const data = after.get('data')!
  const filtered = after.get('filtered')!
  expectContinuesColumn(filtered, data)

  // No two components overlap.
  const list = [...after.values()]
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i]!, list[j]!)).toBe(false)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(async () => serializeBoxes(await boxes(page))).toBe(serializeBoxes(before))
})

test('with a selection only the selected components move; the button sits next to the Align dropdown, not inside it', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await boxes(page)

  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'five')).click()
  await page.waitForTimeout(300)
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'sum')).click({ modifiers: ['Shift'] })

  // Use the OS-independent `data-testid` hook rather than an exact accessible-name match: the
  // button's accessible name includes the shortcut suffix (e.g. "Tidy Up (Ctrl + Shift + L)"),
  // whose wording differs between OSes. It sits directly in the selection menu now, so it's found
  // -- and clickable -- without opening the Align dropdown at all.
  const tidyButton = page.getByTestId('action:components.tidyUp')
  await expect(tidyButton).toBeVisible()
  const iconHref = await tidyButton.locator('svg use').getAttribute('href')

  // The Align dropdown trigger has no native `title` attribute; `MenuButton` renders the
  // `DropdownMenu`'s `title` prop as `aria-label` instead, so it is exposed as an accessible
  // label rather than a browser tooltip.
  await page.getByLabel('Align', { exact: true }).click()
  // The dropdown's panel is teleported out of the DOM subtree of its trigger, so it's identified
  // by its own class (`alignmentMenu`, set in `SelectionMenu.vue`) rather than by nesting under
  // the trigger. Confirm the button isn't inside it.
  const alignPanel = page.locator('.alignmentMenu')
  await expect(alignPanel).toBeVisible()
  await expect(alignPanel.getByTestId('action:components.tidyUp')).toHaveCount(0)
  // Close the dropdown again (clicking its trigger toggles it) before clicking the button below.
  await page.getByLabel('Align', { exact: true }).click()
  await expect(alignPanel).toBeHidden()

  await tidyButton.click()
  await expect.poll(async () => serializeBoxes(await boxes(page))).not.toBe(serializeBoxes(before))
  const after = await boxes(page)

  // `sum = five + ten + twenty`, so `five` is `sum`'s first (self) input -- and, with only
  // `{five, sum}` selected, its only *in-scope* input, since `ten` and `twenty` are excluded from
  // the selection. Checking just "`sum` moved" wouldn't catch a scoped tidy that silently dropped
  // `five` from the scope (it could still reposition `sum` alone against no inputs), and checking
  // just "`five` moved" could fail legitimately, since `five` may already sit at the in-scope
  // anchor's top-left corner and have nowhere to move. Asserting the layout rule itself -- `sum`
  // continues `five`'s column -- proves both components were actually laid out together.
  const five = after.get('five')!
  const sum = after.get('sum')!
  expectContinuesColumn(sum, five)

  for (const [name, box] of before) {
    if (name === 'five' || name === 'sum') continue
    expect(after.get(name)).toEqual(box)
  }

  // The button uses the `tidy_up` icon (confirmed above to not be inside the Align dropdown).
  expect(iconHref).toMatch(/#tidy_up$/)
})
