/**
 * @file The local session. There is no sign-in: the app always runs as the one local user
 * (decision 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`).
 */
import { createGlobalState } from '@vueuse/core'

/** The local session: only the local user's email. */
export interface UserSession {
  /** The local user's placeholder email address, {@link LOCAL_SESSION_EMAIL}. */
  readonly email: string
}

export const LOCAL_SESSION_EMAIL = 'local@enso.localhost'

/** The session of the local user. */
export function makeLocalSession(): UserSession {
  return { email: LOCAL_SESSION_EMAIL }
}

/** The current session: always the local one. */
export const useSession = createGlobalState(() => {
  const session: UserSession | null = makeLocalSession()
  return { session, isAuthDisabled: true as boolean }
})
