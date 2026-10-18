import { makeLocalUser, makeLocalUserSession } from '$/providers/auth'
import { LOCAL_SESSION_EMAIL, makeLocalSession } from '$/providers/session'
import { expect, test } from 'vitest'

test('the local user is named, with the local email', () => {
  expect(makeLocalUser('Working locally')).toEqual({
    userId: 'user-local',
    name: 'Working locally',
    email: LOCAL_SESSION_EMAIL,
  })
})

test('the local user session is the local session with the local user', () => {
  const session = makeLocalUserSession(makeLocalSession(), 'Working locally')
  expect(session).toEqual({ ...makeLocalSession(), user: makeLocalUser('Working locally') })
  expect(session.user.name).toBe('Working locally')
})
