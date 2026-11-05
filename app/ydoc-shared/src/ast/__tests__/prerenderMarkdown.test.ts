import { expect, test } from 'vitest'
import { prerenderMarkdown as reexported } from '../documentation'
import { prerenderMarkdown } from '../prerenderMarkdown'

test('joins hard-wrapped lines of a paragraph and keeps the blocks', () => {
  const source = 'First line\nsecond line.\n\n## Arguments\n- `a`: the\n  first.\n'
  // Pins the current behaviour: a blank line before a heading stays, the trailing newline goes.
  expect(prerenderMarkdown(source)).toBe(
    'First line second line.\n\n## Arguments\n- `a`: the first.',
  )
})

test('documentation.ts re-exports the same function', () => {
  expect(reexported).toBe(prerenderMarkdown)
})
