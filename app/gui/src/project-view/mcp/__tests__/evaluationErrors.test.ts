import { Err } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { formatLsError, translateEngineError } from '../evaluationErrors'

test.each([
  [undefined, 'unknown LS error'],
  [null, 'unknown LS error'],
  ['plain text', 'plain text'],
  [new Error('thrown'), 'thrown'],
  [{ payload: 'from a ResultError' }, 'from a ResultError'],
  [{ ok: false, error: { payload: 'wrapped' } }, 'wrapped'],
  [{ code: 1 }, '{"code":1}'],
])('formatLsError(%j) is %j', (err, expected) => {
  expect(formatLsError(err)).toBe(expected)
})

test('formatLsError reads the payload of a rejected Result', () => {
  expect(formatLsError(Err('evaluation failed'))).toBe('evaluation failed')
})

test('formatLsError falls back to String for a value JSON cannot hold', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(formatLsError(cyclic)).toBe('[object Object]')
})

test.each([
  ['Cannot encode class org.enso.runtime.error.DataflowError to byte array.', 'a DataflowError'],
  ['Cannot encode class org.enso.runtime.error.PanicException to byte array', 'a Panic'],
  [
    'Cannot encode class java.lang.Long to byte array.',
    'a non-Text value of type `java.lang.Long`',
  ],
])('translateEngineError explains %j', (message, friendly) => {
  const translated = translateEngineError(message)
  expect(translated).toContain(`it evaluated to ${friendly}.`)
  expect(translated).toContain('.to_text')
  expect(translated).toContain('catch_primitive')
})

test('translateEngineError leaves any other message as it is', () => {
  expect(translateEngineError('Method `foo` could not be found.')).toBe(
    'Method `foo` could not be found.',
  )
})
