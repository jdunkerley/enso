/** @file Names of the routes that other modules add child routes to (`router.addRoute`). */

/**
 * The protected layout (`ProtectedLayout.vue`), which checks each child's `meta.access` against
 * the session. The cloud's authentication pages are added under it (`$/cloud/auth/routes`).
 */
export const PROTECTED_LAYOUT_ROUTE = 'protectedLayout'

/**
 * The page shown when running projects in the browser is disabled, added by the cloud
 * (`$/cloud/browserDisabled/routes`). The dashboard's route redirects to it while the
 * `enableCloudExecution` feature flag is off, when it exists.
 */
export const CLOUD_DISABLED_ROUTE = 'cloudDisabled'
