// @vitest-environment node
import { expect, test } from 'vitest'
import {
  apiPath,
  colorFromString,
  documentationData,
  ensoMarkdownParser,
  entryIcon,
  extractMetadata,
  groupColor,
  groupColorVar,
  isIconName,
  isRequiredArgument,
  prerenderMarkdown,
  projectPathKey,
  type GroupInfo,
  type QualifiedName,
} from './gui'

// The front matter and the start of `Table.filter`'s doc comment
// (distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso), as the catalogue carries it.
const FILTER_DOC = [
  '---',
  'aliases: [filter rows, where]',
  'group: Standard.Base.Selections',
  'icon: preparation',
  'suggested: 2',
  '---',
  'Creates a new table with a filtered subset of rows.',
  '',
  'The rows are selected from the input table using a condition.',
  '',
  '## Arguments',
  '- ``column``: The column our condition is tested against.',
  '',
  '## Errors',
  '- If a column name cannot be found, a `No_Such_Column` dataflow error is',
  '  raised.',
].join('\n')

const groups: GroupInfo[] = [
  {
    project: 'Standard.Base' as QualifiedName,
    name: 'Selections',
    color: 'oklch(0.464 0.14 325)',
  },
]

test('the GUI modules load without a DOM', () => {
  expect(typeof document).toBe('undefined')
})

test("documentationData reads Table.filter's doc comment as the help panel does", () => {
  const data = documentationData(FILTER_DOC, 'Standard.Table' as QualifiedName, groups)
  expect(data.documentationSummary).toBe('Creates a new table with a filtered subset of rows.')
  expect(data.iconName).toBe('preparation')
  expect(data.groupIndex).toBe(0)
  expect(data.aliasesAndMacros).toEqual(['filter rows', 'where'])
  expect(data.documentation).toContain(
    '- If a column name cannot be found, a `No_Such_Column` dataflow error is raised.',
  )
})

test('the parser finds the level-2 headings', () => {
  const text = prerenderMarkdown(FILTER_DOC)
  const headings: string[] = []
  ensoMarkdownParser.parse(text).iterate({
    enter: (node) => {
      if (node.name === 'ATXHeading2') headings.push(text.slice(node.from, node.to))
    },
  })
  expect(headings).toEqual(['## Arguments', '## Errors'])
})

test('metadata, colours, icons, arguments and paths', () => {
  const tree = ensoMarkdownParser.parse(prerenderMarkdown(FILTER_DOC))
  const metadata = extractMetadata(prerenderMarkdown(FILTER_DOC), tree.cursor().node)
  expect(metadata.ok && metadata.value?.suggested).toBe(2)
  expect(groupColorVar(groups[0])).toBe('--group-color-Standard-Base-Selections')
  expect(groupColor(groups[0]!)).toBe('oklch(0.464 0.14 325)')
  expect(colorFromString('Standard.Table.Table.Table')).toMatch(/^(rgb|oklch)\(/)
  expect(entryIcon({ kind: 'Method' })).toBe('enso_logo')
  expect(isIconName('preparation')).toBe(true)
  expect(
    isRequiredArgument({
      name: 'column',
      reprType: 'Any',
      isSuspended: false,
      hasDefault: true,
      defaultValue: 'Missing_Argument.throw "column"',
    }),
  ).toBe(true)
  expect(projectPathKey('Standard.Table', 'Table.Table')).toBe('Standard.Table.Table.Table')
  expect(apiPath({ kind: 'type', module: 'Standard.Table.Table', name: 'Table' })).toBe(
    'Standard.Table/Table/Table',
  )
})
