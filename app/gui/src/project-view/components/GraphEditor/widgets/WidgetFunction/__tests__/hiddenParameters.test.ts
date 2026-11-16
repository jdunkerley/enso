import { makeMethod } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import * as widgetCfg from '$/providers/openedProjects/widgetRegistry/configuration'
import { hiddenParameters } from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentPlaceholder, interpretCall } from '@/util/callTree'
import { assert, expect, test } from 'vitest'
import type { SuggestionEntryArgument } from 'ydoc-shared/languageServerTypes/suggestions'
import { assertDefined } from 'ydoc-shared/util/assert'

const T = 'Standard.Base.Data.Time.'
const required = (name: string, type: string): SuggestionEntryArgument => ({
  name,
  reprType: type,
  isSuspended: false,
  hasDefault: false,
})
const optional = (name: string, type: string, defaultValue: string): SuggestionEntryArgument => ({
  name,
  reprType: type,
  isSuspended: false,
  hasDefault: true,
  defaultValue,
})

const dateTimeNew = makeMethod('Standard.Base.Data.Time.Date_Time.Date_Time.new', {
  args: [
    required('year', 'Standard.Base.Data.Numbers.Integer'),
    required('month', 'Standard.Base.Data.Numbers.Integer'),
    required('day', 'Standard.Base.Data.Numbers.Integer'),
    optional('hour', 'Standard.Base.Data.Numbers.Integer', '0'),
    optional('minute', 'Standard.Base.Data.Numbers.Integer', '0'),
    optional('second', 'Standard.Base.Data.Numbers.Integer', '0'),
    optional('zone', `${T}Time_Zone.Time_Zone | Standard.Base.Nothing.Nothing`, 'Time_Zone.system'),
  ],
})

function applicationOf(code: string, configuration?: widgetCfg.FunctionCall) {
  const ast = Ast.parseExpression(code)
  assertDefined(ast)
  return ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: dateTimeNew,
    widgetCfg: configuration,
    subjectAsSelf: true,
  })
}

test('lists the unset, hidden parameters in parameter order', () => {
  const hidden = hiddenParameters(applicationOf('Date_Time.new 2020 1 15'))
  expect(hidden.map((p) => p.name)).toEqual(['hour', 'minute', 'second', 'zone'])
  expect(hidden.map((p) => p.type)).toEqual([
    'Integer',
    'Integer',
    'Integer',
    'Time_Zone | Nothing',
  ])
  expect(hidden.map((p) => p.defaultCode)).toEqual(['0', '0', '0', 'Time_Zone.system'])
})

test('a parameter that is already given is not listed', () => {
  const hidden = hiddenParameters(applicationOf('Date_Time.new 2020 1 15 hour=3'))
  expect(hidden.map((p) => p.name)).toEqual(['minute', 'second', 'zone'])
})

test('an expression that is not an application has no hidden parameters', () => {
  const ast = Ast.parseExpression('Date_Time.new')
  assertDefined(ast)
  expect(hiddenParameters(ast)).toEqual([])
})

test('a parameter configured to always show is not hidden', () => {
  const hidden = hiddenParameters(
    applicationOf('Date_Time.new 2020 1 15', {
      kind: 'FunctionCall',
      parameters: new Map([
        ['zone', { kind: 'Boolean_Input', display: widgetCfg.DisplayMode.Always }],
      ]),
    }),
  )
  expect(hidden.map((p) => p.name)).toEqual(['hour', 'minute', 'second'])
})

test('only the first unset parameter is inserted positionally; later ones are named', () => {
  // `applyArgUpdate` names an inserted parameter when `insertAsNamed`, so `second` after an unset
  // `minute` comes out as `second=0`, and the first (`hour`) as a plain `0`.
  const app = applicationOf('Date_Time.new 2020 1 15')
  assert(app instanceof ArgumentApplication)
  const named = new Map(
    [...app.iterApplications()].flatMap(({ argument }) =>
      argument instanceof ArgumentPlaceholder ?
        [[argument.argInfo.name, argument.insertAsNamed]]
      : [],
    ),
  )
  expect(named).toEqual(
    new Map([
      ['hour', false],
      ['minute', true],
      ['second', true],
      ['zone', true],
    ]),
  )
})
