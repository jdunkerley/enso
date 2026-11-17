/** @file Which inputs the date-time widget takes, and where it ranks. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as dateTimeWidget } from '@/components/GraphEditor/widgets/WidgetDateTime.vue'
import { widgetDefinition as timeWidget } from '@/components/GraphEditor/widgets/WidgetTimeOfDay.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import { DATE_TIME_TYPE } from '../dateTimeExpression'

function score(input: WidgetInput): Score {
  return dateTimeWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}

/** The input for the node of the parsed block `code` that has the code `subject`. */
function inBlock(code: string, subject: string): WidgetInput {
  const root = Ast.parseBlock(code)
  let found: Ast.Ast | undefined
  Ast.visitRecursive(root, (ast) => {
    if (
      found == null &&
      !(ast instanceof Ast.ExpressionStatement || ast instanceof Ast.BodyBlock) &&
      ast.code() === subject
    )
      found = ast
    return found == null
  })
  return WidgetInput.FromAst(found!)
}
const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: 'port' as WidgetInput['portId'],
  value: undefined,
  ...extra,
})
const typedArgument = (reprType: string | undefined) =>
  ({
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'moment', reprType } },
  }) as Partial<WidgetInput>

describe('the date-time widget scores', () => {
  test('a Date_Time-typed argument Perfect, by reprType or expected type', () => {
    expect(score(placeholder(typedArgument(DATE_TIME_TYPE)))).toBe(Score.Perfect)
    expect(score(placeholder({ expectedType: DATE_TIME_TYPE as never }))).toBe(Score.Perfect)
  })

  test('a node that is only a date-time Perfect, whatever its arguments', () => {
    expect(score(inBlock('x = Date_Time.now', 'Date_Time.now'))).toBe(Score.Perfect)
    expect(score(inBlock('x = Date_Time.new 2020 1 15 9 30', 'Date_Time.new 2020 1 15 9 30'))).toBe(
      Score.Perfect,
    )
    expect(score(inBlock('x = Date_Time.new y 1 15 zone=z', 'Date_Time.new y 1 15 zone=z'))).toBe(
      Score.Perfect,
    )
  })

  test('what is not a whole date-time node Mismatch', () => {
    expect(score(inBlock('x = Date_Time.now.hour', 'Date_Time.now'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = foo Date_Time.now', 'Date_Time.now'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.today', 'Date.today'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Time_Of_Day.now', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
  })

  test('an argument that has its own dropdown Mismatch', () => {
    const singleChoice = { dynamicConfig: { kind: 'Single_Choice', values: [] } } as never
    expect(score(placeholder({ ...typedArgument(DATE_TIME_TYPE), ...singleChoice }))).toBe(
      Score.Mismatch,
    )
  })

  test('ranks after the time-of-day widget and before the argument name', () => {
    expect(dateTimeWidget.priority).toBe(53)
    expect(dateTimeWidget.priority).toBeGreaterThan(timeWidget.priority)
    expect(dateTimeWidget.priority).toBeLessThan(argumentNameWidget.priority)
  })
})
