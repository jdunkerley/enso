/**
 * @file `intoConfirmSignInErrorOrThrow`: Amplify 6 names a Cognito error by `name` alone, which the
 * sign-in page's one-time-code step matches as `code` (#178).
 */
import { intoConfirmSignInErrorOrThrow } from '$/authentication/cognito'
import { describe, expect, test } from 'vitest'

/** An error as Amplify 6 builds one from a Cognito response: a `name`, and no `code`. */
function amplifyError(name: string, message: string) {
  const error = new Error(message)
  error.name = name
  return error
}

describe('intoConfirmSignInErrorOrThrow', () => {
  test('gives a named Cognito exception its name as the code', () => {
    const error = intoConfirmSignInErrorOrThrow(
      amplifyError('CodeMismatchException', 'Invalid code or auth state for the user.'),
    )
    expect(error.code).toBe('CodeMismatchException')
    expect(error.message).toBe('Invalid code or auth state for the user.')
  })

  test('keeps an existing code', () => {
    const error = Object.assign(amplifyError('NotAuthorizedException', 'Session expired.'), {
      code: 'NotAuthorizedException',
    })
    expect(intoConfirmSignInErrorOrThrow(error)).toBe(error)
  })

  test('re-throws anything else', () => {
    const error = new TypeError('Failed to fetch')
    expect(() => intoConfirmSignInErrorOrThrow(error)).toThrow(error)
    expect(() => intoConfirmSignInErrorOrThrow('No current user')).toThrow()
  })
})
