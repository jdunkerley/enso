/** @file Which inputs the text widget takes: the configuration or a literal, not the declared type. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as textWidget } from '@/components/GraphEditor/widgets/WidgetText.vue'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'

function score(input: WidgetInput): Score {
  return textWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}
const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: 'port' as WidgetInput['portId'],
  value: undefined,
  ...extra,
})

describe('the text widget scores', () => {
  test('an argument configured Text_Input Perfect', () => {
    expect(score(placeholder({ dynamicConfig: { kind: 'Text_Input' } }))).toBe(Score.Perfect)
  })

  test('a text literal Perfect', () => {
    expect(score(WidgetInput.FromAst(Ast.parseExpression("'hello'")!))).toBe(Score.Perfect)
  })

  test('a declared Text type without the configuration Mismatch', () => {
    expect(score(placeholder({ expectedType: 'Standard.Base.Data.Text.Text' as never }))).toBe(
      Score.Mismatch,
    )
  })
})
