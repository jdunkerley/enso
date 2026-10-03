<script setup lang="ts">
/**
 * @file The dialog shown when the trial of a paid plan has ended: the Vue port of the React
 * `#/modals/TrialEndedModal`, with the same title, text, alert and buttons.
 *
 * `AppContainerLayout.vue` shows it for a paid plan whose subscription is paused (through the
 * modals `registerCloud` contributes). "Subscribe" opens a checkout for the Solo plan in a new tab;
 * "Downgrade" cancels the subscription. Either records the downgrade modal as shown, so that
 * `PlanDowngradedModal.vue` does not follow at once.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import { Plan, type SubscriptionId } from 'enso-common/src/services/Backend'
import { ref } from 'vue'
import { useDowngradeModalState } from './downgradeModalState'

const { subscriptionId } = defineProps<{ subscriptionId: SubscriptionId }>()

const { getText } = useText()
const { remoteBackend } = useBackends()
const { markAsShown } = useDowngradeModalState()

const createCheckoutSession = useMutation(
  backendMutationOptions('createCheckoutSession', remoteBackend, {
    onSuccess: ({ url }) => window.open(url, '_blank'),
  }),
)
const cancelSubscription = useMutation(backendMutationOptions('cancelSubscription', remoteBackend))

// Opens as it mounts, as React's `defaultOpen` did.
const open = ref(true)

async function subscribe() {
  markAsShown()
  await createCheckoutSession.mutateAsync([{ price: Plan.solo, quantity: 1, interval: 1 }])
}

async function downgrade() {
  markAsShown()
  await cancelSubscription.mutateAsync([subscriptionId])
}
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="getText('trialEnded')"
    :cancel="getText('downgrade')"
    :confirm="getText('subscribe')"
    :canSubmitOffline="false"
    :onConfirm="subscribe"
    :onCancel="downgrade"
  >
    <Text class="relative">{{ getText('trialEndedExplanation') }}</Text>
    <Alert variant="outline" icon="warning">{{ getText('trialEndedWarning') }}</Alert>
  </AlertDialog>
</template>
