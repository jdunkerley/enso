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

test('Showing a visualization makes room, and hiding it restores the layout', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const before = await positions(page)
  await toggleVisualization(page, OPENED)
  const vis = locate.anyVisualization(page)
  await expect(vis).toExist()
  await expect.poll(async () => moved(before, await positions(page)).length).toBeGreaterThan(0)
  // The nodes moved, not the camera: the node showing the visualization stays put.
  expect(moved(before, await positions(page))).not.toContain(OPENED)

  // No other node is left under the visualization.
  const visBox = (await vis.boundingBox())!
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
  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toExist()
  await expect.poll(async () => moved(before, await positions(page)).length).toBeGreaterThan(0)
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(locate.anyVisualization(page)).toBeHidden()
  await expect.poll(() => positions(page)).toEqual(before)
})

test('A pushed node that is dragged away stays where it was put', async ({ editorPage, page }) => {
  await editorPage
  const before = await positions(page)
  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toExist()
  await expect.poll(async () => moved(before, await positions(page)).length).toBeGreaterThan(0)
  const pushed = moved(before, await positions(page))[0]!

  const box = (await locate.graphNodeByBinding(page, pushed).boundingBox())!
  await page.mouse.move(box.x + 8, box.y + 8)
  await page.mouse.down()
  await page.mouse.move(box.x + 408, box.y + 8, { steps: 8 })
  await page.mouse.up()
  const dropped = (await positions(page))[pushed]!
  expect(dropped.x).toBeGreaterThan(box.x + 300)

  await toggleVisualization(page, OPENED)
  await expect(locate.anyVisualization(page)).toBeHidden()
  await expect.poll(async () => (await positions(page))[pushed]).toEqual(dropped)
})
