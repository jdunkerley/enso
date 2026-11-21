/** @file Which inputs the number widget takes: the configuration or a literal, not the declared type. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as numberWidget } from '@/components/GraphEditor/widgets/WidgetNumber.vue'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'
import { typeDefaultConfig } from './typeDefaultFixture'

function score(input: WidgetInput): Score {
  return numberWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}
const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: 'port' as WidgetInput['portId'],
  value: undefined,
  ...extra,
})

describe('the number widget scores', () => {
  test('an argument configured Numeric_Input Perfect', () => {
    expect(score(placeholder({ dynamicConfig: { kind: 'Numeric_Input' } }))).toBe(Score.Perfect)
  })

  test('a numeric literal Perfect', () => {
    expect(score(WidgetInput.FromAst(Ast.parseExpression('42')!))).toBe(Score.Perfect)
    expect(score(WidgetInput.FromAst(Ast.parseExpression('-1.5')!))).toBe(Score.Perfect)
  })

  test('a text literal keeps its text input over the number input of a type default', async () => {
    const text = WidgetInput.FromAst(Ast.parseExpression("'hello'")!)
    expect(score({ ...text, dynamicConfig: await typeDefaultConfig('Numeric_Input') })).toBe(
      Score.Mismatch,
    )
    // An annotation's own Numeric_Input is unaffected.
    expect(score({ ...text, dynamicConfig: { kind: 'Numeric_Input' } })).toBe(Score.Perfect)
  })

  test('a declared number type without the configuration Mismatch', () => {
    for (const type of ['Number', 'Integer', 'Float'])
      expect(
        score(placeholder({ expectedType: `Standard.Base.Data.Numbers.${type}` as never })),
      ).toBe(Score.Mismatch)
  })
})
