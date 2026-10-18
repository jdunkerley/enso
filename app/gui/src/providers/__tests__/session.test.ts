import { LOCAL_SESSION_EMAIL, makeLocalSession } from '$/providers/session'
import { expect, test } from 'vitest'

test("the local session is the local user's email, with no tokens", () => {
  expect(makeLocalSession()).toEqual({ email: LOCAL_SESSION_EMAIL })
})
