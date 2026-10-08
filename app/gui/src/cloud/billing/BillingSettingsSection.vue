<script setup lang="ts">
/**
 * @file The Billing & Plans settings tab's one entry: "Open Billing Page", which opens the Stripe
 * customer portal in a new window.
 *
 * It asks the backend for a customer portal session (`createCustomerPortalSession`), as a mutation
 * keyed `['billing', 'customerPortalSession']`, and opens the URL it returns with
 * `window.open(url, '_blank')`, which the desktop app hands to the system browser. A failure shows
 * an error toast and is logged. The button loads meanwhile.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { useMutation } from '@tanstack/vue-query'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'

const context = useSettingsContext()
const { getText } = useText()
const toasts = useToasts()

const customerPortalSession = useMutation({
  mutationKey: ['billing', 'customerPortalSession'],
  mutationFn: () =>
    context.value.backend.createCustomerPortalSession().then(
      (url) => {
        if (url != null) {
          window.open(url, '_blank')?.focus()
        }
      },
      (error: unknown) => {
        const message = `${getText('arbitraryErrorTitle')}: ${getMessageOrToString(error)}`
        toasts.show(message, { type: 'error' })
        console.error(message)
        throw error
      },
    ),
})
</script>

<template>
  <ButtonGroup class="grow-0">
    <Button
      size="small"
      variant="outline"
      class="self-start"
      @press="() => customerPortalSession.mutateAsync()"
    >
      {{ getText('openBillingPage') }}
    </Button>
  </ButtonGroup>
</template>
