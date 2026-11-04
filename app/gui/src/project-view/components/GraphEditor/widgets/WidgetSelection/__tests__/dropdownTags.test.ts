import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import { makeType } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import type { SingleChoice } from '$/providers/openedProjects/widgetRegistry/configuration'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { assert, expect, test } from 'vitest'
import { shallowRef } from 'vue'
import { ExpressionTag, NestedChoiceTag, useExpressionTags } from '../tags'

test('Flattening nested choice tags', () => {
  const tag = new NestedChoiceTag('a', [
    new ExpressionTag('a'),
    new ExpressionTag('b'),
    new NestedChoiceTag('c', [new ExpressionTag('x'), new ExpressionTag('y')]),
  ])
  const flattened = tag.flatten()
  expect(flattened.map((t) => t.label)).toEqual(['a → a', 'a → b', 'a → c → x', 'a → c → y'])
})

const projectNames = mockProjectNameStore()
const SQLITE_FORMAT_QN = 'Standard.SQLite.SQLite_Format.SQLite_Format'

function formatTags(db: SuggestionDb) {
  const config: SingleChoice = {
    kind: 'Single_Choice',
    label: null,
    values: [
      {
        label: 'SQLite',
        value: '..SQLite',
        parameters: [],
        requires: SQLITE_FORMAT_QN,
      },
    ],
  }
  return useExpressionTags({
    dynamicConfig: config,
    staticTags: null,
    suggestionDb: db,
    projectNames: shallowRef(projectNames),
    libraryPublicTypes: new Map(),
  }).value
}

test('an option that requires a type imports it when picked, and keeps its short value', () => {
  const db = SuggestionDb.createMock([makeType(SQLITE_FORMAT_QN, { reexport: 'Standard.SQLite' })])
  const [tag] = formatTags(db)
  assert(tag instanceof ExpressionTag)
  expect(tag.expression).toBe('..SQLite')
  expect(tag.label).toBe('SQLite')
  expect(tag.requiredImports).toEqual([
    {
      kind: 'Unqualified',
      from: unwrap(projectNames.parseProjectPath(unwrap(tryQualifiedName('Standard.SQLite')))),
      import: 'SQLite_Format' as Identifier,
    },
  ])
})

test('an option whose type is unknown keeps detecting imports from its code', () => {
  const [tag] = formatTags(SuggestionDb.createMock([]))
  assert(tag instanceof ExpressionTag)
  expect(tag.requiredImports).toBeUndefined()
})
