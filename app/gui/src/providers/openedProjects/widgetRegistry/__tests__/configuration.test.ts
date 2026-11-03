import { assert, expect, test } from 'vitest'
import {
  type Choice,
  DisplayMode,
  flattenChoice,
  multipleChoiceConfiguration,
  singleChoiceConfiguration,
  widgetConfigurationSchema,
} from '../configuration'

const dynamicConfig = (): { label: string; values: Choice[] } => ({
  label: 'split_at',
  values: [
    {
      label: 'whitespace',
      value: [
        {
          value: 'space',
          label: null,
          parameters: [
            [
              'starting_from',
              { kind: 'Numeric_Input', minimum: 0, maximum: 100, display: DisplayMode.Always },
            ],
          ],
        },
        {
          value: 'newline',
          label: null,
          parameters: [],
        },
      ],
      parameters: [],
    },
    {
      label: 'character',
      value: 'character',
      parameters: [['character', { kind: 'Text_Input', display: DisplayMode.Always }]],
    },
    {
      label: 'regex',
      value: 'regex',
      parameters: [['regex', { kind: 'Text_Input', display: DisplayMode.Always }]],
    },
  ],
})

const expectedPossibleFunctions = new Map([
  [
    'space',
    {
      kind: 'FunctionCall',
      parameters: new Map([
        [
          'starting_from',
          { kind: 'Numeric_Input', minimum: 0, maximum: 100, display: DisplayMode.Always },
        ],
      ]),
    },
  ],
  ['newline', { kind: 'FunctionCall', parameters: new Map() }],
  [
    'character',
    {
      kind: 'FunctionCall',
      parameters: new Map([['character', { kind: 'Text_Input', display: DisplayMode.Always }]]),
    },
  ],
  [
    'regex',
    {
      kind: 'FunctionCall',
      parameters: new Map([['regex', { kind: 'Text_Input', display: DisplayMode.Always }]]),
    },
  ],
])

test('Configuration of the inner widget', () => {
  const singleChoiceInnerConfig = singleChoiceConfiguration({
    kind: 'Single_Choice',
    ...dynamicConfig(),
  })
  expect(singleChoiceInnerConfig).toEqual({
    kind: 'OneOfFunctionCalls',
    possibleFunctions: expectedPossibleFunctions,
  })

  const multipleChoiceInnerConfig = multipleChoiceConfiguration({
    kind: 'Multiple_Choice',
    ...dynamicConfig(),
  })
  expect(multipleChoiceInnerConfig).toEqual({
    kind: 'SomeOfFunctionCalls',
    possibleFunctions: expectedPossibleFunctions,
  })
})

test('a choice keeps the type it requires and its file name patterns', () => {
  const parsed = widgetConfigurationSchema.parse({
    type: 'Widget',
    constructor: 'Single_Choice',
    label: null,
    values: [
      {
        label: 'Auto Detect',
        value: 'Standard.Base.System.File_Format.Auto_Detect',
        parameters: [],
        icon: '',
      },
      {
        label: 'SQLite',
        value: '..SQLite',
        parameters: [],
        icon: '',
        requires: 'Standard.SQLite.SQLite_Format.SQLite_Format',
        patterns: ['*.sqlite', '*.db'],
      },
    ],
    display: { type: 'Display', constructor: 'When_Modified' },
  })
  assert(parsed.kind === 'Single_Choice')
  expect(parsed.values[0]).not.toHaveProperty('requires')
  expect(parsed.values[0]).not.toHaveProperty('patterns')
  const flattened = parsed.values.flatMap(flattenChoice)
  expect(flattened[1]).toMatchObject({
    value: '..SQLite',
    requires: 'Standard.SQLite.SQLite_Format.SQLite_Format',
    patterns: ['*.sqlite', '*.db'],
  })
})
