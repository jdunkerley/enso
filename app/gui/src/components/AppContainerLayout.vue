<script lang="ts">
import { DAY_MS } from '$/utils/time'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { appContainerModals, loadAppContainerModals } from '$/providers/layoutContributions'
import type { DataLoader } from '$/router'
import { proxyRefs } from '$/utils/reactivity'
import { backendQueryOptions } from '@/composables/backend'
import { useEvent } from '@/composables/events'
import { waitForData } from '@/util/tanstack'
import { useQuery } from '@tanstack/vue-query'
import * as backendModule from 'enso-common/src/services/Backend'
import { Ok } from 'enso-common/src/utilities/data/result'
import { computed, onMounted, onUnmounted } from 'vue'

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

/** Days of asset retention after trial ends. */
const DAYS_BEFORE_DELETE = 90

/**
 * A layout for "main app" router views.
 *
 * TODO[ao]: should be merged with `AppContainer` probably, but first we need to remove
 * the "Dashboard" layer between them.
 */
export const dataLoader: DataLoader<Props> = {
  async beforeRouteEnter() {
    const auth = useAuth()
    const { remoteBackend: backend } = useBackends()

    const { isOrganizationAdmin, plan, invitation } = auth.session?.user ?? {
      isOrganizationAdmin: false,
      plan: backendModule.Plan.free,
    }

    const needsOrganizationSetup = PLANS_TO_SPECIFY_ORG_NAME.includes(plan)
    const cloudDataUnavailable = computed(() => auth.session?.isCloudDataUnavailable ?? false)

    const organizationQuery = useQuery({
      ...backendQueryOptions('getOrganization', [], backend),
      // In degraded-auth mode the backend would reject this with a 5xx/network error;
      // leave the query idle so cloud-dependent modals stay hidden. Reactive so the
      // query auto-fires once `users/me` recovers without re-running the data loader.
      enabled: computed(() => !cloudDataUnavailable.value),
    })
    // The modals come from the cloud (`registerCloud`), loaded before the layout renders.
    await Promise.all([
      cloudDataUnavailable.value ? undefined : waitForData(organizationQuery),
      loadAppContainerModals(),
    ])

    const acceptInvitationModalProps = computed(() => (invitation ? { invitation } : undefined))

    const trialEndedModalProps = computed<TrialEndedModalProps | undefined>(() => {
      if (plan == backendModule.Plan.free) return undefined

      const subscription = organizationQuery.data.value?.subscription
      if (subscription?.isPaused && subscription.id != null) {
        return { subscriptionId: subscription.id }
      }
      return undefined
    })

    const planDowngradedModalProps = computed<PlanDowngradedModalProps | undefined>(() => {
      if (plan != backendModule.Plan.free) return undefined
      const subscription = organizationQuery.data.value?.subscription
      if (subscription?.isPaused && subscription.id != null && subscription.trialEnd != null) {
        return {
          deletionDeadlineTimestamp:
            Number(new Date(subscription.trialEnd)) + DAYS_BEFORE_DELETE * DAY_MS,
        }
      }
      return undefined
    })

    const shouldSetupOrganization = computed(
      () => isOrganizationAdmin && needsOrganizationSetup && !organizationQuery.data.value?.name,
    )

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

const { remoteBackend } = useBackends()
const logUserOpen = () => remoteBackend.logEvent('open_app')
const logUserClose = () => remoteBackend.logEvent('close_app')
onMounted(logUserOpen)
onUnmounted(logUserClose)
useEvent(window, 'beforeunload', logUserClose)
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
