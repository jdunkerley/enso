/**
 * @file Screenshot tests for the code font (`--font-mono`): Monaspace Neon, with the "Code
 * ligatures" setting at its default (off). The `enableMonaspaceCodeFont` feature flag is on by
 * default; it is set explicitly here anyway, and the kill switch (flag off) has its own test.
 *
 * The baselines are Linux-only (`*-linux.png`): the suite cannot run on native Windows, and CI runs
 * it on Ubuntu. Regenerate them in WSL or on Linux with `--update-snapshots` when a change to the
 * code font's rendering is intended, and check the new images by eye before committing them.
 */
import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { createTableNode } from './actions'
import { DELETE_KEY } from './keyboard'
import * as locate from './locate'

test.use({ featureFlags: { enableMonaspaceCodeFont: true } })

/**
 * Texture healing shows on `mlmlml` and `iiii`; the operators must stay three separate glyph pairs,
 * since coding ligatures are off by default.
 */
const SAMPLE_COMMENT = '# Code font sample: mlmlml iiii -> >= |>'
/** The same in code, so that the characters fall into separately highlighted tokens. */
const SAMPLE_CODE = 'mlmlml iiii = iiii.map (x -> x >= 1) |> mlmlml'

/**
 * Hide what blinks or depends on focus, and what shows the graph through the editor's backdrop.
 * Injected with `addStyleTag`: this Playwright version has no `style` option for `toHaveScreenshot`.
 */
const SCREENSHOT_STYLE = `
  .cm-cursorLayer, .cm-selectionLayer { visibility: hidden !important; }
  .CodeEditor .cm-editor { backdrop-filter: none !important; background-color: white !important; }
`

async function expectMonaspaceLoaded(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('13px "Monaspace Neon"')))
    .toBe(true)
  await page.evaluate(() => document.fonts.ready)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest whole-pixel rectangle containing all the given boxes, for a screenshot `clip`. */
function boundingClip(boxes: Box[], margin = 4): Box {
  const x = Math.floor(Math.min(...boxes.map((b) => b.x)) - margin)
  const y = Math.floor(Math.min(...boxes.map((b) => b.y)) - margin)
  const right = Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) + margin)
  const bottom = Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) + margin)
  return { x, y, width: right - x, height: bottom - y }
}

/** The boxes of the elements themselves. */
async function elementBoxes(locator: Locator): Promise<Box[]> {
  return Promise.all((await locator.all()).map(async (l) => (await l.boundingBox())!))
}

/**
 * The boxes of the text in the given elements. A `.cm-line` is as wide as the editor's longest
 * line; its text is what the screenshot needs.
 */
async function textBoxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const { x, y, width, height } = range.getBoundingClientRect()
      return { x, y, width, height }
    }),
  )
}

async function openCodeEditorWithSample(page: Page) {
  await page.keyboard.press(`ControlOrMeta+\``)
  const codeEditor = locate.codeEditor(page)
  await expect(codeEditor).toBeVisible()
  await page.evaluate(
    ({ comment, code }) => {
      const api = (window as any).__codeEditorApi
      api.writeText(`\n${comment}\n${code}\n`, api.textLength())
    },
    { comment: SAMPLE_COMMENT, code: SAMPLE_CODE },
  )
  const commentLine = codeEditor.locator('.cm-line', { hasText: SAMPLE_COMMENT })
  const codeLine = codeEditor.locator('.cm-line', { hasText: SAMPLE_CODE })
  await commentLine.scrollIntoViewIfNeeded()
  // Scrolling a line into view may scroll sideways too: every line is as wide as the longest one.
  await codeEditor.locator('.cm-scroller').evaluate((scroller) => (scroller.scrollLeft = 0))
  await expect(commentLine).toBeVisible()
  await expect(codeLine).toBeVisible()
  await expectMonaspaceLoaded(page)
  return { codeEditor, commentLine, codeLine }
}

test('Code editor uses Monaspace Neon at 13px, without ligatures', async ({ editorPage, page }) => {
  await editorPage
  const { codeEditor, commentLine, codeLine } = await openCodeEditorWithSample(page)

  const scroller = codeEditor.locator('.cm-scroller')
  await expect(scroller).toHaveCSS('font-family', /^"Monaspace Neon"/)
  await expect(scroller).toHaveCSS('font-size', '13px')
  await expect(scroller).toHaveCSS('font-feature-settings', 'normal')

  await page.addStyleTag({ content: SCREENSHOT_STYLE })
  await expect(page).toHaveScreenshot('code-editor.png', {
    clip: boundingClip([...(await textBoxes(commentLine)), ...(await textBoxes(codeLine))]),
  })
})

test('Code editor caret lands between `-` and `>`', async ({ editorPage, page }) => {
  await editorPage
  const { codeLine } = await openCodeEditorWithSample(page)
  await codeLine.click()
  await page.evaluate((code) => {
    const api = (window as any).__codeEditorApi
    api.placeCursor(api.indexOf(code) + code.indexOf('->') + 1)
  }, SAMPLE_CODE)

  const cursor = page.locator('.CodeEditor .cm-cursor-primary')
  await expect(cursor).toBeVisible()
  // The left edge of the `>` of `->`, measured on the rendered text.
  const arrowGreaterX = () =>
    codeLine.evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
        const at = node.textContent!.indexOf('->')
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at + 1)
        range.setEnd(node, at + 2)
        return range.getBoundingClientRect().x
      }
      return NaN
    })
  // Polled: CodeMirror draws the cursor for the new selection in a later frame than the dispatch.
  await expect
    .poll(async () => Math.abs((await cursor.boundingBox())!.x - (await arrowGreaterX())))
    .toBeLessThanOrEqual(1)
})

/**
 * Table cells with the samples, numbers of several widths (to show column alignment) and Enso
 * operators that coding ligatures would join.
 */
const TABLE_SAMPLE = [
  ['mlmlml', 'a -> b', '1', '12.5'],
  ['iiii', 'x >= 1', '22', '0.25'],
  ['wmwm', 'x |> f', '333', '1250'],
  ['lili', 'a == b', '4444', '-3.75'],
  ['illi', 'a != b', '55555', '100'],
]

/** Open the `aggregated` node's table visualization, full screen, showing {@link TABLE_SAMPLE}. */
async function openSampleTable(editorPage: EditorPageActions, page: Page, localApi: MockLocalApi) {
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      type: 'Matrix',
      // eslint-disable-next-line camelcase
      column_count: TABLE_SAMPLE[0]!.length,
      // eslint-disable-next-line camelcase
      all_rows_count: TABLE_SAMPLE.length,
      json: TABLE_SAMPLE,
    },
  )
  await editorPage.mockExpressionUpdate('aggregated', { type: ['Standard.Table.Table.Table'] })
  const aggregatedNode = locate.graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await expect(tableVisualization).toContainText('mlmlml')
  // Full screen, so that every column fits without scrolling.
  await locate.enterFullscreenButton(aggregatedNode).click()
  await expect.poll(async () => (await tableVisualization.boundingBox())?.width).toBe(1920)
  await expect(tableVisualization).toContainText('55555')
  await expectMonaspaceLoaded(page)
  return tableVisualization
}

// Deliberately not tagged `@ag-grid`: the licensed project would need its own baseline, and the
// grid's cells render the same in both modes.
test('Table visualization uses Monaspace Neon', async ({ editorPage, page, localApi }) => {
  const tableVisualization = await openSampleTable(editorPage, page, localApi)

  await expect(tableVisualization.locator('.ag-theme-alpine').first()).toHaveCSS(
    'font-family',
    /^"Monaspace Neon"/,
  )
  const cells = tableVisualization.locator('.ag-header-cell, .ag-cell')
  await expect(page).toHaveScreenshot('table-visualization.png', {
    clip: boundingClip(await elementBoxes(cells), 0),
  })
})

/** Replace the documentation with inline and fenced code samples; returns the docs and code lines. */
async function fillDocsWithSample(editorPage: EditorPageActions, page: Page) {
  await editorPage.toggleDocsAssetPanel()
  const docsContent = page.getByTestId('documentation-editor-content')
  await expect(docsContent.locator('.cm-line')).toExist()

  await docsContent.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press(DELETE_KEY)
  await docsContent.fill(
    `Inline code: \`${SAMPLE_CODE}\`\n\n\`\`\`\n${SAMPLE_COMMENT}\n${SAMPLE_CODE}\n\`\`\`\n\nEnd.`,
  )
  // Leave the editor, so that no line shows its Markdown markup.
  await locate.graphEditor(page).click({ position: { x: 300, y: 300 } })
  const lines = docsContent.locator('.cm-line')
  await expect(lines.filter({ hasText: 'End.' })).toBeVisible()
  await expectMonaspaceLoaded(page)

  const code = docsContent.locator('.cm-line').filter({ hasText: 'mlmlml' })
  await expect(code).toHaveCount(3)
  return { docsContent, code }
}

test('Documentation code uses Monaspace Neon', async ({ editorPage, page }) => {
  const { docsContent, code } = await fillDocsWithSample(editorPage, page)
  await expect(docsContent.getByText(SAMPLE_COMMENT)).toHaveCSS('font-family', /^"Monaspace Neon"/)
  await page.addStyleTag({ content: SCREENSHOT_STYLE })
  await expect(page).toHaveScreenshot('docs-code.png', {
    clip: boundingClip(await textBoxes(code)),
  })
})

// Not tagged `@ag-grid` either, for the same reason as the table visualization.
test('Table editor widget uses Monaspace Neon', async ({ editorPage, page }) => {
  await editorPage
  const node = await createTableNode(page)
  const widget = node.locator('.WidgetTableEditor')
  await expect(widget).toBeVisible()
  await widget.getByRole('button', { name: 'Add new column' }).click()
  await expect(widget.locator('.ag-header-cell-text')).toHaveText(['#', 'Column 1'])
  const firstValueCell = widget.locator('.ag-cell', { hasNotText: '0' }).first()
  await firstValueCell.click()
  await expect(firstValueCell).toBeFocused()
  await page.keyboard.type('mlmlml -> >= |>')
  await page.keyboard.press('Enter')
  await expect(widget.locator('.ag-cell')).toHaveText(['0', 'mlmlml -> >= |>', '', '1', '', ''])
  // Leave the grid, so that no cell shows focus.
  await locate.graphEditor(page).click({ position: { x: 300, y: 300 } })
  await expect(firstValueCell).not.toBeFocused()
  await expectMonaspaceLoaded(page)

  const grid = widget.locator('.agGridTableView')
  await expect(grid).toHaveCSS('font-family', /^"Monaspace Neon"/)
  await expect(grid).toHaveCSS('font-feature-settings', 'normal')
  // Nodes sit at fractional graph coordinates, which differ between runs; shift the widget onto
  // whole pixels, or every glyph edge anti-aliases differently.
  await widget.evaluate((element) => {
    const { x, y } = element.getBoundingClientRect()
    ;(element as HTMLElement).style.translate = `${Math.round(x) - x}px ${Math.round(y) - y}px`
  })
  // Inset past the rounded corners, where the node's colour shows through and varies.
  const box = (await widget.boundingBox())!
  await expect(page).toHaveScreenshot('table-editor-widget.png', {
    clip: { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: box.height - 16 },
  })
})

const CODING_SETS = '"ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "ss09"'

test('"Code ligatures" applies to read-only code, and not to the code editor', async ({
  editorPage,
  page,
  localApi,
}) => {
  const { docsContent, code } = await fillDocsWithSample(editorPage, page)
  const docsCode = docsContent.getByText(SAMPLE_COMMENT)
  await expect(docsCode).toHaveCSS('font-feature-settings', 'normal')

  // Turn the setting on from the dashboard's Settings page while the project stays open.
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('button', { name: 'Appearance' }).getByText('Appearance').click()
  await page.getByText('Code ligatures', { exact: true }).click()
  await page.getByTestId('project-view-tab-button').click()
  await expect(docsContent).toBeVisible()

  await expect(docsCode).toHaveCSS('font-feature-settings', CODING_SETS)
  await page.addStyleTag({ content: SCREENSHOT_STYLE })
  // The panels may still be settling after the tab switch: wait until the text stops moving.
  let clip = boundingClip(await textBoxes(code))
  await expect
    .poll(async () => {
      const previous = clip
      clip = boundingClip(await textBoxes(code))
      return JSON.stringify(clip) === JSON.stringify(previous)
    })
    .toBe(true)
  await expect(page).toHaveScreenshot('docs-code-ligatures.png', { clip })

  const tableVisualization = await openSampleTable(editorPage, page, localApi)
  await expect(tableVisualization.locator('.ag-cell', { hasText: 'a -> b' })).toHaveCSS(
    'font-feature-settings',
    CODING_SETS,
  )

  await page.keyboard.press(`ControlOrMeta+\``)
  await expect(locate.codeEditor(page).locator('.cm-scroller')).toHaveCSS(
    'font-feature-settings',
    'normal',
  )

  // The setting survives a reload.
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('codeLigatures')))
    .toBe(true)
})

test.describe('With the `enableMonaspaceCodeFont` kill switch off', () => {
  test.use({ featureFlags: { enableMonaspaceCodeFont: false } })

  test('Code editor falls back to DejaVu Sans Mono at 12px', async ({ editorPage, page }) => {
    await editorPage
    await page.keyboard.press(`ControlOrMeta+\``)
    const scroller = locate.codeEditor(page).locator('.cm-scroller')
    await expect(scroller).toHaveCSS('font-family', /^"DejaVu Sans Mono"/)
    await expect(scroller).toHaveCSS('font-size', '12px')
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('monaspaceCodeFont')),
    ).toBe(false)
  })
})
