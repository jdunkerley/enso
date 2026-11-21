import { assert, expect, test } from 'vitest'
import {
  type Choice,
  flattenChoice,
  multipleChoiceConfiguration,
  singleChoiceConfiguration,
  widgetConfigurationSchema,
} from '../configuration'

const dynamicConfig = (): { values: Choice[] } => ({
  values: [
    {
      label: 'whitespace',
      value: [
        {
          value: 'space',
          label: null,
          parameters: [['starting_from', { kind: 'Numeric_Input', minimum: 0, maximum: 100 }]],
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
      parameters: [['character', { kind: 'Text_Input' }]],
    },
    {
      label: 'regex',
      value: 'regex',
      parameters: [['regex', { kind: 'Text_Input' }]],
    },
  ],
})

const expectedPossibleFunctions = new Map([
  [
    'space',
    {
      kind: 'FunctionCall',
      parameters: new Map([['starting_from', { kind: 'Numeric_Input', minimum: 0, maximum: 100 }]]),
    },
  ],
  ['newline', { kind: 'FunctionCall', parameters: new Map() }],
  [
    'character',
    {
      kind: 'FunctionCall',
      parameters: new Map([['character', { kind: 'Text_Input' }]]),
    },
  ],
  [
    'regex',
    {
      kind: 'FunctionCall',
      parameters: new Map([['regex', { kind: 'Text_Input' }]]),
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

test('an answer from an older library, still carrying display and label, parses without them', () => {
  const parsed = widgetConfigurationSchema.parse({
    type: 'Widget',
    constructor: 'Single_Choice',
    label: 'placeholder',
    values: [{ label: 'A', value: "'A'", parameters: [], icon: '' }],
    display: { type: 'Display', constructor: 'Always' },
  })
  expect(parsed).toEqual({
    kind: 'Single_Choice',
    values: [{ label: 'A', value: "'A'", parameters: [], icon: '' }],
  })
  expect(parsed).not.toHaveProperty('display')
  expect(parsed).not.toHaveProperty('label')

  const textInput = widgetConfigurationSchema.parse({
    constructor: 'Text_Input',
    display: { type: 'Display', constructor: 'When_Modified' },
  })
  expect(textInput).toEqual({ kind: 'Text_Input' })
})

test.each(['Date_Input', 'Date_Time_Input', 'Time_Input'] as const)('parses %s', (kind) => {
  const parsed = widgetConfigurationSchema.parse({ constructor: kind })
  expect(parsed).toEqual({ kind })
})

/* eslint-disable camelcase */
test('parses File_Browse with an action', () => {
  const parsed = widgetConfigurationSchema.parse({
    constructor: 'File_Browse',
    existing_only: false,
    action: 'Save',
    file_types: [],
  })
  expect(parsed).toMatchObject({ kind: 'File_Browse', existing_only: false, action: 'Save' })
})

test('parses File_Browse without an action', () => {
  const parsed = widgetConfigurationSchema.parse({
    constructor: 'File_Browse',
    existing_only: true,
    file_types: [],
  })
  expect(parsed).toMatchObject({ kind: 'File_Browse', existing_only: true })
})
/* eslint-enable camelcase */
