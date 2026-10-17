/**
 * @file Provides an {@link AuthService} which consists of an underyling `Cognito` API
 * wrapper, along with some convenience callbacks to make URL redirects for the authentication flows
 * work with Electron.
 */
import * as appUtils from '$/appUtils'
import { Cognito } from '$/authentication/cognito'
import * as listen from '$/authentication/listen'
import { parseEnsoDeeplink } from '@/util/url'
import { Amplify } from 'aws-amplify'
import type * as saveAccessTokenModule from 'enso-common/src/accessToken'
import * as detect from 'enso-common/src/utilities/detect'
import { computed, shallowRef, type Ref } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Configuration for the AWS Amplify library.
 *
 * This details user pools, federated identity providers, etc. that are used to authenticate users.
 * The values in this object are not secret, and can be swapped out for testing values to avoid
 * creating authenticated users in the production environment.
 */
export interface AmplifyConfig {
  readonly region: string
  readonly endpoint: string | undefined
  readonly userPoolId: string
  readonly userPoolWebClientId: string
  readonly urlOpener: ((url: string) => void) | null
  readonly saveAccessToken: ((accessToken: saveAccessTokenModule.AccessToken | null) => void) | null
  readonly domain: string
  readonly scope: string[]
  readonly redirectsSignIn: string[]
  readonly redirectsSignOut: string[]
  readonly responseType: 'code' | 'token'
}

/** Configuration options for a {@link OauthAmplifyConfig}. */
interface OauthAmplifyConfigOptions {
  readonly urlOpener?: (url: string, redirectUrl: string) => void
}

/** OAuth configuration for a {@link NestedAmplifyConfig}. */
interface OauthAmplifyConfig {
  readonly options: OauthAmplifyConfigOptions
  readonly domain: string
  readonly scope: string[]
  readonly redirectSignIn: string
  readonly redirectSignOut: string
  readonly responseType: string
}

/** Same as {@link AmplifyConfig}, but in a format recognized by the AWS Amplify library. */
export interface NestedAmplifyConfig {
  readonly region: string
  readonly endpoint: string | undefined
  readonly userPoolId: string
  readonly userPoolClientId: string
  readonly oauth: OauthAmplifyConfig
}

/**
 * Convert the flattened `AmplifyConfig` struct to a form recognizable to the AWS Amplify library.
 *
 * We use a flattened form of the config for easier object manipulation, but the AWS Amplify library
 * expects a nested form.
 */
export function toNestedAmplifyConfig(
  config: AmplifyConfig,
): Parameters<typeof Amplify.configure>[0] {
  return {
    Auth: {
      Cognito: {
        // TODO: Use the endpoint when it is working.
        // userPoolEndpointndpoint: config.endpoint,
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolWebClientId,
        loginWith: {
          username: true,
          oauth: {
            domain: config.domain,
            scopes: config.scope,
            redirectSignIn: config.redirectsSignIn,
            redirectSignOut: config.redirectsSignOut,
            responseType: config.responseType,
          },
        },
      },
    },
  }
}

/** Configuration for the authentication service. */
export interface AuthConfig {
  /**
   * Whether the application supports deep links. This is only true when using
   * the installed app on macOS and Windows.
   */
  readonly supportsDeepLinks: boolean
}

/** API for the authentication service. */
export interface AuthService {
  /** @see {@link Cognito}. */
  readonly cognito: Ref<Cognito | undefined>
  /** Always `true`: the IDE is local-only. */
  readonly authDisabled: Ref<boolean>
  /** @see {@link listen.ListenFunction}. */
  readonly registerAuthEventListener: listen.ListenFunction
}

/**
 * Create an instance of the authentication service.
 *
 * # Warning
 *
 * This hook should only be called in a single place, as it performs global configuration of the
 * Amplify library.
 */
export function useInitAuthService(): AuthService {
  const router = useRouter()
  // The IDE is local-only (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`): there
  // is no Cognito, so authentication is disabled and the session is always the offline stand-in
  // (`makeOfflineSession` in `$/providers/session`). PR 2 deletes this module.
  const cognito = shallowRef<Cognito | undefined>(undefined)
  const authDisabled = computed(() => true)
  if (detect.isOnElectron()) {
    setDeepLinkHandler((url) => void router.push(url), cognito)
  }
  return { cognito, authDisabled, registerAuthEventListener: listen.registerAuthEventListener }
}

/**
 * Set the callback that will be invoked when a deep link to the application is opened.
 *
 * Typically this callback is invoked when the user is redirected back to the app after:
 *
 * 1. Authenticating with a federated identity provider; or
 * 2. Clicking a "reset password" link in a password reset email.
 *
 * For example, when the user completes an OAuth sign in flow (e.g., through Google), they are
 * redirected to a URL like `enso://authentication/register?code=...`. This listener will intercept
 * that URL and open the page `register?code=...` in the application window.
 *
 * This is only used when running on the desktop, as the browser version of the app lets Amplify
 * handle the redirect for us. On the desktop however, we need to handle the redirect ourselves,
 * because it's a deep link into the app, and Amplify doesn't handle deep links.
 *
 * All URLs that don't have a pathname that starts with `AUTHENTICATION_PATHNAME_BASE` will be
 * ignored by this handler.
 */
function setDeepLinkHandler(navigate: (url: string) => void, cognito: Ref<Cognito | undefined>) {
  window.api?.authentication.setDeepLinkHandler((urlString: string) => {
    const result = parseEnsoDeeplink(urlString)
    if (!result.ok) {
      console.error(result.error.message())
      return
    }
    const deeplink = result.value
    switch (deeplink.pathname) {
      // If the user is being redirected after clicking the registration confirmation link in their
      // email, then the URL will be for the confirmation page path.
      case 'auth/confirmation': {
        const verificationCode = deeplink.searchParams.get('verification_code')

        let redirectUrl: string

        // In case if the verifaction code is present, then we need to navigate to the confirmation
        // page, because the URL is a deep link for confirmation page and user is not yet confirmed.
        if (verificationCode != null) {
          redirectUrl = `${appUtils.CONFIRM_REGISTRATION_PATH}${deeplink.search}`
        } else {
          // Otherwise, we need to navigate to the setup page, because user is already confirmed.
          // but the redirect link navigates to the confirmation page, for some reason.
          redirectUrl = `${appUtils.DASHBOARD_PATH}${deeplink.search}`
        }
        navigate(redirectUrl)

        break
      }
      case 'auth': {
        if (deeplink.search === '') {
          // Signing out.
          navigate(appUtils.LOGIN_PATH)
        } else {
          // Signing in.
          cognito.value?.resolveOngoingLogin({ type: 'success', url: urlString })
          break
        }
        break
      }
      // If the user is being redirected after finishing the password reset flow, then the URL will
      // be for the login page.
      case 'auth/login': {
        navigate(appUtils.LOGIN_PATH)
        break
      }
      case 'auth/registration': {
        navigate(`${appUtils.REGISTRATION_PATH}${deeplink.search}`)
        break
      }
      case 'payments/success': {
        navigate(`${appUtils.PAYMENTS_SUCCESS_PATH}${deeplink.search}`)
        break
      }
      // If the user is being redirected from a password reset email, navigate to the password
      // reset page, with the verification code and email prefilled.
      case 'password-reset': {
        navigate(`${appUtils.RESET_PASSWORD_PATH}${deeplink.search}`)
        break
      }
      default: {
        navigate(`/${deeplink.pathname}`)
        break
      }
    }
  })
}
