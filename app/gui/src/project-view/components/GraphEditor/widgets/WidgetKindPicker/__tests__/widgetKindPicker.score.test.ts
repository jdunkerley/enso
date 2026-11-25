import { Score, type WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import { kindPickerScore } from '../../WidgetKindPicker.vue'

const union: WidgetConfiguration = {
  kind: 'Union',
  kinds: [
    { label: 'Integer', config: { kind: 'Numeric_Input' } },
    { label: 'Nothing', config: null },
  ],
}
const textOrRegex: WidgetConfiguration = {
  kind: 'Union',
  kinds: [
    { label: 'Text', config: { kind: 'Text_Input' } },
    { label: 'Regex', config: { kind: 'Regex_Input' } },
  ],
}
const input = (code: string | undefined, dynamicConfig?: WidgetConfiguration): WidgetInput => ({
  portId: 'p' as WidgetInput['portId'],
  value: code == null ? undefined : Ast.parseExpression(code)!,
  dynamicConfig,
})

test('a Union and a value of one of its kinds', () => {
  expect(kindPickerScore(input('42', union))).toBe(Score.Perfect)
  expect(kindPickerScore(input('Nothing', union))).toBe(Score.Perfect)
  expect(kindPickerScore(input("regex 'a'", textOrRegex))).toBe(Score.Perfect)
})
test('an unset union argument', () => {
  expect(kindPickerScore(input(undefined, union))).toBe(Score.Perfect)
})
test('a value of no kind steps aside', () => {
  expect(kindPickerScore(input('x', union))).toBe(Score.Mismatch)
})
test('no Union, no picker (an annotation applies)', () => {
  expect(kindPickerScore(input('42', { kind: 'Numeric_Input' }))).toBe(Score.Mismatch)
  expect(kindPickerScore(input('42'))).toBe(Score.Mismatch)
})
test('a Union of no kinds but Nothing: an unset argument is Nothing, any other value steps aside', () => {
  // `Widget.Union [] include_nothing=True`.
  const onlyNothing: WidgetConfiguration = {
    kind: 'Union',
    kinds: [{ label: 'Nothing', config: null }],
  }
  expect(kindPickerScore(input(undefined, onlyNothing))).toBe(Score.Perfect)
  expect(kindPickerScore(input('Nothing', onlyNothing))).toBe(Score.Perfect)
  expect(kindPickerScore(input('42', onlyNothing))).toBe(Score.Mismatch)
  // With no kinds at all (`include_nothing=False`) there is no picker.
  expect(kindPickerScore(input(undefined, { kind: 'Union', kinds: [] }))).toBe(Score.Mismatch)
})
