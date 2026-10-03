<script setup lang="ts">
/**
 * @file The invitation dialog's form: email addresses, separated by spaces, commas or semicolons,
 * and "Send invites". The Vue port of the React `InviteUsersForm`.
 *
 * The addresses must all be valid, and no more than the seats left on the plan; either failure
 * reads "Email is invalid", as in React. On a plan whose invitations are limited, an alert gives
 * the seats left, with an upgrade button. It emits `submitted` with the addresses once every
 * invitation has been sent.
 *
 * React also tried to colour the invalid addresses red with the CSS Custom Highlight API. That
 * cannot reach the text of an `<input>`, and its ranges were set on the field's label, where the
 * offsets threw; it is not ported.
 */
import PaywallAlert from '$/cloud/billing/paywall/PaywallAlert.vue'
import { parseUserEmails } from '$/cloud/parseUserEmails'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { EmailAddress } from 'enso-common/src/services/Backend'
import isEmail from 'validator/es/lib/isEmail'
import { computed } from 'vue'
import { z } from 'zod'
import { listInvitationsQueryOptions } from './queries'

const emit = defineEmits<{ submitted: [emails: EmailAddress[]] }>()

const { getText } = useText()
const { remoteBackend } = useBackends()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()

const inviteUserMutation = useMutation(backendMutationOptions('inviteUser', remoteBackend))

// Fetched afresh whenever the dialog opens, as React's own query was.
const invitations = useQuery(listInvitationsQueryOptions(remoteBackend, 0))
await invitations.suspense()

const seatsLeft = computed(() => invitations.data.value?.availableLicenses ?? 0)
const isUnderPaywall = computed(() => isFeatureUnderPaywall('inviteUserFull'))

/** Whether the addresses are all valid, and fit in the seats left. */
function isValid(value: string) {
  const { entries } = parseUserEmails(value)
  return entries.length <= seatsLeft.value && entries.every((entry) => isEmail(entry.email))
}

const schema = z.object({
  emails: z
    .string()
    .min(1, { message: getText('emailIsRequired') })
    .refine(isValid, { message: getText('emailIsInvalid') }),
})

async function submit({ emails }: z.output<typeof schema>) {
  // Each address once. React meant to do this too, but put the parsed entries (objects) in its
  // `Set`, so an address typed twice was invited twice.
  const emailsToSubmit = Array.from(
    new Set(parseUserEmails(emails).entries.map(({ email }) => email)),
  ).filter((value): value is EmailAddress => isEmail(value))
  await Promise.all(
    emailsToSubmit.map((userEmail) => inviteUserMutation.mutateAsync([{ userEmail }])),
  )
  emit('submitted', emailsToSubmit)
}
</script>

<template>
  <Form :schema="schema" :defaultValues="{ emails: '' }" @submit="submit">
    <Input
      name="emails"
      :label="getText('inviteEmailFieldLabel')"
      :placeholder="getText('inviteEmailFieldPlaceholder')"
      :description="getText('inviteEmailFieldDescription')"
    />
    <PaywallAlert
      v-if="isUnderPaywall"
      feature="inviteUserFull"
      :label="getText('inviteFormSeatsLeft', seatsLeft)"
    />
    <Submit variant="accent" size="medium" fullWidth :isDisabled="seatsLeft <= 0 || undefined">
      {{ getText('inviteSubmit') }}
    </Submit>
    <FormError />
  </Form>
</template>
