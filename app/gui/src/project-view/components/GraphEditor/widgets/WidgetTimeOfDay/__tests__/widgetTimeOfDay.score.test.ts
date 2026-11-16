/** @file Which inputs the time-of-day widget takes, and where it ranks. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as functionWidget } from '@/components/GraphEditor/widgets/WidgetFunction.vue'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { widgetDefinition as timeWidget } from '@/components/GraphEditor/widgets/WidgetTimeOfDay.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import { TIME_OF_DAY_TYPE } from '../timeExpression'

function score(input: WidgetInput): Score {
  return timeWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}

/** The widget input for the node of the parsed `code` that has the code `subject`. */
function inputFor(code: string, subject: string = code): WidgetInput {
  const root = Ast.parseExpression(code)!
  let found: Ast.Ast | undefined
  Ast.visitRecursive(root, (ast) => {
    if (found == null && ast.code() === subject) found = ast
    return found == null
  })
  return WidgetInput.FromAst(found!)
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
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'time_of_day', reprType } },
  }) as Partial<WidgetInput>

describe('the time-of-day widget scores', () => {
  test('a Time_Of_Day-typed argument Perfect, by reprType or expected type', () => {
    expect(score(placeholder(typedArgument(TIME_OF_DAY_TYPE)))).toBe(Score.Perfect)
    expect(score(placeholder({ expectedType: TIME_OF_DAY_TYPE as never }))).toBe(Score.Perfect)
    expect(score({ ...inputFor('Time_Of_Day.now'), ...typedArgument(TIME_OF_DAY_TYPE) })).toBe(
      Score.Perfect,
    )
  })

  test('a node that is only a time Perfect, whatever its arguments', () => {
    expect(score(inBlock('x = Time_Of_Day.now', 'Time_Of_Day.now'))).toBe(Score.Perfect)
    expect(score(inBlock('x = Time_Of_Day.new 14 30', 'Time_Of_Day.new 14 30'))).toBe(Score.Perfect)
    expect(score(inBlock('x = Time_Of_Day.new h 30', 'Time_Of_Day.new h 30'))).toBe(Score.Perfect)
  })

  test('what is not a whole time node Mismatch', () => {
    expect(score(inBlock('x = Time_Of_Day.now.hour', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = foo Time_Of_Day.now', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.today', 'Date.today'))).toBe(Score.Mismatch)
  })

  test('an argument that has its own dropdown Mismatch, so it gets no second one', () => {
    const singleChoice = { dynamicConfig: { kind: 'Single_Choice', values: [] } } as never
    expect(score(placeholder({ ...typedArgument(TIME_OF_DAY_TYPE), ...singleChoice }))).toBe(
      Score.Mismatch,
    )
  })

  test('an untyped expression Mismatch, whatever its shape', () => {
    expect(score(inputFor('Time_Of_Day.now'))).toBe(Score.Mismatch)
    expect(score(placeholder({ value: 'Time_Of_Day.now' }))).toBe(Score.Mismatch)
    expect(score(placeholder())).toBe(Score.Mismatch)
  })

  test('other types Mismatch', () => {
    expect(score(placeholder(typedArgument('Standard.Base.Data.Text.Text')))).toBe(Score.Mismatch)
    expect(score(placeholder(typedArgument('Standard.Base.Data.Time.Date.Date')))).toBe(
      Score.Mismatch,
    )
  })
})

describe('the time-of-day widget ranks', () => {
  test('after the dropdown widgets, before the argument name and the function', () => {
    expect(timeWidget.priority).toBeGreaterThan(selectionWidget.priority)
    expect(timeWidget.priority).toBeLessThan(argumentNameWidget.priority)
    expect(timeWidget.priority).toBeLessThan(functionWidget.priority)
  })
})
