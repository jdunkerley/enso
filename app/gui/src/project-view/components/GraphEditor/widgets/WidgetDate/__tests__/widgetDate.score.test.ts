/** @file Which inputs the date widget takes, and where it ranks. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as argumentNameWidget } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { widgetDefinition as dateWidget } from '@/components/GraphEditor/widgets/WidgetDate.vue'
import { widgetDefinition as functionWidget } from '@/components/GraphEditor/widgets/WidgetFunction.vue'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
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
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'end', reprType } },
  }) as Partial<WidgetInput>

describe('the date widget scores', () => {
  test('a Date-typed argument Perfect, by reprType or expected type', () => {
    expect(score(placeholder(typedArgument(DATE_TYPE)))).toBe(Score.Perfect)
    expect(score(placeholder({ expectedType: DATE_TYPE as never }))).toBe(Score.Perfect)
    expect(score({ ...inputFor('Date.today'), ...typedArgument(DATE_TYPE) })).toBe(Score.Perfect)
  })

  test('a node that is only a date Perfect, whatever its arguments', () => {
    expect(score(inBlock('x = Date.today', 'Date.today'))).toBe(Score.Perfect)
    expect(score(inBlock('Date.tomorrow', 'Date.tomorrow'))).toBe(Score.Perfect)
    expect(score(inBlock('x = Date.new 2020 1 15', 'Date.new 2020 1 15'))).toBe(Score.Perfect)
    expect(score(inBlock('x = (Date.new 2020 1 15)', 'Date.new 2020 1 15'))).toBe(Score.Perfect)
    // A connected argument, or any other count of them, still is a date node.
    expect(score(inBlock('x = Date.new yr 1 15', 'Date.new yr 1 15'))).toBe(Score.Perfect)
    expect(score(inBlock('x = Date.new yr', 'Date.new yr'))).toBe(Score.Perfect)
  })

  test('what is not a whole date node Mismatch', () => {
    // The target of a call, an argument, a part of an application, and other calls.
    expect(score(inBlock('x = Date.today.add_days 3', 'Date.today'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.today.add_days 3', 'Date.today.add_days 3'))).toBe(
      Score.Mismatch,
    )
    expect(score(inBlock('x = foo Date.today', 'Date.today'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.new yr 1 15', 'Date.new yr 1'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.new', 'Date.new'))).toBe(Score.Mismatch)
    expect(score(inBlock('x = Date.parse "2020-01-15"', 'Date.parse "2020-01-15"'))).toBe(
      Score.Mismatch,
    )
    expect(score(inBlock('x = Time_Of_Day.now', 'Time_Of_Day.now'))).toBe(Score.Mismatch)
  })

  test('an argument that has its own dropdown Mismatch, so it gets no second one', () => {
    const singleChoice = { dynamicConfig: { kind: 'Single_Choice', values: [] } } as never
    expect(score(placeholder({ ...typedArgument(DATE_TYPE), ...singleChoice }))).toBe(
      Score.Mismatch,
    )
    expect(
      score({ ...inBlock('x = Date.today', 'Date.today'), ...singleChoice } as WidgetInput),
    ).toBe(Score.Mismatch)
    const tags = {
      [ArgumentInfoKey]: {
        appKind: 0,
        info: { name: 'end', reprType: DATE_TYPE, tagValues: ['Date.today'] },
      },
    } as Partial<WidgetInput>
    expect(score(placeholder(tags))).toBe(Score.Mismatch)
  })

  test('an untyped expression Mismatch, whatever its shape', () => {
    expect(score(inputFor('Date.today'))).toBe(Score.Mismatch)
    expect(score(placeholder({ value: 'Date.today' }))).toBe(Score.Mismatch)
    expect(score(placeholder())).toBe(Score.Mismatch)
  })

  test('other types Mismatch', () => {
    expect(score(placeholder(typedArgument('Standard.Base.Data.Text.Text')))).toBe(Score.Mismatch)
    expect(
      score(placeholder(typedArgument('Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day'))),
    ).toBe(Score.Mismatch)
  })
})

describe('the date widget ranks', () => {
  test('after the dropdown widgets, before the argument name and the function', () => {
    expect(dateWidget.priority).toBeGreaterThan(selectionWidget.priority)
    expect(dateWidget.priority).toBeLessThan(argumentNameWidget.priority)
    expect(dateWidget.priority).toBeLessThan(functionWidget.priority)
  })
})
