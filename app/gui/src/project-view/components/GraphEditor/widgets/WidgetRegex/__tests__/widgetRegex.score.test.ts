/** @file Which inputs the regex widget takes. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as regexWidget } from '@/components/GraphEditor/widgets/WidgetRegex.vue'
import { Ast } from '@/util/ast'
import { describe, expect, test } from 'vitest'

const REGEX_INPUT = { kind: 'Regex_Input' } as const

function score(input: WidgetInput): Score {
  return regexWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}
const fromCode = (code: string, extra: Partial<WidgetInput> = {}): WidgetInput => ({
  ...WidgetInput.FromAst(Ast.parseExpression(code)!),
  ...extra,
})

describe('the regex widget scores', () => {
  test('`regex` under a Regex_Input annotation Perfect', () => {
    expect(score(fromCode("regex 'a'", { dynamicConfig: REGEX_INPUT }))).toBe(Score.Perfect)
  })

  test('`Regex.compile` under a Regex_Input annotation Perfect', () => {
    expect(score(fromCode("Regex.compile 'a'", { dynamicConfig: REGEX_INPUT }))).toBe(Score.Perfect)
  })

  test('an unset argument under a Regex_Input annotation Perfect', () => {
    const input: WidgetInput = {
      portId: 'port' as WidgetInput['portId'],
      value: undefined,
      dynamicConfig: REGEX_INPUT,
    }
    expect(score(input)).toBe(Score.Perfect)
  })

  test('a plain text under a Regex_Input annotation Mismatch (it is edited as text)', () => {
    expect(score(fromCode("'a'", { dynamicConfig: REGEX_INPUT }))).toBe(Score.Mismatch)
  })

  test('`regex` without the annotation Mismatch', () => {
    expect(score(fromCode("regex 'a'"))).toBe(Score.Mismatch)
  })
})
