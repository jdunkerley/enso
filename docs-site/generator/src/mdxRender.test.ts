/**
 * @file Adversarial doc comments, compiled by MDX itself (with GFM, as Docusaurus does) and
 * rendered: what the reader sees must be the doc comment's text, never an expression, a tag or an
 * ES module statement.
 */
import { evaluate } from '@mdx-js/mdx'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as runtime from 'react/jsx-runtime'
import remarkGfm from 'remark-gfm'
import { expect, test } from 'vitest'
import { markdownToMdx } from './mdx'

async function render(markdown: string): Promise<string> {
  const { default: Content } = await evaluate(markdownToMdx(markdown), {
    ...runtime,
    remarkPlugins: [remarkGfm],
  })
  return renderToStaticMarkup(createElement(Content))
}

test('braces and angle brackets in text stay text', async () => {
  const html = await render('Uses {x} and <b>bold</b> and a <https://example.com> link.')
  expect(html).toContain('Uses {x} and &lt;b&gt;bold&lt;/b&gt; and a')
  expect(html).not.toContain('<b>')
})

test('a Markdown backslash escape of a brace or bracket shows the character, and opens nothing', async () => {
  const html = await render('Escaped \\{x//} and \\<b\\> and \\* here.')
  expect(html).toContain('Escaped {x//} and &lt;b&gt; and * here.')
})

test('a result table whose cells hold JSON and tags renders them as text', async () => {
  const html = await render(
    [
      'Returns',
      '',
      '        | Value          | Tag   |',
      '        |----------------|-------|',
      '        | {"a": [1, {}]} | <b>x  |',
      '        | `{code}`       | a > b |',
    ].join('\n'),
  )
  expect(html).toContain('<table>')
  expect(html).toContain('{&quot;a&quot;: [1, {}]}')
  expect(html).toContain('&lt;b&gt;x')
  expect(html).toContain('<code>{code}</code>')
  expect(html).toContain('a &gt; b')
})

test('a paragraph starting with import or export stays a paragraph', async () => {
  const html = await render('import the data first.\n\nexport the result after.')
  expect(html).toContain('<p>import the data first.</p>')
  expect(html).toContain('<p>export the result after.</p>')
})
