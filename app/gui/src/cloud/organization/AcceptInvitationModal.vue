<script setup lang="ts">
/**
 * @file The dialog for a pending invitation to an organization: the Vue port of the React
 * `#/modals/AcceptInvitationModal`, with the same title, text, alert and buttons.
 *
 * `AppContainerLayout.vue` shows it while the user has an invitation (through the modals
 * `registerCloud` contributes). Accepting joins the organization (`updateUser`) and toasts a
 * welcome, or toasts the failure; declining deletes the invitation. Either way the dialog closes
 * once the request succeeds, and shows the error and stays open if it fails, as React's form did.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import type { Invitation } from 'enso-common/src/services/Backend'
import { ref } from 'vue'

const { invitation } = defineProps<{ invitation: Invitation }>()

const { getText } = useText()
const toasts = useToasts()
const { remoteBackend } = useBackends()

const updateUser = useMutation(
  backendMutationOptions('updateUser', remoteBackend, {
    onSuccess: () => {
      toasts.show(getText('welcomeToTeam', invitation.organizationName), { type: 'success' })
    },
    onError: () => {
      toasts.show(getText('invitationError'), { type: 'error' })
    },
  }),
)
const deleteInvitation = useMutation(
  backendMutationOptions('deleteInvitation', remoteBackend, {
    meta: { invalidates: [['listInvitations']], awaitInvalidates: true },
  }),
)

// Opens as it mounts, as React's `defaultOpen` did.
const open = ref(true)
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="getText('pendingInvitationInfo')"
    :cancel="getText('decline')"
    :confirm="getText('accept')"
    :canSubmitOffline="false"
    :onConfirm="() => updateUser.mutateAsync([{ organizationId: invitation.organizationId }])"
    :onCancel="() => deleteInvitation.mutateAsync([invitation.userEmail])"
  >
    <Text class="relative">{{ getText('invitationText', invitation.organizationName) }}</Text>
    <Alert variant="outline" icon="warning">{{ getText('invitationAlert') }}</Alert>
  </AlertDialog>
</template>
