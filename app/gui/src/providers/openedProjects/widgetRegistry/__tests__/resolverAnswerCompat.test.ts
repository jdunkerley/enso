/**
 * Today's GUI reads the answers of the engine's widget resolvers (widgets PR 6a): every field
 * 6a adds (`resolver`, `unavailable`, the `search` and `revision` echo) is ignored by the
 * current schemas, so 6a merges independently of the GUI work (6b), which replaces this file.
 */
import { describe, expect, test } from 'vitest'
import { functionCallFromAnswer, widgetQueryAnswerSchema } from '../configuration'
import { answerSchema } from '../typeDefaults'

const textInput = { type: 'Widget', constructor: 'Text_Input' }
const resolver = { dependencies: ['self', 'right'], searchable: false }

describe("today's GUI reads 6a's answers", () => {
  test('a resolver answer is its widget', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [['on', { widget: textInput, resolver }]],
    })
    expect(functionCallFromAnswer(answer).parameters.get('on')).toMatchObject({
      kind: 'Text_Input',
    })
  })

  test('an unavailable dependency is no widget', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        ['on', { widget: null, resolver, unavailable: { dependency: 'right', message: 'bad' } }],
      ],
    })
    const call = functionCallFromAnswer(answer)
    expect(call.parameters.get('on')).toBeUndefined()
    expect(call.errors).toBeUndefined()
  })

  test("a resolver's error stays an error", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          'on',
          {
            error: { step: 'resolver', message: 'x' },
            resolver: { dependencies: [], searchable: false },
          },
        ],
      ],
    })
    expect(functionCallFromAnswer(answer).errors?.get('on')?.step).toBe('resolver')
  })

  test('the search and revision echo is ignored', () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        ['query', { widget: textInput, resolver: { dependencies: ['self'], searchable: true } }],
      ],
      search: 'abc',
      revision: '7',
    })
    expect(functionCallFromAnswer(answer).parameters.get('query')).toMatchObject({
      kind: 'Text_Input',
    })
  })

  test("a type's resolver default reads as no default", () => {
    const parsed = answerSchema.parse({ widget: null, resolver })
    expect(parsed).toEqual({ widget: null })
  })
})
