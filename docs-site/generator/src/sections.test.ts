import { expect, test } from 'vitest'
import { argumentDescriptions, splitSections } from './sections'

const DOC = [
  '---',
  'icon: preparation',
  '---',
  'Summary sentence. More.',
  '- `action`: an argument-like bullet in the body.',
  '## Arguments',
  '- ``column``: The column.',
  '- `filter`: The filter.',
  '- `nope`: Not an argument.',
  '## Returns',
  '- A table.',
  '## Implementation Notes',
  'Inside.',
].join('\n')

test('splits at level-2 headings and drops the front matter', () => {
  const { body, sections } = splitSections(DOC)
  expect(body).toBe('Summary sentence. More.\n- `action`: an argument-like bullet in the body.')
  expect(sections.map((section) => section.heading)).toEqual([
    'Arguments',
    'Returns',
    'Implementation Notes',
  ])
  expect(sections[1]!.text).toBe('- A table.')
})

test('a doc without headings is all body', () => {
  expect(splitSections('Just text.')).toEqual({
    body: 'Just text.',
    sections: [],
  })
})

test('argument bullets are matched by the code span that opens them', () => {
  const { sections } = splitSections(DOC)
  const { byName, unmatched } = argumentDescriptions(sections[0]!.text, [
    'column',
    'filter',
    'on_problems',
  ])
  expect(Object.fromEntries(byName)).toEqual({
    column: 'The column.',
    filter: 'The filter.',
  })
  expect(unmatched).toEqual(['- `nope`: Not an argument.'])
})
