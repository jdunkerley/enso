/**
 * @file Screenshot tests for the code font (`--font-mono`): Monaspace Neon, with the "Code
 * ligatures" setting at its default (off) and the "Handwritten comments" setting at its default
 * (on: comments in the code editor and node comments in the graph use Monaspace Radon).
 *
 * The baselines are Linux-only (`*-linux.png`), since CI runs the suite on Ubuntu; on other
 * platforms only the comparisons are skipped (see `integration-test/screenshot.ts`). Regenerate
 * them in WSL or on Linux with `--update-snapshots` when a change to the code font's rendering is
 * intended, and check the new images by eye before committing them.
 */
import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { expectScreenshot } from 'integration-test/screenshot'
import { createTableNode } from './actions'
import { DELETE_KEY } from './keyboard'
import * as locate from './locate'

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

async function expectMonaspaceLoaded(page: Page, families = ['Monaspace Neon']) {
  for (const family of families) {
    await expect
      .poll(() => page.evaluate((family) => document.fonts.check(`13px "${family}"`), family))
      .toBe(true)
  }
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

/**
 * Shift the element by less than a pixel, onto whole-pixel coordinates.
 *
 * Text at a fractional offset is rasterised with its edges anti-aliased by that fraction - and the
 * code editor's scroller sits at one: its text rendered one pixel up in some runs and not others,
 * with identical layout. Nodes, in turn, sit at fractional graph coordinates that differ between
 * runs.
 */
async function alignToPixelGrid(locator: Locator) {
  await locator.evaluate((element) => {
    const { x, y } = element.getBoundingClientRect()
    ;(element as HTMLElement).style.translate = `${Math.round(x) - x}px ${Math.round(y) - y}px`
  })
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

/** Open the code editor, and append the given lines to the module. */
async function openCodeEditorWithLines(page: Page, lines: string[]) {
  await page.keyboard.press(`ControlOrMeta+\``)
  const codeEditor = locate.codeEditor(page)
  await expect(codeEditor).toBeVisible()
  await page.evaluate(
    (text) => {
      const api = (window as any).__codeEditorApi
      api.writeText(text, api.textLength())
    },
    `\n${lines.join('\n')}\n`,
  )
  const lineLocators = lines.map((line) => codeEditor.locator('.cm-line', { hasText: line }))
  await lineLocators[0]!.scrollIntoViewIfNeeded()
  // Scrolling a line into view may scroll sideways too: every line is as wide as the longest one.
  await codeEditor.locator('.cm-scroller').evaluate((scroller) => (scroller.scrollLeft = 0))
  for (const line of lineLocators) await expect(line).toBeVisible()
  return { codeEditor, lines: lineLocators }
}

async function openCodeEditorWithSample(page: Page) {
  const {
    codeEditor,
    lines: [commentLine, codeLine],
  } = await openCodeEditorWithLines(page, [SAMPLE_COMMENT, SAMPLE_CODE])
  await expectMonaspaceLoaded(page, ['Monaspace Neon', 'Monaspace Radon'])
  return { codeEditor, commentLine: commentLine!, codeLine: codeLine! }
}

test('Code editor uses Monaspace Neon at 13px, without ligatures', async ({ editorPage, page }) => {
  await editorPage
  const { codeEditor, commentLine, codeLine } = await openCodeEditorWithSample(page)

  const scroller = codeEditor.locator('.cm-scroller')
  await expect(scroller).toHaveCSS('font-family', /^"Monaspace Neon"/)
  await expect(scroller).toHaveCSS('font-size', '13px')
  await expect(scroller).toHaveCSS('font-feature-settings', 'normal')
  // The comment is in Radon, by the "Handwritten comments" setting's default.
  await expect(commentLine.locator('.tok-comment').first()).toHaveCSS(
    'font-family',
    /^"Monaspace Radon"/,
  )

  await page.addStyleTag({ content: SCREENSHOT_STYLE })
  await alignToPixelGrid(scroller)
  await expectScreenshot(page, 'code-editor.png', {
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

/** A text literal of `|`s, in Neon: a column ruler for the lines between the two of them. */
const ruler = (name: 'above' | 'below') => `ruler_${name} = '${'|'.repeat(52)}'`
/**
 * Comments of every kind, between two rulers: a documentation comment, a line with code and a
 * trailing comment (so that Neon and Radon meet within a line), and a line comment.
 */
const COMMENT_SAMPLE = [
  ruler('above'),
  '## Documentation comment: mlmlml iiii -> >=',
  'sample = mlmlml -> 42 # trailing: iiii mlmlml',
  '# Line comment: mlmlml iiii -> >= |> == !=',
  ruler('below'),
]
/** The line where Neon and Radon meet, and the column where its comment starts. */
const MIXED_LINE = COMMENT_SAMPLE[2]!
const MIXED_LINE_COMMENT_COLUMN = MIXED_LINE.indexOf('#')

/** The left edge of every character of a `.cm-line`, in order. */
function characterXs(line: Locator): Promise<number[]> {
  return line.evaluate((line) => {
    const xs: number[] = []
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
      for (let i = 0; i < node.textContent!.length; i++) {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        xs.push(range.getBoundingClientRect().x)
      }
    }
    return xs
  })
}

/**
 * Place the code editor's caret at the given column of the given line, and check that it is at the
 * left edge of the same column of the ruler line.
 */
async function expectCaretOnRuler(page: Page, ruler: Locator, line: string, column: number) {
  await page.evaluate(
    ({ line, column }) => {
      const api = (window as any).__codeEditorApi
      api.placeCursor(api.indexOf(line) + column)
    },
    { line, column },
  )
  const cursor = page.locator('.CodeEditor .cm-cursor-primary')
  // Polled: CodeMirror draws the cursor for the new selection in a later frame than the dispatch.
  // The ruler is measured again each time, in case placing the caret scrolled the editor.
  await expect
    .poll(
      async () => Math.abs((await cursor.boundingBox())!.x - (await characterXs(ruler))[column]!),
      { message: `caret at column ${column} of ${JSON.stringify(line)}` },
    )
    .toBeLessThanOrEqual(1)
}

test('Code editor comments use Monaspace Radon, on the Neon column grid', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const { codeEditor, lines } = await openCodeEditorWithLines(page, COMMENT_SAMPLE)
  await expectMonaspaceLoaded(page, ['Monaspace Neon', 'Monaspace Radon'])
  const [rulerAbove, docLine, mixedLine, commentLine] = lines as [
    Locator,
    Locator,
    Locator,
    Locator,
  ]

  // Every kind of comment is in Radon; the code beside a trailing comment stays in Neon.
  for (const line of [docLine, mixedLine, commentLine]) {
    await expect(line.locator('.tok-comment').first()).toHaveCSS(
      'font-family',
      /^"Monaspace Radon"/,
    )
  }
  await expect(mixedLine.getByText('sample', { exact: true })).toHaveCSS(
    'font-family',
    /^"Monaspace Neon"/,
  )

  // Every character of every line starts on the ruler's column grid: Radon's advance is Neon's.
  const rulerXs = await characterXs(rulerAbove)
  for (const [index, line] of [docLine, mixedLine, commentLine].entries()) {
    const text = COMMENT_SAMPLE[index + 1]!
    expect(text.length).toBeLessThan(COMMENT_SAMPLE[0]!.length)
    const xs = await characterXs(line)
    expect(xs.length, text).toBe(text.length)
    for (const [column, x] of xs.entries()) {
      expect(Math.abs(x - rulerXs[column]!), `column ${column} of ${text}`).toBeLessThan(0.5)
    }
  }
  // Radon's vertical metrics do not make comment lines taller than code lines.
  const lineHeights = await Promise.all(lines.map(async (l) => (await l.boundingBox())!.height))
  for (const height of lineHeights) expect(height).toBeCloseTo(lineHeights[0]!, 1)

  await page.addStyleTag({ content: SCREENSHOT_STYLE })
  await alignToPixelGrid(codeEditor.locator('.cm-scroller'))
  await expectScreenshot(page, 'code-editor-comments.png', {
    clip: boundingClip((await Promise.all(lines.map(textBoxes))).flat()),
  })
})

test('Code editor caret keeps the Neon grid across a comment boundary', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const { lines } = await openCodeEditorWithLines(page, COMMENT_SAMPLE)
  await expectMonaspaceLoaded(page, ['Monaspace Neon', 'Monaspace Radon'])
  await lines[2]!.click()
  // Each side of the boundary between code and a trailing comment, the start and end of a line
  // comment, and columns inside each.
  const commentLine = COMMENT_SAMPLE[3]!
  const positions: [string, number][] = [
    ...[-2, -1, 0, 1, 2].map((d): [string, number] => [MIXED_LINE, MIXED_LINE_COMMENT_COLUMN + d]),
    [MIXED_LINE, MIXED_LINE.length - 1],
    [commentLine, 0],
    [commentLine, 1],
    [commentLine, 20],
    [commentLine, commentLine.length - 1],
  ]
  for (const [line, column] of positions) await expectCaretOnRuler(page, lines[0]!, line, column)
})

/** A node comment with texture-healing pairs, descenders and digits. */
const NODE_COMMENT_SAMPLE = 'Node comment: mlmlml iiii gjpqy 123'

/** Replace the `final` node's comment with {@link NODE_COMMENT_SAMPLE}, by editing it in the graph. */
async function setNodeCommentSample(page: Page) {
  const comment = locate.nodeCommentContent(locate.graphNodeByBinding(page, 'final'))
  await comment.click()
  await page.keyboard.press('ControlOrMeta+A')
  await comment.fill(NODE_COMMENT_SAMPLE)
  await page.keyboard.press('Enter')
  await expect(comment).not.toBeFocused()
  await expect(comment).toHaveText(NODE_COMMENT_SAMPLE)
  return comment
}

/** The client box of each character of the element's text, in order. */
function characterBoxes(element: Locator): Promise<Box[]> {
  return element.evaluate((element) => {
    const boxes: Box[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
      for (let i = 0; i < node.textContent!.length; i++) {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const { x, y, width, height } = range.getBoundingClientRect()
        boxes.push({ x, y, width, height })
      }
    }
    return boxes
  })
}

test('Node comments use Monaspace Radon, at the UI size', async ({ editorPage, page }) => {
  await editorPage
  const comment = await setNodeCommentSample(page)
  await expectMonaspaceLoaded(page, ['Monaspace Neon', 'Monaspace Radon'])

  await expect(comment).toHaveCSS('font-family', /^"Monaspace Radon"/)
  // The size the UI face had: Radon's x-height matches M PLUS 1's.
  await expect(comment).toHaveCSS('font-size', '11.5px')
  await expect(comment).toHaveCSS('font-feature-settings', 'normal')

  // The bubble is exactly as tall in Radon as in the UI face, so it does not move when Radon
  // finishes loading.
  const height = async () => (await comment.boundingBox())!.height
  const radonHeight = await height()
  await page.evaluate(() => document.documentElement.classList.remove('handwrittenComments'))
  await expect(comment).toHaveCSS('font-family', /^"M PLUS 1"/)
  expect(await height()).toBe(radonHeight)
  await page.evaluate(() => document.documentElement.classList.add('handwrittenComments'))
  await expect(comment).toHaveCSS('font-family', /^"Monaspace Radon"/)

  // A click on the left half of a character puts the caret before it.
  const boxes = await characterBoxes(comment)
  expect(boxes.length).toBe(NODE_COMMENT_SAMPLE.length)
  for (const column of [0, 1, NODE_COMMENT_SAMPLE.indexOf('mlmlml') + 3, boxes.length - 1]) {
    const box = boxes[column]!
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
    await expect(comment).toBeFocused()
    await expect
      .poll(() => page.evaluate(() => window.getSelection()!.focusOffset), {
        message: `caret at column ${column}`,
      })
      .toBe(column)
  }
  await page.keyboard.press('Enter')
  await expect(comment).not.toBeFocused()

  // Nodes sit at fractional graph coordinates, which differ between runs.
  await alignToPixelGrid(locate.graphNodeByBinding(page, 'final').locator('.GraphNodeComment'))
  // The edge into `final` runs behind the translucent bubble. Its sub-pixel position differed
  // between CI and a local Linux run, so the graph's SVGs (edges and output ports) are hidden:
  // the screenshot is about the text.
  await page.addStyleTag({
    content: '.GraphEditor svg, .GraphEditor svg * { visibility: hidden !important; }',
  })
  await expectScreenshot(page, 'node-comment.png', {
    clip: boundingClip(await textBoxes(comment.locator('.cm-line')), 2),
  })
})

test.describe('Handwritten comments off', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'enso-code-font-settings',
        JSON.stringify({ state: { handwrittenComments: false }, version: 1 }),
      )
    })
  })

  test('Code editor comments use Monaspace Neon', async ({ editorPage, page }) => {
    await editorPage
    const { lines } = await openCodeEditorWithLines(page, COMMENT_SAMPLE)
    await expectMonaspaceLoaded(page)
    for (const line of lines.slice(1, -1)) {
      await expect(line.locator('.tok-comment').first()).toHaveCSS(
        'font-family',
        /^"Monaspace Neon"/,
      )
    }
    // Radon is not fetched.
    expect(
      await page.evaluate(() =>
        [...document.fonts]
          .filter((face) => face.family.includes('Radon') && face.status !== 'unloaded')
          .map((face) => face.family),
      ),
    ).toEqual([])
  })

  test('Node comments use the UI face', async ({ editorPage, page }) => {
    await editorPage
    const comment = await setNodeCommentSample(page)
    await expect(comment).toHaveCSS('font-family', /^"M PLUS 1"/)
    await expect(comment).toHaveCSS('font-size', '11.5px')
  })
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
  await expectScreenshot(page, 'table-visualization.png', {
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
  await expectScreenshot(page, 'docs-code.png', {
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
  // Nodes sit at fractional graph coordinates, which differ between runs.
  await alignToPixelGrid(widget)
  // Inset past the rounded corners, where the node's colour shows through and varies.
  const box = (await widget.boundingBox())!
  await expectScreenshot(page, 'table-editor-widget.png', {
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
  // The panels may still be settling after the tab switch: wait until the text stops moving. Compare
  // positions a couple of frames apart - two reads within one frame always agree, and the first
  // poll runs straight after the first read, so it passed mid-animation.
  let clip = boundingClip(await textBoxes(code))
  await expect
    .poll(async () => {
      const previous = clip
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      clip = boundingClip(await textBoxes(code))
      return JSON.stringify(clip) === JSON.stringify(previous)
    })
    .toBe(true)
  await expectScreenshot(page, 'docs-code-ligatures.png', { clip })

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
