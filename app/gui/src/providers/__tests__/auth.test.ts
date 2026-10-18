import { makeLocalUser, makeLocalUserSession } from '$/providers/auth'
import { makeLocalSession } from '$/providers/session'
import { Plan } from 'enso-common/src/services/Backend'
import { expect, test } from 'vitest'

test('the local user is named, unlicensed and on no organization', () => {
  const user = makeLocalUser('Working locally')
  expect(user).toMatchObject({
    name: 'Working locally',
    isEnabled: false,
    isOrganizationAdmin: false,
    plan: Plan.free,
    isEnsoTeamMember: false,
  })
  expect(user.userId).toBe('user-local')
})

test('the local user session is the local session with the local user', () => {
  const session = makeLocalUserSession(makeLocalSession(), 'Working locally')
  expect(session).toEqual({ ...makeLocalSession(), user: makeLocalUser('Working locally') })
  expect(session.user.name).toBe('Working locally')
})
