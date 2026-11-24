import type { MethodSuggestionEntry } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeMethod,
  makeStaticMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { expect, test } from 'vitest'
import { escapeColumn, useCompletionData } from '../completionData'

test.each([
  { name: 'A Column' },
  { name: '[A Column With Brackets]', escaped: '[A Column With Brackets]]' },
  { name: '[[A Column With Nested Brackets]]', escaped: '[[A Column With Nested Brackets]]]]' },
  { name: 'Brackets [in the] middle', escaped: 'Brackets [in the]] middle' },
  { name: 'Nested brackets [[in the]] middle', escaped: 'Nested brackets [[in the]]]] middle' },
  { name: 'With an [ open bracket' },
  { name: 'With a ] close bracket', escaped: 'With a ]] close bracket' },
])('Column name escaping', ({ name, escaped }) => expect(escapeColumn(name)).toBe(escaped ?? name))

function withTags(name: string, tagValues: string[]) {
  return { ...makeArgument(name), tagValues }
}

const VALUE_TYPES = ['..Boolean', '..Char', '..Unsupported_Data_Type', '..Mixed', '..Null']

const castMethod = makeMethod('Standard.Table.Column.Column.cast', {
  args: [
    makeArgument('self'),
    withTags('value_type', VALUE_TYPES),
    withTags('on_problems', ['..Ignore', 'Problem_Behavior.Report_Error']),
  ],
})
const staticMethod = makeStaticMethod('Standard.Table.Internal.Expression_Statics.choose', {
  args: [makeArgument('self'), withTags('flag', ['True', 'False'])],
}) as MethodSuggestionEntry

function argumentLabels(method: MethodSuggestionEntry, argIndex: number) {
  const { argumentOptions } = useCompletionData(
    () => [{ name: method.name, args: true, documentation: method }],
    undefined,
  )
  return argumentOptions(method.name, argIndex).map((option) => option.label)
}

test('An argument offers its `..Name` values, without ones that make no sense for the function', () => {
  expect(argumentLabels(castMethod, 1)).toEqual(['..Boolean', '..Char', '..Mixed'])
})

test('Values that are Enso code, not `..Name`, are not offered', () => {
  expect(argumentLabels(castMethod, 2)).toEqual(['..Ignore'])
})

test('The column argument of a column method offers nothing', () => {
  expect(argumentLabels(castMethod, 0)).toEqual([])
})

test("A static function's arguments skip its `self`, and booleans are offered in lower case", () => {
  expect(argumentLabels(staticMethod, 0)).toEqual(['true', 'false'])
})

test('An unknown function or argument offers nothing', () => {
  expect(argumentLabels(castMethod, 7)).toEqual([])
  const { argumentOptions } = useCompletionData(() => [], undefined)
  expect(argumentOptions('cast', 1)).toEqual([])
})
