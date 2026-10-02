import { DASHBOARD_PATH, PAYMENTS_SUCCESS_PATH, SUBSCRIBE_PATH } from '$/appUtils'
import { useAuth } from '$/providers/auth'
import { useConfig } from '$/providers/config'
import { flagsStore } from '$/providers/featureFlags'
import {
  maybeRedirectToProject,
  maybeRedirectToTab,
  openTab,
  redirectFromPath,
} from '$/router/dashboardGuards'
import { withDataLoader } from '$/router/dataLoader'
import { PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import { shouldWaitForResolvedSession } from '$/router/sessionResolution'
import { reactComponent, suspendedReactComponent } from '$/utils/react'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const UNAVAILABLE_PATH = '/UNAVAILABLE'

function requireCloudBrowserEnabled() {
  const isCloudExecutionEnabled = flagsStore.getState().featureFlags.enableCloudExecution
  if (!isCloudExecutionEnabled) return { name: 'cloudDisabled' }
}

// The cloud's authentication pages (sign-in, sign-up, password reset, …) are not listed here:
// `registerCloud` (`$/cloud`) adds them, some as children of the protected layout.
const routes = [
  {
    name: PROTECTED_LAYOUT_ROUTE,
    path: UNAVAILABLE_PATH,
    component: withDataLoader(() => import('$/components/ProtectedLayout.vue')),
    children: [
      {
        path: UNAVAILABLE_PATH,
        meta: { access: 'anyLoggedIn' },
        component: withDataLoader(() => import('$/components/AppContainerLayout.vue')),
        beforeEnter: requireCloudBrowserEnabled,
        children: [
          {
            name: 'dashboard',
            path: '/',
            beforeEnter: [maybeRedirectToProject, maybeRedirectToTab],
            component: () =>
              import('#/pages/dashboard/Dashboard.tsx').then((mod) =>
                reactComponent(mod.Dashboard),
              ),
            children: [
              {
                name: 'project',
                path: 'project/:id',
                component: () => import('$/project-view/ProjectView.vue'),
              },
              {
                name: 'projectLog',
                path: 'projectLog/:id/:title',
                component: () => import('$/components/ProjectLog.vue'),
              },
              {
                name: 'settings',
                path: 'settings',
                component: () =>
                  import('#/layouts/Settings').then((mod) => suspendedReactComponent(mod.Settings)),
              },
              {
                name: 'ensoPath',
                path: 'asset/:path(.*)*',
                beforeEnter: redirectFromPath,
                component: [],
              },
            ],
          },
          {
            path: SUBSCRIBE_PATH,
            component: () =>
              import('#/pages/subscribe/Subscribe').then((mod) => reactComponent(mod.Subscribe)),
          },
        ],
      },
      {
        path: '/cloudDisabled',
        name: 'cloudDisabled',
        meta: { access: 'anyLoggedIn' },
        component: () =>
          import('#/layouts/CloudBrowserDisabled').then((mod) =>
            reactComponent(mod.CloudBrowserDisabledPage),
          ),
        props: { redirectPath: DASHBOARD_PATH },
      },
    ],
  },
  {
    path: PAYMENTS_SUCCESS_PATH,
    meta: { access: 'anyLoggedIn' },
    component: () =>
      import('#/pages/PaymentsSuccess').then((mod) => reactComponent(mod.PaymentsSuccess)),
  },
  {
    path: '/:anyPath(.*)*',
    redirect: '/',
  },
] satisfies readonly RouteRecordRaw[]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async () => {
  const config = useConfig()
  // A failed configuration fetch must not block navigation: `useConfig` records the error and
  // the app continues in local-only mode (see `authDisabled` in the authentication service).
  await config.waitForRemoteConfig().catch(() => {})
})
router.beforeEach(async (to, from) => {
  const auth = useAuth()

  if (shouldWaitForResolvedSession(to.meta.access, from.meta.access, auth.session)) {
    await auth.waitForSession()
  }
})
router.beforeEach(openTab)

router.onError((error) => console.error('Router error', error))

export default router
