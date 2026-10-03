/**
 * @file The route of the page shown when running projects in the browser is disabled, registered
 * by `$/cloud` (`registerCloud`) inside the protected layout. The dashboard's route redirects to it
 * by name (`CLOUD_DISABLED_ROUTE`) while the `enableCloudExecution` feature flag is off.
 */
import { DASHBOARD_PATH } from '$/appUtils'
import { CLOUD_DISABLED_ROUTE, PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import type { Router } from 'vue-router'

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
