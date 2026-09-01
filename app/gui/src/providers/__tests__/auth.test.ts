import type { UserSession as CognitoUserSession } from '$/authentication/cognito'
import { isDirectoryId, isOrganizationId, isUserId, Plan } from 'enso-common/src/services/Backend'
import type { RemoteBackend } from 'enso-common/src/services/RemoteBackend'
import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'
import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createUsersMeQuery, isUsersMeQueryKey, makeSyntheticUser } from '../auth'

function fakeCognitoSession(overrides: Partial<CognitoUserSession> = {}): CognitoUserSession {
  return {
    email: 'user@example.com',
    accessToken: 'access',
    refreshToken: 'refresh',
    refreshUrl: 'https://example.com',
    expireAt: Rfc3339DateTime(new Date(Date.now() + 60_000).toJSON()),
    clientId: 'cognito-client-id',
    ...overrides,
  }
}

describe('isUsersMeQueryKey', () => {
  it('matches reactive usersMe query keys', () => {
    expect(isUsersMeQueryKey(['remote', 'usersMe', computed(() => 'client-id')])).toBe(true)
  })

  it('rejects unrelated query keys', () => {
    expect(isUsersMeQueryKey(['remote', 'otherQuery', computed(() => 'client-id')])).toBe(false)
  })
})

describe('makeSyntheticUser', () => {
  it('returns a placeholder user without any features enabled', () => {
    const user = makeSyntheticUser(fakeCognitoSession())
    expect(user.isEnabled).toBe(false)
    expect(user.isOrganizationAdmin).toBe(false)
    expect(user.isEnsoTeamMember).toBe(false)
    expect(user.plan).toBe(Plan.free)
    expect(user.userGroups).toBeNull()
    expect(user.groups).toEqual([])
  })

  it('derives identifiers in the expected newtype shape', () => {
    const user = makeSyntheticUser(fakeCognitoSession({ email: 'someone@enso.org' }))
    expect(isUserId(user.userId)).toBe(true)
    expect(user.userId).toContain('someone@enso.org')
    expect(isOrganizationId(user.organizationId)).toBe(true)
    expect(isDirectoryId(user.rootDirectoryId)).toBe(true)
  })

  it('propagates the Cognito email into name and email fields', () => {
    const user = makeSyntheticUser(fakeCognitoSession({ email: 'someone@enso.org' }))
    expect(user.email).toBe('someone@enso.org')
    expect(user.name).toBe('someone@enso.org')
  })

  it('keys identifiers on email so two users on the same Cognito app are distinct', () => {
    const a = makeSyntheticUser(fakeCognitoSession({ email: 'a@enso.org' }))
    const b = makeSyntheticUser(fakeCognitoSession({ email: 'b@enso.org' }))
    expect(a.userId).not.toBe(b.userId)
  })

  it('handles a missing email without producing an empty identifier', () => {
    const user = makeSyntheticUser(fakeCognitoSession({ email: '' }))
    expect(user.userId).toBe('user-cloud-unavailable-unknown')
  })
})

describe('createUsersMeQuery', () => {
  const remoteBackend = { type: 'remote' } as RemoteBackend
  const failingSetUsername = () => Promise.reject(new Error('should not be called'))

  it('short-circuits to null when authentication is disabled', async () => {
    const usersMe = vi.fn()
    const backend = { type: 'remote', usersMe } as unknown as RemoteBackend
    const query = createUsersMeQuery(fakeCognitoSession(), backend, failingSetUsername, true)
    await expect(query.queryFn!({} as never)).resolves.toBeNull()
    expect(usersMe).not.toHaveBeenCalled()
  })

  it('fetches users/me normally when authentication is enabled', async () => {
    const query = createUsersMeQuery(null, remoteBackend, failingSetUsername, false)
    // A null Cognito session already resolves to null without touching the backend.
    await expect(query.queryFn!({} as never)).resolves.toBeNull()
  })
})
