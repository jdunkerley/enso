/**
 * @file The route of the page shown when running projects in the browser is disabled, registered
 * by `$/cloud` (`registerCloud`) inside the protected layout. Nothing redirects to it any more.
 */
import { DASHBOARD_PATH } from '$/appUtils'
import { PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import type { Router } from 'vue-router'

/** The page's route name. */
export const CLOUD_DISABLED_ROUTE = 'cloudDisabled'

/** Add the page to the router. */
export function registerCloudBrowserDisabledRoute(router: Router) {
  router.addRoute(PROTECTED_LAYOUT_ROUTE, {
    path: '/cloudDisabled',
    name: CLOUD_DISABLED_ROUTE,
    meta: { access: 'anyLoggedIn' },
    component: () => import('./CloudBrowserDisabledPage.vue'),
    props: { redirectPath: DASHBOARD_PATH },
  })
}
