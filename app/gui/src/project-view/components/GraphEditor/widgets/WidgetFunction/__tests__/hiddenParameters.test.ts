import { makeMethod } from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import * as widgetCfg from '$/providers/openedProjects/widgetRegistry/configuration'
import {
  type HiddenParameterGroup,
  hiddenParameters,
  insertPrefixArgument,
  orderedParameterGroups,
} from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import type { PortId } from '@/providers/portInfo'
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

function applicationOf(code: string | Ast.Expression, configuration?: widgetCfg.FunctionCall) {
  const ast = typeof code === 'string' ? Ast.parseExpression(code) : code
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

test('the placeholder flags: only later unset parameters ask to be named (the menu names every pick)', () => {
  // The add-argument menu passes `forceNamed`, so the first one is named too (see the insertion tests).
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

test.each`
  code                              | picked      | forceNamed | expected
  ${'Date_Time.new 2020 1 15'}      | ${'hour'}   | ${true}    | ${'Date_Time.new 2020 1 15 hour=0'}
  ${'Date_Time.new 2020 1 15'}      | ${'hour'}   | ${false}   | ${'Date_Time.new 2020 1 15 0'}
  ${'Date_Time.new 2020 1 15 9 30'} | ${'second'} | ${true}    | ${'Date_Time.new 2020 1 15 9 30 second=0'}
  ${'Date_Time.new 2020 1 15'}      | ${'zone'}   | ${true}    | ${'Date_Time.new 2020 1 15 zone=Time_Zone.system'}
`(
  'inserting $picked into $code (forceNamed $forceNamed) gives $expected',
  ({ code, picked, forceNamed, expected }) => {
    const block = Ast.parseBlock(`x = ${code}`)
    const assignment = [...block.statements()][0]
    assert(assignment instanceof Ast.Assignment)
    const app = applicationOf(assignment.expression)
    assert(app instanceof ArgumentApplication)
    const target = [...app.iterApplications()].find(
      ({ argument }) => argument instanceof ArgumentPlaceholder && argument.argInfo.name === picked,
    )
    assertDefined(target)
    assert(target.argument instanceof ArgumentPlaceholder)
    const hidden = hiddenParameters(app).find((p) => p.name === picked)
    assertDefined(hidden)
    const edit = block.module.edit()
    const value = Ast.parseExpression(hidden.defaultCode, edit)
    assertDefined(value)
    insertPrefixArgument(edit, target.appTree, target.argument, value, forceNamed)
    expect(edit.getVersion(block).code()).toBe(`x = ${expected}`)
  },
)

test('the add-argument menu lists outer calls first and leaves out calls with nothing hidden', () => {
  const group = (
    callName: string,
    depth: number,
    order: number,
    count: number,
  ): HiddenParameterGroup => ({
    callName,
    depth,
    order,
    parameters: Array.from({ length: count }, (_, i) => ({
      portId: `${callName}${i}` as PortId,
      name: `${callName}${i}`,
      type: undefined,
      defaultCode: 'Nothing',
    })),
    insert: () => {},
  })
  const ordered = orderedParameterGroups([
    group('today', 3, 0, 1),
    group('empty', 0, 1, 0),
    group('up_to', 1, 2, 2),
    group('sibling', 3, 3, 1),
  ])
  expect(ordered.map((g) => g.callName)).toEqual(['up_to', 'today', 'sibling'])
})
