/** @file The signed-in user: always the local user, named "Working locally". */
import { proxyRefs } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import * as backendModule from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { LOCAL_SESSION_EMAIL, useSession, type UserSession as LocalSession } from './session'
import { useText } from './text'

/** The local user's session, with the user. */
export interface UserSession extends LocalSession {
  readonly user: backendModule.User
  /** Always `true`: there is no Enso Cloud. Removed with its uses in PR 3. */
  readonly isCloudDataUnavailable: boolean
  /** Always `true`: there is no authentication. Removed with its uses in PR 3. */
  readonly isAuthDisabled: boolean
}

/** The local user: a user without a licence or an organization. */
export function makeLocalUser(name: string): backendModule.User {
  return {
    userId: backendModule.UserId('user-local'),
    organizationId: backendModule.OrganizationId('organization-00000000000000000000000000'),
    rootDirectoryId: backendModule.DirectoryId('directory-local'),
    name,
    email: backendModule.EmailAddress(LOCAL_SESSION_EMAIL),
    isEnabled: false,
    isOrganizationAdmin: false,
    userGroups: null,
    plan: backendModule.Plan.free,
    groups: [],
    isEnsoTeamMember: false,
  }
}

/** The local user's session. */
export function makeLocalUserSession(session: LocalSession, name: string): UserSession {
  return {
    ...session,
    user: makeLocalUser(name),
    isCloudDataUnavailable: true,
    isAuthDisabled: true,
  }
}

function createAuthStore({ getText } = useText(), { session } = useSession()) {
  const userSession = computed(
    (): UserSession | null => session && makeLocalUserSession(session, getText('offlineUserName')),
  )
  return proxyRefs({
    session: userSession,
    isCloudDataUnavailable: computed((): boolean => true),
    isAuthDisabled: computed((): boolean => true),
    waitForSession: () => Promise.resolve(),
  })
}

export type AuthStore = ReturnType<typeof createAuthStore>
/** A provider of the current user. */
export const useAuth = createGlobalState(createAuthStore)
