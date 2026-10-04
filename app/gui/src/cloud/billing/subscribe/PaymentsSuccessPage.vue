<script setup lang="ts">
/**
 * @file The page the app shows while a checkout completes (`/payments/success`): a spinner with a
 * Cancel button. The Vue port of the React `PaymentsSuccess`, with the same steps and timings.
 *
 * It waits for the user's plan to become the one the checkout was for (`pendingCheckout.ts`),
 * re-reading the session every 3 s for up to a minute, under a loading toast. Then it forgets the
 * pending plan, refreshes the organization, says the subscription was upgraded and returns to the
 * dashboard; on a timeout it says so and returns too. Without a pending plan it returns at once.
 * Leaving the page stops the wait.
 *
 * Like the React `Page` around it, it shows the info bar at the top right and mounts the modal host,
 * both loaded on first use.
 */
import { DASHBOARD_PATH } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import Loader from '$/components/Spinner/Loader.vue'
import { useAuth } from '$/providers/auth'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import * as analytics from '$/utils/analytics'
import { useQueryClient } from '@tanstack/vue-query'
import { BackendType, type Plan } from 'enso-common/src/services/Backend'
import { wait } from 'lib0/promise'
import { defineAsyncComponent, onMounted, onScopeDispose } from 'vue'
import { useRouter } from 'vue-router'
import { clearPendingCheckoutTargetPlan, getPendingCheckoutTargetPlan } from '../pendingCheckout'

const USER_REFETCH_DELAY_MS = 3_000
const TIMEOUT = 60_000

/** Loaded on demand, as the React `Page` loads it: its popover pulls in Reka. */
const InfoBar = defineAsyncComponent(() => import('$/components/InfoBar/InfoBar.vue'))
/** Loaded on demand, as the React `Page` loads it: its error boundary pulls in Reka. */
const ModalHost = defineAsyncComponent(() => import('$/components/ModalHost/ModalHost.vue'))

const router = useRouter()
const queryClient = useQueryClient()
const { getText } = useText()
const { refetchSession } = useAuth()
// Global toasts: they must outlive this page, which they leave for the dashboard.
const toasts = useToasts()

let isAborted = false
onScopeDispose(() => {
  isAborted = true
})

/** Wait for the user's subscription plan to update. `null` if the page was left meanwhile. */
async function waitForPlan(plan: Plan) {
  const timeout = Number(new Date()) + TIMEOUT
  while (Number(new Date()) < timeout && !isAborted) {
    const { data } = await refetchSession()
    if (data != null && data.user.plan === plan) {
      return 'success'
    }
    await wait(USER_REFETCH_DELAY_MS)
  }
  return isAborted ? null : 'timeout'
}

async function waitForCheckout(plan: Plan) {
  const loadingToast = toasts.show(getText('payments.pending'), {
    isLoading: true,
    autoClose: false,
    closeOnClick: false,
    closeButton: false,
  })
  try {
    const result = await waitForPlan(plan)
    switch (result) {
      case 'success': {
        clearPendingCheckoutTargetPlan()
        await queryClient.invalidateQueries({ queryKey: [BackendType.remote, 'getOrganization'] })
        toasts.show(getText('payments.success'), { type: 'success' })
        analytics.checkout.after()
        await router.push(DASHBOARD_PATH)
        break
      }
      case 'timeout': {
        clearPendingCheckoutTargetPlan()
        toasts.show(getText('payments.timeout'), { type: 'error' })
        await router.push(DASHBOARD_PATH)
        break
      }
      case null: {
        break
      }
    }
  } catch (error) {
    toasts.show(getText('payments.error'), { type: 'error' })
    console.error(error)
  } finally {
    toasts.dismiss(loadingToast)
  }
}

onMounted(() => {
  const plan = getPendingCheckoutTargetPlan()
  if (plan == null) {
    void router.push(DASHBOARD_PATH)
  } else {
    void waitForCheckout(plan)
  }
})

async function cancel() {
  clearPendingCheckoutTargetPlan()
  await router.push(DASHBOARD_PATH)
}
</script>

<template>
  <Loader class="h-full w-full">
    <Button variant="delete" @press="cancel">{{ getText('cancel') }}</Button>
  </Loader>
  <div class="fixed right top z-1 m-2.5 text-primary">
    <InfoBar />
  </div>
  <ModalHost />
</template>
