import { describe, expect, test } from 'vitest'
import {
  functionCallFromAnswer,
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

describe('functionCallFromAnswer', () => {
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
