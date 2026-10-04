/**
 * @file The cloud-only part of the app: its one entry point. The app's entry (`entrypoint.ts`)
 * calls {@link registerCloud} before the router starts; nothing else outside `src/cloud/` imports
 * a cloud-only area (an ESLint rule enforces it), so that a community build can drop this folder
 * and that one call. See decision 6b in
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 */
import { contributeAppContainerModals } from '$/providers/layoutContributions'
import type { Router } from 'vue-router'
import { registerAccountSettings } from './account/settings'
import { registerAgreementsGate } from './agreements/agreements'
import { registerAuthRoutes } from './auth/routes'
import { registerBillingRoutes } from './billing/routes'
import { registerBillingSettings } from './billing/settings'
import { registerCloudBrowserDisabledRoute } from './browserDisabled/routes'
import { registerDevtools } from './devtools/devtools'
import { registerOrganizationSettings } from './organization/settings'
import { registerPropertiesTab } from './properties/rightPanel'
import { registerVersionsTabs } from './versions/rightPanel'

/** Contribute the cloud-only areas to the app. Call it before the router's first navigation. */
export function registerCloud(router: Router) {
  registerAuthRoutes(router)
  registerAccountSettings()
  registerOrganizationSettings()
  registerBillingSettings()
  registerBillingRoutes(router)
  registerCloudBrowserDisabledRoute(router)
  registerAgreementsGate()
  contributeAppContainerModals(loadAppContainerModals)
  registerPropertiesTab()
  registerVersionsTabs()
  // Spelled out rather than `IS_DEV_MODE`, so that the production build replaces it with `false`
  // in this very module and drops the devtools (and their chunks) entirely.
  if (process.env.NODE_ENV === 'development') registerDevtools()
}

/**
 * The modals over the dashboard (organization setup and invitations, the end of a trial and a
 * downgrade), loaded with its layout.
 */
async function loadAppContainerModals() {
  const [setupOrganization, acceptInvitation, trialEnded, planDowngraded] = await Promise.all([
    import('./organization/SetupOrganizationModal.vue'),
    import('./organization/AcceptInvitationModal.vue'),
    import('./billing/TrialEndedModal.vue'),
    import('./billing/PlanDowngradedModal.vue'),
  ])
  return {
    SetupOrganizationModal: setupOrganization.default,
    AcceptInvitationModal: acceptInvitation.default,
    TrialEndedModal: trialEnded.default,
    PlanDowngradedModal: planDowngraded.default,
  }
}
