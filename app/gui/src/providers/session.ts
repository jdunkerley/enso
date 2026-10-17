/**
 * @file The local session. There is no sign-in: the app always runs as the one local user
 * (decision 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`).
 */
import { createGlobalState } from '@vueuse/core'
import { Rfc3339DateTime } from 'enso-common/src/utilities/data/dateTime'

/** A session. Its token fields are always empty; only the hybrid open (PR 3) still reads them. */
export interface UserSession {
  /** The local user's placeholder email address, {@link LOCAL_SESSION_EMAIL}. */
  readonly email: string
  /** Always empty: there is no authentication. */
  readonly accessToken: string
  /** Always empty: there is no authentication. */
  readonly refreshToken: string
  /** Always empty: there is no authentication. */
  readonly refreshUrl: string
  /** When the session nominally expires, a year after it was made, in RFC 3339 format (UTC). */
  readonly expireAt: Rfc3339DateTime
  /** Always `local`. */
  readonly clientId: string
}

export const LOCAL_SESSION_EMAIL = 'local@enso.localhost'
const LOCAL_SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

/** The session of the local user. */
export function makeLocalSession(now = Date.now()): UserSession {
  return {
    email: LOCAL_SESSION_EMAIL,
    accessToken: '',
    refreshToken: '',
    refreshUrl: '',
    expireAt: Rfc3339DateTime(new Date(now + LOCAL_SESSION_LIFETIME_MS).toJSON()),
    clientId: 'local',
  }
}

/** The current session: always the local one. */
export const useSession = createGlobalState(() => {
  const session: UserSession | null = makeLocalSession()
  return { session, isAuthDisabled: true as boolean }
})
