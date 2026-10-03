/**
 * @file The authentication pages' routes, registered by `$/cloud` (`registerCloud`): sign-in,
 * sign-up and account restoration inside the protected layout, which lets only signed-out users
 * (and, for restoration, users whose account is marked for deletion) reach them; the
 * confirmation and password-reset pages, which emailed links open, outside it.
 */
import {
  CONFIRM_REGISTRATION_PATH,
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  REGISTRATION_PATH,
  RESET_PASSWORD_PATH,
  RESTORE_USER_PATH,
} from '$/appUtils'
import { withDataLoader } from '$/router/dataLoader'
import { PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import type { Router } from 'vue-router'

/** Add the authentication pages to the router. */
export function registerAuthRoutes(router: Router) {
  router.addRoute(PROTECTED_LAYOUT_ROUTE, {
    path: LOGIN_PATH,
    meta: { access: 'guest' },
    component: () => import('./LoginPage.vue'),
  })
  router.addRoute(PROTECTED_LAYOUT_ROUTE, {
    path: REGISTRATION_PATH,
    meta: { access: 'guest' },
    component: withDataLoader(() => import('./RegistrationPage.vue')),
  })
  router.addRoute(PROTECTED_LAYOUT_ROUTE, {
    path: RESTORE_USER_PATH,
    meta: { access: 'deleted' },
    component: () => import('./RestoreAccount.vue'),
  })

  // Visible to signed-out and signed-in users alike.
  router.addRoute({
    path: CONFIRM_REGISTRATION_PATH,
    component: () => import('./ConfirmRegistration.vue'),
  })
  router.addRoute({ path: FORGOT_PASSWORD_PATH, component: () => import('./ForgotPassword.vue') })
  router.addRoute({ path: RESET_PASSWORD_PATH, component: () => import('./ResetPassword.vue') })
}
