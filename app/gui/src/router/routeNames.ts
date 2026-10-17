/** @file Names of the routes that other modules add child routes to (`router.addRoute`). */

/**
 * The protected layout (`ProtectedLayout.vue`), which checks each child's `meta.access` against
 * the session.
 */
export const PROTECTED_LAYOUT_ROUTE = 'protectedLayout'

/**
 * The layout of the main app's pages (`AppContainerLayout.vue`), under the protected layout: the
 * dashboard.
 */
export const APP_CONTAINER_LAYOUT_ROUTE = 'appContainerLayout'
