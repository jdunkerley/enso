import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import {
  documentationData,
  getDocumentationSummary,
  getGroupIndex,
} from '$/providers/openedProjects/suggestionDatabase/documentation'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { prerenderMarkdown } from 'ydoc-shared/ast/documentation'
import { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'

const projectNames = mockProjectNameStore('local', 'Project')

const groups = [
  { name: 'From Base', project: 'Standard.Base' },
  { name: 'Other', project: 'local.Project' },
  { name: 'Another', project: 'local.Project' },
].map(({ name, project }) => ({
  name,
  project: unwrap(parseAbsoluteProjectPathRaw(project)).project as QualifiedName,
}))
test.each([
  ['From Base', 'local.Project.Main', undefined],
  ['From Base', 'Standard.Base', 0],
  ['Standard.Base.From Base', 'local.Project.Main', 0],
  ['Other', 'local.Project.Main', 1],
  ['local.Project.Other', 'local.Project.Main', 1],
  ['Other', 'local.Project.Some.Deep.Submodule', 1],
  ['Another', 'local.Project.Main', 2],
  ['Not Existing', 'local.Project.Main', undefined],
])('Get group index case %#.', (name, definedIn, expected) => {
  const definedInQn =
    unwrap(projectNames.parseProjectPathRaw(definedIn)).project ??
    ('local.Project' as QualifiedName)
  expect(getGroupIndex(name, definedInQn, groups)).toBe(expected)
})

test.each`
  docstring                                       | expectedSummary
  ${'Just summary'}                               | ${'Just summary'}
  ${'First paragraph\n\nSecond paragraph'}        | ${'First paragraph'}
  ${'First line\nsecond line'}                    | ${'First line second line'}
  ${'---\naliases: [alias]\n---\nSummary'}        | ${'Summary'}
  ${'Very Long Section. With multiple sentences'} | ${'Very Long Section.'}
  ${'One sentence, but with 0.8 number.'}         | ${'One sentence, but with 0.8 number.'}
`('Getting summary from docs case %#', ({ docstring, expectedSummary }) => {
  const prerendered = prerenderMarkdown(docstring)
  const parsed = ensoMarkdownParser.parse(prerendered)
  const cursor = parsed.cursor()
  expect(getDocumentationSummary(cursor.node, prerendered)).toBe(expectedSummary)
})

const doc = (yaml: string) => `---\n${yaml}---\nSummary.`

test.each([
  {
    yaml: 'arguments:\n  on: always\n  join_kind: selected\n  x: when_modified\n',
    expected: [
      ['on', 'always'],
      ['join_kind', 'selected'],
      ['x', 'when_modified'],
    ],
  },
  { yaml: 'icon: join\n', expected: [] },
  // An unknown value drops only that entry.
  { yaml: 'arguments:\n  a: always\n  b: sometimes\n', expected: [['a', 'always']] },
  // A non-map is ignored, not fatal to the other keys.
  { yaml: 'icon: join\narguments: always\n', expected: [] },
])('argumentDisplay from $yaml', ({ yaml, expected }) => {
  const data = documentationData(doc(yaml), undefined, [])
  expect([...data.argumentDisplay.entries()]).toEqual(expected)
})

test('arguments: does not disturb the other keys', () => {
  const data = documentationData(doc('icon: join\narguments:\n  on: always\n'), undefined, [])
  expect(data.iconName).toBe('join')
})
