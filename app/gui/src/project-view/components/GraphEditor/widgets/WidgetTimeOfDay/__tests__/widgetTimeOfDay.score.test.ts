/** @file Which inputs the time-of-day widget takes, and that it ranks between its neighbours. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as functionWidget } from '@/components/GraphEditor/widgets/WidgetFunction.vue'
import { widgetDefinition as numberWidget } from '@/components/GraphEditor/widgets/WidgetNumber.vue'
import { widgetDefinition as textWidget } from '@/components/GraphEditor/widgets/WidgetText.vue'
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
  test.each(['Time_Of_Day.now', 'Time_Of_Day.new 14 30', 'Time_Of_Day.new 14 30 15'])(
    '%s Perfect',
    (code) => {
      expect(score(inputFor(code))).toBe(Score.Perfect)
    },
  )

  test('a Time_Of_Day-typed placeholder Perfect, by reprType or expected type', () => {
    expect(score(placeholder(typedArgument(TIME_OF_DAY_TYPE)))).toBe(Score.Perfect)
    expect(score(placeholder({ expectedType: TIME_OF_DAY_TYPE as never }))).toBe(Score.Perfect)
  })

  test('a placeholder holding a time default Perfect', () => {
    expect(score(placeholder({ value: 'Time_Of_Day.now' }))).toBe(Score.Perfect)
  })

  test.each([
    'time1',
    'Time_Of_Day.new 24',
    'Time_Of_Day.new',
    'Time_Of_Day.new 14',
    'Time_Of_Day.new 14 30 15 7',
    'Time_Of_Day.new hour=14',
    'Time_Of_Day.new h 30',
    'Time_Of_Day.now.hour',
    'Date.today',
    '5',
    "'text'",
  ])('%s Mismatch', (code) => {
    expect(score(inputFor(code))).toBe(Score.Mismatch)
  })

  test('a Time_Of_Day-typed argument holding a variable or another expression Mismatch', () => {
    const typed = typedArgument(TIME_OF_DAY_TYPE)
    expect(score({ ...inputFor('time1'), ...typed })).toBe(Score.Mismatch)
    expect(score({ ...inputFor('Time_Of_Day.now.hour'), ...typed })).toBe(Score.Mismatch)
  })

  test('other placeholders Mismatch', () => {
    expect(score(placeholder())).toBe(Score.Mismatch)
    expect(score(placeholder(typedArgument('Standard.Base.Data.Text.Text')))).toBe(Score.Mismatch)
    expect(score(placeholder({ value: 'Missing_Argument.throw' }))).toBe(Score.Mismatch)
  })

  test('the target of a call or an operand is not a time to pick', () => {
    // `Time_Of_Day.now` here is the call's target; only the whole expression would be a value.
    expect(score(inputFor('Time_Of_Day.now.add_hours 3', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
    expect(score(inputFor('Time_Of_Day.now + x', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
    // The inner application of `Time_Of_Day.new 14 30 15` is its callee, not a value.
    expect(score(inputFor('Time_Of_Day.new 14 30 15', 'Time_Of_Day.new 14 30'))).toBe(
      Score.Mismatch,
    )
  })
})

describe('the time-of-day widget ranks', () => {
  test('after the argument name, before the function and the text and number widgets', () => {
    expect(timeWidget.priority).toBeGreaterThan(argumentNameWidget.priority)
    expect(timeWidget.priority).toBeLessThan(functionWidget.priority)
    expect(timeWidget.priority).toBeLessThan(textWidget.priority)
    expect(timeWidget.priority).toBeLessThan(numberWidget.priority)
  })
})
