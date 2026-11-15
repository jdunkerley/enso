/** @file Which inputs the date widget takes, and that it ranks between its neighbours. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as dateWidget } from '@/components/GraphEditor/widgets/WidgetDate.vue'
import { widgetDefinition as functionWidget } from '@/components/GraphEditor/widgets/WidgetFunction.vue'
import { widgetDefinition as numberWidget } from '@/components/GraphEditor/widgets/WidgetNumber.vue'
import { widgetDefinition as textWidget } from '@/components/GraphEditor/widgets/WidgetText.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import { DATE_TYPE } from '../dateExpression'

function score(input: WidgetInput): Score {
  return dateWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
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
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'end', reprType } },
  }) as Partial<WidgetInput>

describe('the date widget scores', () => {
  test.each(['Date.today', 'Date.today.previous', 'Date.today.next', 'Date.new 2020 1 15'])(
    '%s Perfect',
    (code) => {
      expect(score(inputFor(code))).toBe(Score.Perfect)
    },
  )

  test('a Date-typed placeholder Perfect, by reprType or expected type', () => {
    expect(score(placeholder(typedArgument(DATE_TYPE)))).toBe(Score.Perfect)
    expect(score(placeholder({ expectedType: DATE_TYPE as never }))).toBe(Score.Perfect)
  })

  test('a placeholder holding a date default Perfect', () => {
    expect(score(placeholder({ value: 'Date.today' }))).toBe(Score.Perfect)
  })

  test.each([
    'date1',
    'Date.new 2020 1',
    'Date.new 2020 2 30',
    'Date.new y 1 15',
    'Date.today.add_days 3',
    '5',
    "'text'",
  ])('%s Mismatch', (code) => {
    expect(score(inputFor(code))).toBe(Score.Mismatch)
  })

  test('a Date-typed argument holding a variable or another expression Mismatch', () => {
    const typed = typedArgument(DATE_TYPE)
    expect(score({ ...inputFor('date1'), ...typed })).toBe(Score.Mismatch)
    expect(score({ ...inputFor('Date.today.add_days 3'), ...typed })).toBe(Score.Mismatch)
  })

  test('other placeholders Mismatch', () => {
    expect(score(placeholder())).toBe(Score.Mismatch)
    expect(score(placeholder(typedArgument('Standard.Base.Data.Text.Text')))).toBe(Score.Mismatch)
    expect(score(placeholder({ value: 'Missing_Argument.throw' }))).toBe(Score.Mismatch)
  })

  test('the target of a call is not a date to pick', () => {
    // `Date.today` here is the call's target; only the whole expression would be a value.
    expect(score(inputFor('Date.today.add_days 3', 'Date.today'))).toBe(Score.Mismatch)
    expect(score(inputFor('Date.today + x', 'Date.today'))).toBe(Score.Mismatch)
  })
})

describe('the date widget ranks', () => {
  test('after the argument name, before the function and the text and number widgets', () => {
    expect(dateWidget.priority).toBeGreaterThan(argumentNameWidget.priority)
    expect(dateWidget.priority).toBeLessThan(functionWidget.priority)
    expect(dateWidget.priority).toBeLessThan(textWidget.priority)
    expect(dateWidget.priority).toBeLessThan(numberWidget.priority)
  })
})
