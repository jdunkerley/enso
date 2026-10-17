/**
 * @file What other parts of the app add to the layouts: the contribution point through which other
 * parts of the app give `AppContainerLayout.vue` its modals, without the core importing them
 * (decision 6b of `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 *
 * The layout keeps deciding *when* each one shows; a contribution supplies *what* shows. It is a
 * loader, so that its components stay out of the initial chunk: the layout's data loader awaits it
 * before the layout renders, so a modal never appears late. Nothing contributed means nothing
 * shown.
 */
import { markRaw, shallowRef, type Component } from 'vue'

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

let appContainerModalsLoader: Loader<AppContainerModals> | undefined
let appContainerModalsPromise: Promise<AppContainerModals | undefined> | undefined
const loadedAppContainerModals = shallowRef<AppContainerModals>()

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

/** Forget every contribution. For tests. */
export function resetLayoutContributions() {
  appContainerModalsLoader = undefined
  appContainerModalsPromise = undefined
  loadedAppContainerModals.value = undefined
}
