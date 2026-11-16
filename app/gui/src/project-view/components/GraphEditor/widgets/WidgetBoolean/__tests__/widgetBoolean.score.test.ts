/** @file Which inputs the Boolean widget takes, and where it ranks. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as booleanWidget } from '@/components/GraphEditor/widgets/WidgetBoolean.vue'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import { BOOLEAN_TYPE } from '../booleanValue'

function score(input: WidgetInput): Score {
  return booleanWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}
const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: 'port' as WidgetInput['portId'],
  value: undefined,
  ...extra,
})
const booleanArgument = {
  [ArgumentInfoKey]: {
    appKind: 0,
    info: {
      name: 'keep',
      reprType: BOOLEAN_TYPE,
      isSuspended: false,
      hasDefault: true,
      defaultValue: 'False',
    },
  },
} as Partial<WidgetInput>

describe('the Boolean widget scores', () => {
  test('a literal Perfect, an argument or not', () => {
    expect(score(WidgetInput.FromAst(Ast.parseExpression('True')!))).toBe(Score.Perfect)
    expect(score(WidgetInput.FromAst(Ast.parseExpression('Boolean.False')!))).toBe(Score.Perfect)
    expect(
      score({ ...WidgetInput.FromAst(Ast.parseExpression('True')!), ...booleanArgument }),
    ).toBe(Score.Perfect)
  })

  test('an unset Boolean argument Perfect', () => {
    expect(score(placeholder(booleanArgument))).toBe(Score.Perfect)
  })

  test('a Boolean argument whose value is not a literal Mismatch, so it has no checkbox', () => {
    expect(
      score({ ...WidgetInput.FromAst(Ast.parseExpression('a > b')!), ...booleanArgument }),
    ).toBe(Score.Mismatch)
  })

  test('an unset argument of another type Mismatch', () => {
    expect(score(placeholder())).toBe(Score.Mismatch)
  })

  test('ranks after the dropdown and the argument name, so it is drawn inside both', () => {
    expect(booleanWidget.priority).toBeGreaterThan(selectionWidget.priority)
    expect(booleanWidget.priority).toBeGreaterThan(argumentNameWidget.priority)
  })
})
