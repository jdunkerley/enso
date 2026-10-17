import { useAuth } from '$/providers/auth'
import { loadSettingsContributions } from '$/providers/settingsContributions'
import {
  maybeRedirectToProject,
  maybeRedirectToTab,
  openTab,
  redirectFromPath,
} from '$/router/dashboardGuards'
import { withDataLoader } from '$/router/dataLoader'
import { APP_CONTAINER_LAYOUT_ROUTE, PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import { shouldWaitForResolvedSession } from '$/router/sessionResolution'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const UNAVAILABLE_PATH = '/UNAVAILABLE'

const routes = [
  {
    name: PROTECTED_LAYOUT_ROUTE,
    path: UNAVAILABLE_PATH,
    component: withDataLoader(() => import('$/components/ProtectedLayout.vue')),
    children: [
      {
        name: APP_CONTAINER_LAYOUT_ROUTE,
        path: UNAVAILABLE_PATH,
        meta: { access: 'anyLoggedIn' },
        component: withDataLoader(() => import('$/components/AppContainerLayout.vue')),
        children: [
          {
            name: 'dashboard',
            path: '/',
            beforeEnter: [maybeRedirectToProject, maybeRedirectToTab],
            component: () => import('$/components/DashboardPage.vue'),
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
                // The contributed settings sections load with the page.
                component: () =>
                  Promise.all([import('#/layouts/Settings'), loadSettingsContributions()]).then(
                    ([mod]) => mod.default,
                  ),
              },
              {
                name: 'ensoPath',
                path: 'asset/:path(.*)*',
                beforeEnter: redirectFromPath,
                component: [],
              },
            ],
          },
        ],
      },
    ],
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

router.beforeEach(async (to, from) => {
  const auth = useAuth()

  if (shouldWaitForResolvedSession(to.meta.access, from.meta.access, auth.session)) {
    await auth.waitForSession()
  }
})
router.beforeEach(openTab)

router.onError((error) => console.error('Router error', error))

export default router
