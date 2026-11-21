import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import { regexPattern } from '../regexExpression'

const parse = (code: string) => Ast.parseExpression(code)!

test.each([
  "regex 'a'",
  'regex "a"',
  "Regex.compile 'a'",
  "Standard.Base.Data.Text.Regex.regex 'a'",
  "Standard.Base.Data.Text.Regex.Regex.compile 'a'",
])('regexPattern(%s) is the literal', (code) => {
  expect(regexPattern(parse(code))?.rawTextContent).toBe('a')
})

test.each(["'a'", 'regex x', "regex 'a' 'b'", "foo 'a'"])(
  'regexPattern(%s) is undefined',
  (code) => {
    expect(regexPattern(parse(code))).toBeUndefined()
  },
)

test('an unset argument has no pattern', () => {
  expect(regexPattern(undefined)).toBeUndefined()
})
