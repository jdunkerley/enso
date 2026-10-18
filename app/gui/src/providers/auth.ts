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
}

/** The local user. */
export function makeLocalUser(name: string): backendModule.User {
  return {
    userId: backendModule.UserId('user-local'),
    name,
    email: backendModule.EmailAddress(LOCAL_SESSION_EMAIL),
  }
}

/** The local user's session. */
export function makeLocalUserSession(session: LocalSession, name: string): UserSession {
  return { ...session, user: makeLocalUser(name) }
}

function createAuthStore({ getText } = useText(), { session } = useSession()) {
  const userSession = computed((): UserSession =>
    makeLocalUserSession(session, getText('offlineUserName')),
  )
  return proxyRefs({
    session: userSession,
    waitForSession: () => Promise.resolve(),
  })
}

export type AuthStore = ReturnType<typeof createAuthStore>
/** A provider of the current user. */
export const useAuth = createGlobalState(createAuthStore)
