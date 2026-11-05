import { expect, test } from 'vitest'
import { escapeTableCell, linkedType, markdownToMdx } from './mdx'

test('escapes the characters MDX gives meaning to, outside code', () => {
  expect(markdownToMdx('Uses {braces} and <angles> but `{not} <here>`.')).toBe(
    'Uses \\{braces\\} and &lt;angles&gt; but `{not} <here>`.',
  )
})

test('separates blocks with blank lines and labels unlabelled code blocks enso', () => {
  expect(markdownToMdx('Text.\n```\na = {b}\n```\nMore.')).toBe(
    'Text.\n\n```enso\na = {b}\n```\n\nMore.',
  )
  expect(markdownToMdx('```python\nx\n```')).toBe('```python\nx\n```')
})

test('an indented block of table rows becomes a table', () => {
  expect(markdownToMdx('Returns\n\n        | A |\n        |---|\n        | 1 |')).toBe(
    'Returns\n\n| A |\n|---|\n| 1 |',
  )
})

test('an indented code block becomes a fenced enso block', () => {
  expect(markdownToMdx('Text.\n\n    x = 1\n    y = 2')).toBe('Text.\n\n```enso\nx = 1\ny = 2\n```')
})

test('code spans that name a type link to it', () => {
  const link = (code: string) => (code === 'Square' ? '../Square/index.mdx' : undefined)
  expect(markdownToMdx('See `Square` and `Other`.', { linkCode: link })).toBe(
    'See [`Square`](../Square/index.mdx) and `Other`.',
  )
})

test('autolinks become Markdown links (MDX has no autolinks)', () => {
  expect(markdownToMdx('See <https://example.com>.')).toBe(
    'See [https://example.com](https://example.com).',
  )
})

test('type expressions: shortened, linked where known, pipes escaped in table cells', () => {
  const link = (name: string) =>
    name === 'Standard.Table.Column.Column' ? '../Column/index.mdx' : undefined
  expect(linkedType('Standard.Table.Column.Column | Standard.Base.Data.Text.Text', link)).toBe(
    '[Column](../Column/index.mdx) | Text',
  )
  expect(escapeTableCell('[Column](x) | Text')).toBe('[Column](x) \\| Text')
})
