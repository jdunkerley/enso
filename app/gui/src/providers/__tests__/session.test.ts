import { LOCAL_SESSION_EMAIL, makeLocalSession } from '$/providers/session'
import { expect, test } from 'vitest'

test('the local session has no tokens and lasts a year', () => {
  const now = Date.UTC(2026, 9, 17)
  const session = makeLocalSession(now)
  expect(session).toMatchObject({
    email: LOCAL_SESSION_EMAIL,
    accessToken: '',
    refreshToken: '',
    refreshUrl: '',
    clientId: 'local',
  })
  expect(new Date(session.expireAt).getTime()).toBe(now + 365 * 24 * 60 * 60 * 1000)
})
