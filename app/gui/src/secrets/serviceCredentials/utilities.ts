/** @file Hooks for credentials dialogs. */
import type { Opt } from '@/util/data/opt'
import type * as backend from 'enso-common/src/services/Backend'
import { HttpsUrl } from 'enso-common/src/services/Backend/types'
import invariant from 'tiny-invariant'

/** Relative HTTP path to the OAuth callback endpoint for the given service. */
function getOauthCallbackPath(service: backend.CredentialInput['type']) {
  const normalized = service.toLowerCase()
  return HttpsUrl(`oauth/${normalized}/callback`)
}

/**
 * Returns the redirect URI for the given service.
 */
export function getOauthRedirectUri(
  apiUrl: Opt<string>,
  service: backend.CredentialInput['type'],
): string {
  invariant(apiUrl != null, 'The API_URL must be defined')

  const path = getOauthCallbackPath(service)
  const separator = apiUrl.endsWith('/') ? '' : '/'
  return apiUrl + separator + path
}
