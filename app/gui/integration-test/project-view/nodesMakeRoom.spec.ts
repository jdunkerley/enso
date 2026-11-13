import { expect, test, type Page } from 'integration-test/base'
import * as locate from './locate'

const BINDINGS = ['five', 'ten', 'twenty', 'sum', 'prod', 'final', 'list', 'text']
const OPENED = 'sum'

type Positions = Record<string, { x: number; y: number }>

async function positions(page: Page): Promise<Positions> {
  const result: Positions = {}
  for (const binding of BINDINGS) {
    const box = await locate.graphNodeByBinding(page, binding).boundingBox()
    if (box) result[binding] = { x: Math.round(box.x), y: Math.round(box.y) }
  }
  return result
}

async function toggleVisualization(page: Page, binding: string) {
  await locate.graphNodeByBinding(page, binding).click({ position: { x: 8, y: 8 } })
  await expect(locate.componentMenu(page)).toExist()
  await locate.toggleVisualizationButton(page).click()
}

function moved(before: Positions, after: Positions): string[] {
  return BINDINGS.filter(
    (b) => before[b] && after[b] && (before[b].x !== after[b].x || before[b].y !== after[b].y),
  )
}

/** The positions once they have stopped changing: two reads in a row agree. */
async function settledPositions(page: Page): Promise<Positions> {
  let last = await positions(page)
  await expect
    .poll(async () => {
      const next = await positions(page)
      const same = JSON.stringify(next) === JSON.stringify(last)
      last = next
      return same
    })
    .toBe(true)
  return last
}

/** Show the visualization of {@link OPENED} and wait for its neighbours to settle where pushed. */
async function showAndSettle(page: Page, before: Positions): Promise<Positions> {
  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toExist()
  await expect.poll(async () => moved(before, await positions(page)).length).toBeGreaterThan(0)
  return settledPositions(page)
}

test('Showing a visualization makes room, and hiding it restores the layout', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await positions(page)
  const pushed = await showAndSettle(page, before)
  const vis = locate.anyVisualization(page)
  // The nodes moved, not the camera: the node showing the visualization stays put.
  expect(moved(before, pushed)).not.toContain(OPENED)

  // Nothing is pushed up: a node that started above the visualization's top is where it was.
  const visBox = (await vis.boundingBox())!
  for (const binding of BINDINGS.filter((b) => before[b] && before[b].y < visBox.y))
    expect(pushed[binding], `${binding} started above the visualization`).toEqual(before[binding])

  // No other node is left under the visualization.
  for (const binding of BINDINGS.filter((b) => b !== OPENED)) {
    const box = (await locate.graphNodeByBinding(page, binding).boundingBox())!
    const overlaps =
      box.x < visBox.x + visBox.width &&
      visBox.x < box.x + box.width &&
      box.y < visBox.y + visBox.height &&
      visBox.y < box.y + box.height
    expect(overlaps, `${binding} is under the visualization`).toBe(false)
  }

  await toggleVisualization(page, OPENED)
  await expect(vis).toBeHidden()
  await expect.poll(() => positions(page)).toEqual(before)
})

test('One undo hides the visualization and puts the neighbours back', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await positions(page)
  const pushed = await showAndSettle(page, before)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.anyVisualization(page)).toBeHidden()
  await expect.poll(() => positions(page)).toEqual(before)

  // The pushes were made in the same step as the change, not after it by a watcher (which would
  // have cleared the redo stack): one redo shows the visualization and pushes the nodes again.
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(locate.anyVisualization(page)).toExist()
  await expect.poll(() => positions(page)).toEqual(pushed)
})

test('A pushed node that is dragged away stays where it was put', async ({ editorPage, page }) => {
  await editorPage
  const before = await positions(page)
  const [pushed, ...others] = moved(before, await showAndSettle(page, before))

  const box = (await locate.graphNodeByBinding(page, pushed!).boundingBox())!
  await page.mouse.move(box.x + 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 408, box.y + 8, { steps: 8 })
  await page.mouse.up()
  const dropped = (await settledPositions(page))[pushed!]!
  expect(dropped.x).toBeGreaterThan(box.x + 300)

  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toBeHidden()
  await expect.poll(async () => (await positions(page))[pushed!]).toEqual(dropped)
  // The other pushed nodes go home.
  for (const binding of others)
    await expect.poll(async () => (await positions(page))[binding]).toEqual(before[binding])
})

test('A drag with a pause before the release is one undo step', async ({ editorPage, page }) => {
  await editorPage
  const before = await positions(page)
  const pushedPositions = await showAndSettle(page, before)
  const pushed = moved(before, pushedPositions)[0]!

  const box = (await locate.graphNodeByBinding(page, pushed).boundingBox())!
  await page.mouse.move(box.x + 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 408, box.y + 8, { steps: 8 })
  // Longer than the undo manager's capture timeout: the release must still join the drag's step.
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect.poll(async () => (await positions(page))[pushed]!.x).toBeGreaterThan(box.x + 300)

  await page.keyboard.press('ControlOrMeta+Z')
  await expect.poll(async () => (await positions(page))[pushed]).toEqual(pushedPositions[pushed])
})

test('A visualization previewed with the modifier held moves no node', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await positions(page)
  const box = (await locate.graphNodeByBinding(page, OPENED).boundingBox())!
  await editorPage.down('Mod')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(locate.anyVisualization(page)).toBeVisible()
  // Give a push, if there were one, time to land.
  await page.waitForTimeout(500)
  expect(await positions(page)).toEqual(before)
  await editorPage.up('Mod')
})

/** The drawn path of every edge leaving the node with the given binding. */
async function edgePathsFrom(page: Page, binding: string): Promise<(string | null)[]> {
  const edges = await locate.connectedEdgesFromNodeWithBinding(page, binding)
  return edges
    .locator('path.edge.visible')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('d')))
}

test('A previewed visualization leaves the edges alone; a pinned one reroutes them', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await edgePathsFrom(page, OPENED)
  expect(before.length).toBeGreaterThan(0)
  const box = (await locate.graphNodeByBinding(page, OPENED).boundingBox())!
  await editorPage.down('Mod')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(locate.anyVisualization(page)).toBeVisible()
  // Give a reroute, if there were one, time to land.
  await page.waitForTimeout(500)
  expect(await edgePathsFrom(page, OPENED)).toEqual(before)
  await editorPage.up('Mod')
  await expect(locate.anyVisualization(page)).toBeHidden()

  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toBeVisible()
  await expect.poll(() => edgePathsFrom(page, OPENED)).not.toEqual(before)
})
