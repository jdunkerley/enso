/**
 * @file The billing pages' routes, registered by `$/cloud` (`registerCloud`): the subscription page
 * inside the main app's layout, beside the dashboard, and the payments success page, which the
 * checkout and the desktop app's deep link (`authentication/service.ts`) open, on its own. Where
 * the React routes were, with the same paths and access.
 */
import { PAYMENTS_SUCCESS_PATH, SUBSCRIBE_PATH } from '$/appUtils'
import { APP_CONTAINER_LAYOUT_ROUTE } from '$/router/routeNames'
import type { Router } from 'vue-router'

/** Add the billing pages to the router. */
export function registerBillingRoutes(router: Router) {
  router.addRoute(APP_CONTAINER_LAYOUT_ROUTE, {
    path: SUBSCRIBE_PATH,
    component: () => import('./subscribe/SubscribePage.vue'),
  })
  router.addRoute({
    path: PAYMENTS_SUCCESS_PATH,
    meta: { access: 'anyLoggedIn' },
    component: () => import('./subscribe/PaymentsSuccessPage.vue'),
  })
}
