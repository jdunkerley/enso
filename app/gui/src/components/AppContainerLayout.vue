<script lang="ts">
import { useAuth } from '$/providers/auth'
import { appContainerModals, loadAppContainerModals } from '$/providers/layoutContributions'
import type { DataLoader } from '$/router'
import { proxyRefs } from '$/utils/reactivity'
import * as backendModule from 'enso-common/src/services/Backend'
import { Ok } from 'enso-common/src/utilities/data/result'
import { computed } from 'vue'

const PLANS_TO_SPECIFY_ORG_NAME = [backendModule.Plan.team, backendModule.Plan.enterprise]

/** The props of the contributed modals (`AppContainerModals`); this layout decides when they show. */
interface TrialEndedModalProps {
  readonly subscriptionId: backendModule.SubscriptionId
}
interface PlanDowngradedModalProps {
  readonly deletionDeadlineTimestamp: number
}
interface AcceptInvitationModalProps {
  readonly invitation: backendModule.Invitation
}

type Props = {
  shouldSetupOrganization: boolean
  trialEndedModalProps: TrialEndedModalProps | undefined
  planDowngradedModalProps: PlanDowngradedModalProps | undefined
  acceptInvitationModalProps: AcceptInvitationModalProps | undefined
}

/**
 * A layout for "main app" router views.
 *
 * TODO[ao]: should be merged with `AppContainer` probably, but first we need to remove
 * the "Dashboard" layer between them.
 */
export const dataLoader: DataLoader<Props> = {
  async beforeRouteEnter() {
    const auth = useAuth()
    const { isOrganizationAdmin, plan, invitation } = auth.session.user
    const needsOrganizationSetup = PLANS_TO_SPECIFY_ORG_NAME.includes(plan)

    // The modals are contributed (`$/providers/layoutContributions`), loaded before the layout renders.
    await loadAppContainerModals()

    const acceptInvitationModalProps = computed(() => (invitation ? { invitation } : undefined))
    // There is no organization to have a subscription, so no trial ends and no plan is downgraded.
    const trialEndedModalProps = computed((): TrialEndedModalProps | undefined => undefined)
    const planDowngradedModalProps = computed((): PlanDowngradedModalProps | undefined => undefined)
    // With no organization to read, its name is never known.
    const shouldSetupOrganization = computed(() => isOrganizationAdmin && needsOrganizationSetup)

    return Ok(
      proxyRefs({
        shouldSetupOrganization,
        trialEndedModalProps,
        planDowngradedModalProps,
        acceptInvitationModalProps,
      }),
    )
  },
}
</script>

<script setup lang="ts">
defineProps<Props>()

const modals = computed(appContainerModals)
</script>

<template>
  <template v-if="modals">
    <component :is="modals.SetupOrganizationModal" v-if="shouldSetupOrganization" />
    <component
      :is="modals.TrialEndedModal"
      v-if="trialEndedModalProps"
      v-bind="trialEndedModalProps"
    />
    <component
      :is="modals.PlanDowngradedModal"
      v-if="planDowngradedModalProps"
      v-bind="planDowngradedModalProps"
    />
    <component
      :is="modals.AcceptInvitationModal"
      v-if="acceptInvitationModalProps"
      v-bind="acceptInvitationModalProps"
    />
  </template>
  <RouterView />
</template>
