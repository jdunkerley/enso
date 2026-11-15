import {
  argumentDescriptions,
  panelText,
  sectionRanges,
  splitSections,
} from '@/components/ComponentHelp/sections'
import { expect, test } from 'vitest'

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

const FULL = [
  'Counts the working days.',
  '',
  '## Arguments',
  '- `end`: The last day.',
  '- `holidays`: Dates to skip.',
  '',
  '## Examples',
  '### January',
  '```',
  'days = start.work_days_until end',
  '```',
  '',
  '## Remarks',
  '### Including the end date',
  'Not counted by default.',
].join('\n')

test('sectionRanges gives each ## heading and its extent', () => {
  const ranges = sectionRanges(FULL)
  expect(ranges.map((r) => r.heading)).toEqual(['Arguments', 'Examples', 'Remarks'])
  expect(FULL.slice(ranges[0]!.from, ranges[0]!.to)).toMatch(
    /^## Arguments\n[\s\S]*Dates to skip\.\n\n$/,
  )
  expect(ranges[2]!.to).toBe(FULL.length)
})

test('panelText drops a fully matched Arguments section and splits off Remarks', () => {
  const { main, remarks } = panelText(FULL, ['end', 'holidays'])
  expect(main).not.toContain('## Arguments')
  expect(main).toContain('Counts the working days.')
  expect(main).toContain('## Examples')
  expect(main).not.toContain('## Remarks')
  expect(remarks).toBe('### Including the end date\nNot counted by default.')
})

test('panelText keeps the Arguments section when a bullet matches no argument', () => {
  const { main } = panelText(FULL, ['end'])
  expect(main).toContain('## Arguments')
  expect(main).toContain('`holidays`')
})

test('panelText without sections returns the text unchanged', () => {
  expect(panelText('Just text.', [])).toEqual({ main: 'Just text.', remarks: '' })
})

test('panelText gives an empty body to a section whose heading is the last line', () => {
  expect(panelText('Text.\n\n## Remarks', [])).toEqual({ main: 'Text.', remarks: '' })
})
