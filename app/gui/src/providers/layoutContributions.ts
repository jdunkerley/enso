/**
 * @file What other parts of the app add to the layouts: the contribution point through which the
 * cloud-only areas (`src/cloud/`) give `ProtectedLayout.vue` its agreements gate (and, in
 * development builds, the developer tools) and `AppContainerLayout.vue` its modals, without the
 * core importing them (decision 6b of
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 *
 * The layouts keep deciding *when* each one shows, as before; a contribution supplies *what*
 * shows. Each is a loader, so that its components stay out of the initial chunk: a layout's data
 * loader awaits it before the layout renders, so a modal never appears late. Nothing contributed
 * means nothing shown: a build without the cloud has no agreements to accept and no organization to
 * set up.
 */
import type { QueryClient } from '@tanstack/vue-query'
import {
  defineAsyncComponent,
  markRaw,
  shallowRef,
  type AsyncComponentLoader,
  type Component,
} from 'vue'

/** The user's agreement to the current Terms of Service and Privacy Policy. Reactive. */
export interface UserAgreements {
  readonly agreedToTos: boolean
  readonly agreedToPrivacyPolicy: boolean
  /** Record that the user agreed to both current documents. */
  readonly userAgreed: () => void
}

/** The protected layout's gate: the user must accept the current agreements before going on. */
export interface AgreementsGate {
  /**
   * Read the user's agreements. Called in the effect scope the layout stops when the gate no
   * longer applies; it may keep the result up to date in that scope.
   */
  readonly useUserAgreements: (queryClient: QueryClient) => Promise<UserAgreements>
  /** Shown in place of the page until both are agreed, with the {@link UserAgreements} as props. */
  readonly AgreementsModal: Component
}

/** The modals `AppContainerLayout.vue` shows over the dashboard; it decides when, and their props. */
export interface AppContainerModals {
  /** Asks a team or enterprise admin to name their organization. No props. */
  readonly SetupOrganizationModal: Component
  /** The trial of a paid plan has ended. Props: `subscriptionId`. */
  readonly TrialEndedModal: Component
  /** A free plan's paused subscription: assets will be deleted. Props: `deletionDeadlineTimestamp`. */
  readonly PlanDowngradedModal: Component
  /** The user has a pending invitation to an organization. Props: `invitation`. */
  readonly AcceptInvitationModal: Component
}

type Loader<T> = () => Promise<T>

let agreementsGateLoader: Loader<AgreementsGate> | undefined
let agreementsGatePromise: Promise<AgreementsGate> | undefined
let appContainerModalsLoader: Loader<AppContainerModals> | undefined
let appContainerModalsPromise: Promise<AppContainerModals | undefined> | undefined
const loadedAgreementsModal = shallowRef<Component>()
const loadedAppContainerModals = shallowRef<AppContainerModals>()
const loadedDevtools = shallowRef<Component>()

/** Give the protected layout its agreements gate. Call it before the router starts. */
export function contributeAgreementsGate(load: Loader<AgreementsGate>) {
  agreementsGateLoader = load
  agreementsGatePromise = undefined
}

/** Whether an agreements gate was contributed; without one, nothing is asked of the user. */
export function hasAgreementsGate() {
  return agreementsGateLoader != null
}

/** Load the contributed agreements gate, once. Call it only when {@link hasAgreementsGate}. */
export function loadAgreementsGate(): Promise<AgreementsGate> {
  if (agreementsGateLoader == null) {
    return Promise.reject(new Error('No agreements gate was contributed.'))
  }
  agreementsGatePromise ??= agreementsGateLoader().then(
    (gate) => {
      const AgreementsModal = markRaw(gate.AgreementsModal)
      loadedAgreementsModal.value = AgreementsModal
      return { ...gate, AgreementsModal }
    },
    (error: unknown) => {
      // Not cached: the next navigation tries again, and until then the gate stays closed.
      agreementsGatePromise = undefined
      throw error
    },
  )
  return agreementsGatePromise
}

/** The contributed agreements modal, once loaded. Reactive. */
export function agreementsModal(): Component | undefined {
  return loadedAgreementsModal.value
}

/** Give the app container's layout its modals. Call it before the router starts. */
export function contributeAppContainerModals(load: Loader<AppContainerModals>) {
  appContainerModalsLoader = load
  appContainerModalsPromise = undefined
}

/** Load the contributed modals, once; `undefined` when none were contributed. */
export function loadAppContainerModals(): Promise<AppContainerModals | undefined> {
  appContainerModalsPromise ??=
    appContainerModalsLoader == null ?
      Promise.resolve(undefined)
    : appContainerModalsLoader().then(
        (modals) => {
          const raw: AppContainerModals = {
            SetupOrganizationModal: markRaw(modals.SetupOrganizationModal),
            TrialEndedModal: markRaw(modals.TrialEndedModal),
            PlanDowngradedModal: markRaw(modals.PlanDowngradedModal),
            AcceptInvitationModal: markRaw(modals.AcceptInvitationModal),
          }
          loadedAppContainerModals.value = raw
          return raw
        },
        (error: unknown) => {
          // Not cached: the next navigation tries again.
          appContainerModalsPromise = undefined
          throw error
        },
      )
  return appContainerModalsPromise
}

/** The contributed modals, once loaded. Reactive. */
export function appContainerModals(): AppContainerModals | undefined {
  return loadedAppContainerModals.value
}

/**
 * Give the protected layout its developer tools (#172), shown over every page while signed in.
 * `registerCloud` contributes them in development builds only, so that a production build has none.
 */
export function contributeDevtools(load: AsyncComponentLoader) {
  loadedDevtools.value = markRaw(defineAsyncComponent(load))
}

/** The contributed developer tools, loaded on first render; `undefined` when none were contributed. */
export function devtools(): Component | undefined {
  return loadedDevtools.value
}

/** Forget every contribution. For tests. */
export function resetLayoutContributions() {
  loadedDevtools.value = undefined
  agreementsGateLoader = undefined
  agreementsGatePromise = undefined
  loadedAgreementsModal.value = undefined
  appContainerModalsLoader = undefined
  appContainerModalsPromise = undefined
  loadedAppContainerModals.value = undefined
}
