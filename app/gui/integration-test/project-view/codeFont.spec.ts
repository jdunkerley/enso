/**
 * @file Screenshot tests for the code font (`--font-mono`): Monaspace Neon behind the
 * `enableMonaspaceCodeFont` feature flag, with the "Code ligatures" setting at its default (off).
 *
 * The baselines are Linux-only (`*-linux.png`): the suite cannot run on native Windows, and CI runs
 * it on Ubuntu. Regenerate them in WSL or on Linux with `--update-snapshots` when a change to the
 * code font's rendering is intended, and check the new images by eye before committing them.
 */
import { expect, test, type Locator, type Page } from 'integration-test/base'
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

/** Hide what blinks or depends on focus, and what shows the graph through the editor's backdrop. */
const SCREENSHOT_STYLE = `
  .cm-cursorLayer, .cm-selectionLayer { visibility: hidden !important; }
  .cm-editor { backdrop-filter: none !important; background-color: white !important; }
`

async function expectMonaspaceLoaded(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('13px "Monaspace Neon"')))
    .toBe(true)
  await page.evaluate(() => document.fonts.ready)
}

/** The smallest rectangle containing all the given elements, for a screenshot `clip`. */
async function boundingClip(locators: Locator[], margin = 4) {
  const boxes = await Promise.all(locators.map((l) => l.boundingBox()))
  const x = Math.min(...boxes.map((b) => b!.x)) - margin
  const y = Math.min(...boxes.map((b) => b!.y)) - margin
  const right = Math.max(...boxes.map((b) => b!.x + b!.width)) + margin
  const bottom = Math.max(...boxes.map((b) => b!.y + b!.height)) + margin
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.ceil(right - x),
    height: Math.ceil(bottom - y),
  }
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

  await expect(page).toHaveScreenshot('code-editor.png', {
    clip: await boundingClip([commentLine, codeLine]),
    style: SCREENSHOT_STYLE,
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
  const cursorX = (await cursor.boundingBox())!.x
  // The left edge of the `>` of `->`, measured on the rendered text.
  const arrowGreaterX = await codeLine.evaluate((line) => {
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
  expect(Math.abs(cursorX - arrowGreaterX)).toBeLessThanOrEqual(1)
})

// Deliberately not tagged `@ag-grid`: the licensed project would need its own baseline, and
// the grid's cells render the same in both modes.
test('Table visualization uses Monaspace Neon', async ({ editorPage, page }) => {
  await editorPage.mockExpressionUpdate('aggregated', { type: ['Standard.Table.Table.Table'] })
  await locate.graphNodeByBinding(page, 'aggregated').click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await expect(tableVisualization).toContainText('10 rows.')
  await expect(tableVisualization).toContainText('3,0')
  await expectMonaspaceLoaded(page)

  const grid = tableVisualization.locator('.ag-root-wrapper')
  await expect(tableVisualization.locator('.ag-theme-alpine').first()).toHaveCSS(
    'font-family',
    /^"Monaspace Neon"/,
  )
  await expect(grid).toHaveScreenshot('table-visualization.png')
})

test('Documentation code uses Monaspace Neon', async ({ editorPage, page }) => {
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
  await expect(docsContent.getByText(SAMPLE_COMMENT)).toHaveCSS('font-family', /^"Monaspace Neon"/)
  await expect(page).toHaveScreenshot('docs-code.png', {
    clip: await boundingClip(await code.all()),
    style: SCREENSHOT_STYLE,
  })
})
