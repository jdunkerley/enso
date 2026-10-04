/**
 * @file `registerCloud` contributes what #84 moved to the cloud: the agreements gate (a legal gate,
 * which must not silently go missing), the modals over the dashboard, and the page shown when
 * running projects in the browser is disabled; and the developer tools, in development only (#172).
 */
import { registerCloud } from '$/cloud'
import {
  devtools,
  hasAgreementsGate,
  loadAgreementsGate,
  loadAppContainerModals,
  resetLayoutContributions,
} from '$/providers/layoutContributions'
import { resetSettingsContributions } from '$/providers/settingsContributions'
import { CLOUD_DISABLED_ROUTE, PROTECTED_LAYOUT_ROUTE } from '$/router/routeNames'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ name: PROTECTED_LAYOUT_ROUTE, path: '/unavailable', component: {} }],
  })
  registerCloud(router)
  return router
}

beforeEach(() => {
  resetLayoutContributions()
  resetSettingsContributions()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('registerCloud', () => {
  test('contributes the agreements gate', async () => {
    expect(hasAgreementsGate()).toBe(false)
    setup()
    expect(hasAgreementsGate()).toBe(true)
    const gate = await loadAgreementsGate()
    expect(gate.useUserAgreements).toBeTypeOf('function')
    expect((gate.AgreementsModal as { __name?: string }).__name).toBe('AgreementsModal')
  })

  test('contributes the four modals over the dashboard', async () => {
    expect(await loadAppContainerModals()).toBeUndefined()
    resetLayoutContributions()
    setup()
    const modals = await loadAppContainerModals()
    expect(
      Object.fromEntries(
        Object.entries(modals!).map(([key, value]) => [key, (value as { __name?: string }).__name]),
      ),
    ).toEqual({
      SetupOrganizationModal: 'SetupOrganizationModal',
      AcceptInvitationModal: 'AcceptInvitationModal',
      TrialEndedModal: 'TrialEndedModal',
      PlanDowngradedModal: 'PlanDowngradedModal',
    })
  })

  test('adds the cloud-disabled page inside the protected layout, for signed-in users', () => {
    const router = setup()
    expect(router.hasRoute(CLOUD_DISABLED_ROUTE)).toBe(true)
    const route = router.resolve({ name: CLOUD_DISABLED_ROUTE })
    expect(route.path).toBe('/cloudDisabled')
    expect(route.matched.map((record) => record.name)).toEqual([
      PROTECTED_LAYOUT_ROUTE,
      CLOUD_DISABLED_ROUTE,
    ])
    expect(route.meta.access).toBe('anyLoggedIn')
    expect(route.matched[1]!.props).toEqual({ default: { redirectPath: '/' } })
  })

  test('contributes the developer tools in development builds only', async () => {
    setup()
    expect(devtools()).toBeUndefined()
    resetLayoutContributions()
    vi.stubEnv('NODE_ENV', 'development')
    setup()
    expect(devtools()).toBeDefined()
  })
})
