<script setup lang="ts">
/**
 * @file The content of the "Invite" dialog (`InviteUsersModal.vue`): the form, then the success
 * step. It is mounted anew each time the dialog opens, so it always starts at the form.
 */
import StepContent from '$/components/Stepper/StepContent.vue'
import Stepper from '$/components/Stepper/Stepper.vue'
import { useStepperState } from '$/components/Stepper/useStepperState'
import { useAuth } from '$/providers/auth'
import type { EmailAddress } from 'enso-common/src/services/Backend'
import { computed, ref } from 'vue'
import InviteUsersForm from './InviteUsersForm.vue'
import InviteUsersSuccess from './InviteUsersSuccess.vue'

const { onClose } = defineProps<{ onClose?: (() => void) | undefined }>()

const auth = useAuth()
const { stepperState, nextStep } = useStepperState({ steps: 2 })
const submittedEmails = ref<readonly EmailAddress[]>([])

function onSubmitted(emails: EmailAddress[]) {
  nextStep()
  submittedEmails.value = emails
}

const invitationLink = computed(() => {
  const organizationId = auth.session?.user.organizationId ?? ''
  // eslint-disable-next-line camelcase
  const params = new URLSearchParams({ organization_id: organizationId }).toString()
  return `enso://auth/registration?${params}`
})
</script>

<template>
  <Stepper :state="stepperState">
    <!-- No step markers, but their (empty) row: the stepper's gap below it sets the form 1rem
    lower in the dialog. -->
    <template #step />
    <StepContent :index="0">
      <InviteUsersForm @submitted="onSubmitted" />
    </StepContent>
    <StepContent :index="1">
      <InviteUsersSuccess
        :invitationLink="invitationLink"
        :emails="submittedEmails"
        :onClose="onClose"
      />
    </StepContent>
  </Stepper>
</template>
