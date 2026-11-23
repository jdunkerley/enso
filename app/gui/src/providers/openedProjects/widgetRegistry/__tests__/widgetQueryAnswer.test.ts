/* eslint-disable camelcase */
import { describe, expect, test } from 'vitest'
import { SchemaCache } from '../columnPickers'
import {
  functionCallFromAnswer,
  singleChoiceConfiguration,
  widgetQueryAnswerSchema,
  type FunctionCall,
} from '../configuration'

const textInput = { type: 'Widget', constructor: 'Text_Input' }

describe('widgetQueryAnswerSchema', () => {
  test('reads widgets, nulls and errors, in order', () => {
    const parsed = widgetQueryAnswerSchema.parse({
      arguments: [
        ['a', { widget: textInput }],
        ['b', { widget: null }],
        ['c', { error: { step: 'annotation', message: 'boom' } }],
      ],
    })
    expect(parsed.arguments.map(([name]) => name)).toEqual(['a', 'b', 'c'])
    expect(parsed.arguments[0]![1]).toMatchObject({
      widget: { kind: 'Text_Input' },
    })
    expect(parsed.arguments[1]![1]).toEqual({ widget: null })
    expect(parsed.arguments[2]![1]).toEqual({
      error: { step: 'annotation', message: 'boom' },
    })
  })

  test('rejects the old answer, a bare array of pairs', () => {
    expect(widgetQueryAnswerSchema.safeParse([['a', textInput]]).success).toBe(false)
  })
})

describe('column pickers in an answer', () => {
  test('an answer with pickers and its columns', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          'columns',
          {
            widget: {
              type: 'Widget',
              constructor: 'Column_Names',
              kinds: [],
              from: null,
              regex: true,
              by_type: false,
            },
          },
        ],
        [
          'on',
          {
            widget: {
              constructor: 'Column_Name',
              kinds: ['Numeric'],
              from: 'right',
              expression: false,
              reference: false,
              extra: [],
              columns_first: false,
            },
          },
        ],
      ],
      columns: { '': { names: ['A'], kinds: ['Textual'], type_names: ['Char'] } },
    })
    expect(answer.columns?.['']?.names).toEqual(['A'])
    expect(answer.arguments[0]![1]).toMatchObject({
      widget: { kind: 'Column_Names', kinds: [], from: null, regex: true, by_type: false },
    })
  })

  test('an answer without columns still parses', () => {
    expect(widgetQueryAnswerSchema.parse({ arguments: [] }).columns).toBeUndefined()
  })

  test('an unknown column kind is a schema mismatch', () => {
    expect(
      widgetQueryAnswerSchema.safeParse({
        arguments: [],
        columns: { '': { names: ['A'], kinds: ['Weird'], type_names: [''] } },
      }).success,
    ).toBe(false)
  })
})

describe('functionCallFromAnswer', () => {
  test('expands column pickers from the answer columns', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          'columns',
          {
            widget: {
              constructor: 'Column_Names',
              kinds: [],
              from: null,
              regex: false,
              by_type: false,
            },
          },
        ],
      ],
      columns: { '': { names: ['A', 'B'], kinds: ['Textual', 'Numeric'], type_names: ['', ''] } },
    })
    expect(functionCallFromAnswer(answer).parameters.get('columns')).toEqual({
      kind: 'Multiple_Choice',
      values: [
        { label: 'A', value: "'A'", parameters: [] },
        { label: 'B', value: "'B'", parameters: [] },
      ],
    })
  })

  test('expands a picker nested in a grouped option', () => {
    const picker = {
      constructor: 'Column_Name',
      kinds: ['Textual'],
      from: null,
      expression: false,
      reference: false,
      extra: [],
      columns_first: false,
    }
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          'filter',
          {
            widget: {
              constructor: 'Single_Choice',
              values: [
                {
                  label: 'Text',
                  value: [
                    {
                      label: '..Regex_Match',
                      value: '..Regex_Match',
                      parameters: [['pattern', picker]],
                    },
                  ],
                  parameters: [],
                },
              ],
            },
          },
        ],
      ],
      columns: { '': { names: ['A', 'B'], kinds: ['Textual', 'Numeric'], type_names: ['', ''] } },
    })
    const filter = functionCallFromAnswer(answer).parameters.get('filter')
    const group = filter?.kind === 'Single_Choice' ? filter.values[0] : undefined
    const inner = Array.isArray(group?.value) ? group.value[0] : undefined
    expect(inner?.parameters[0]?.[1]).toEqual({
      kind: 'Single_Choice',
      values: [{ label: 'A', value: "'A'", parameters: [] }],
    })
  })

  // The owner's #926 case, as `Table.filter` answers it: the inner call (`..Contains`, a
  // constructor with no annotations of its own) gets its operand's widget only from the choice it
  // was picked from, through `singleChoiceConfiguration`, with the subject's columns expanded.
  test("a grouped option's picker reaches the inner call's parameters", () => {
    const operand = {
      constructor: 'Column_Name',
      kinds: ['Textual'],
      from: null,
      expression: true,
      reference: true,
      extra: [{ label: '<Text Value>', value: '""', parameters: [], icon: '' }],
      columns_first: false,
    }
    const option = (value: string, parameters: unknown[] = []) => ({
      label: value,
      value,
      parameters,
      icon: '',
    })
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          'filter',
          {
            widget: {
              constructor: 'Single_Choice',
              values: [
                option('..Equal', [['to', operand]]),
                {
                  label: 'Comparisons',
                  value: [
                    option('..Between', [
                      ['lower', operand],
                      ['upper', operand],
                    ]),
                  ],
                  parameters: [],
                  icon: '',
                },
                {
                  label: 'Text',
                  value: [
                    option('..Starts_With', [['prefix', operand]]),
                    option('..Ends_With', [['suffix', operand]]),
                    option('..Contains', [['substring', operand]]),
                  ],
                  parameters: [],
                  icon: '',
                },
              ],
            },
          },
        ],
      ],
      columns: {
        '': {
          names: ['county', 'n', '[county]'],
          kinds: ['Textual', 'Numeric', 'Textual'],
          type_names: ['Char', 'Integer', 'Char'],
        },
      },
    })
    const filter = functionCallFromAnswer(answer, undefined, new SchemaCache()).parameters.get(
      'filter',
    )
    expect(filter?.kind).toBe('Single_Choice')
    if (filter?.kind !== 'Single_Choice') return
    const inner = singleChoiceConfiguration(filter)
    const expected = {
      kind: 'Single_Choice',
      values: [
        { label: '<Text Value>', value: '""', parameters: [], icon: '' },
        { label: '<Expression>', value: "(expr '[county]')", parameters: [] },
        { label: 'county', value: "(..Name 'county')", parameters: [] },
        { label: '[county]', value: "(..Name '[county]')", parameters: [] },
      ],
    }
    for (const [call, argument] of [
      ['..Contains', 'substring'],
      ['..Starts_With', 'prefix'],
      ['..Ends_With', 'suffix'],
      ['..Equal', 'to'],
      ['..Between', 'lower'],
      ['..Between', 'upper'],
    ] as const) {
      expect(inner.possibleFunctions.get(call)?.parameters.get(argument), call).toEqual(expected)
    }
  })

  test('keeps the errors apart from the widgets', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        ['a', { widget: textInput }],
        ['c', { error: { step: 'lookup', message: 'gone' } }],
      ],
    })
    const call = functionCallFromAnswer(answer)
    expect([...call.parameters.keys()]).toEqual(['a'])
    expect(call.errors?.get('c')).toEqual({ step: 'lookup', message: 'gone' })
  })

  test('has no errors when nothing failed', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [['a', { widget: null }]],
    })
    expect(functionCallFromAnswer(answer).errors).toBeUndefined()
  })

  test('lets an inherited parameter win, as before', () => {
    const inherited: FunctionCall = {
      kind: 'FunctionCall',
      parameters: new Map([['a', { kind: 'Boolean_Input' }]]),
    }
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [['a', { widget: textInput }]],
    })
    expect(functionCallFromAnswer(answer, inherited).parameters.get('a')?.kind).toBe(
      'Boolean_Input',
    )
  })
})
