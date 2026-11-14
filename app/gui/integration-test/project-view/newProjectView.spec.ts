/** @file How a graph with no saved view is first shown, and that a new project starts with none. */
import { expect, test, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import { readFileSync } from 'node:fs'
import * as locate from './locate'

/** The template the engine creates a new project from: one node. */
const NEW_PROJECT_MAIN = readFileSync(
  new URL('../../../../lib/scala/pkg/src/main/resources/default/src/Main.enso', import.meta.url),
  'utf8',
)
const PROJECT = 'New Project 1'

test.afterEach(restoreMockMainFile)
test.use({
  setupApi: { local: () => setMockMainFile(NEW_PROJECT_MAIN), addDefaultProject: false },
})

/** The graph's scale, and where its node's centre is, relative to the viewport's centre. */
async function nodeView(page: Page) {
  const node = locate.graphNode(page)
  await expect(node).toHaveCount(1)
  const layer = await node.locator('xpath=..').getAttribute('style')
  const scale = Number(/scale\(([^)]+)\)/.exec(layer ?? '')?.[1])
  const nodeBox = await node.boundingBox()
  const viewportBox = await locate.graphEditor(page).locator('.viewport').boundingBox()
  if (nodeBox == null || viewportBox == null) return { scale, offset: null }
  return {
    scale,
    offset: {
      x: Math.round(nodeBox.x + nodeBox.width / 2 - (viewportBox.x + viewportBox.width / 2)),
      y: Math.round(nodeBox.y + nodeBox.height / 2 - (viewportBox.y + viewportBox.height / 2)),
    },
  }
}

async function expectNodeCentredAtFullSize(page: Page) {
  // Polled: the node grows as its widgets render, and the view follows it until the user acts.
  await expect
    .poll(() => nodeView(page))
    .toEqual({ scale: 1, offset: { x: expect.closeTo(0, -1), y: expect.closeTo(0, -1) } })
}

/** Pan the graph far away from its node, and wait for the view to be saved. */
async function panAway(page: Page) {
  await page.mouse.move(800, 800)
  await page.mouse.wheel(3000, 2000)
  await expect(locate.graphNode(page)).not.toBeInViewport()
  // The view is saved 200 ms after it stops changing.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('enso-graph-state') ?? ''))
    .toMatch(/"x":[0-9]{4}/)
}

test('a new project opens at 100%, its node centred', async ({ drivePage, page }) => {
  await drivePage.goToCategory.local().newEmptyProject().waitForEditorToLoad()
  await expectNodeCentredAtFullSize(page)
})

test('a new project does not take the view of a deleted one at the same path', async ({
  drivePage,
  page,
}) => {
  const editor = drivePage.goToCategory.local().newEmptyProject().waitForEditorToLoad()
  await editor
  await expectNodeCentredAtFullSize(page)
  await panAway(page)
  await editor.goToPage
    .drive()
    .driveTable.closeProject(PROJECT)
    .driveTable.rightClickRow(PROJECT)
    .contextMenu.delete()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(0)
    })
    // The same name, so the same directory and the same asset id.
    .newEmptyProject()
    .waitForEditorToLoad()
  await expect(page.getByRole('tab', { name: PROJECT })).toBeVisible()
  await expectNodeCentredAtFullSize(page)
})

test('a reopened project keeps its saved view', async ({ drivePage, page }) => {
  const editor = drivePage.goToCategory.local().newEmptyProject().waitForEditorToLoad()
  await editor
  await expectNodeCentredAtFullSize(page)
  await panAway(page)
  const panned = await nodeView(page)
  await editor.goToPage
    .drive()
    .driveTable.closeProject(PROJECT)
    .driveTable.openProject(PROJECT)
    .expectProjectEditorOpened(PROJECT)
  await expect.poll(() => nodeView(page)).toEqual(panned)
})

test.describe('a graph too tall for the viewport', () => {
  // The standard mock project, many nodes in a column, in a window too short for them.
  test.use({ setupApi: {}, viewport: { width: 1920, height: 800 } })

  test('opens at 100%, from its top edge', async ({ drivePage, page }) => {
    await drivePage.driveTable.openProject('Mock Project').expectProjectEditorOpened('Mock Project')
    const viewportBox = await locate.graphEditor(page).locator('.viewport').boundingBox()
    expect(viewportBox).not.toBeNull()
    const nodes = locate.graphNode(page)
    await expect(nodes.first()).toBeVisible()
    const layer = nodes.first().locator('xpath=..')
    // Polled: the graph is shown once its nodes have positions, and follows them as they are
    // measured.
    await expect
      .poll(async () => {
        const style = await layer.getAttribute('style')
        const boxes = await Promise.all((await nodes.all()).map((node) => node.boundingBox()))
        const tops = boxes.flatMap((box) => (box ? [box.y] : []))
        const bottoms = boxes.flatMap((box) => (box ? [box.y + box.height] : []))
        return {
          scale: Number(/scale\(([^)]+)\)/.exec(style ?? '')?.[1]),
          // The top node one margin (32 px) below the viewport's top edge.
          topMargin: Math.round(Math.min(...tops) - viewportBox!.y),
          overflowsBottom: Math.max(...bottoms) > viewportBox!.y + viewportBox!.height,
        }
      })
      .toEqual({ scale: 1, topMargin: expect.closeTo(32, -1), overflowsBottom: true })
  })
})
