<script setup lang="ts">
/**
 * @file The Members settings tab: the organization's members and pending invitations, with (for an
 * admin) "Invite Members", the seats left on the plan, and per row the actions to remove a member,
 * or to copy, resend or remove an invitation.
 */
import PaywallDialogButton from '$/cloud/billing/paywall/PaywallDialogButton.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import CopyButton from '$/components/Button/CopyButton.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import Text from '$/components/Text/Text.vue'
import { getFeatureConfiguration, useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { EmailAddress, Invitation, User } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import InviteUsersModal from './InviteUsersModal.vue'
import { listInvitationsQueryOptions, listUsersQueryOptions } from './queries'

const { getText } = useText()
const { remoteBackend } = useBackends()
const context = useSettingsContext()
const modals = useModals()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()

const membersQuery = useQuery(listUsersQueryOptions(remoteBackend))
const invitationsQuery = useQuery(listInvitationsQueryOptions(remoteBackend))
await Promise.all([membersQuery.suspense(), invitationsQuery.suspense()])

const members = computed(() => membersQuery.data.value ?? [])
const invitations = computed(() => invitationsQuery.data.value)

const user = computed(() => context.value.user)
const isAdmin = computed(() => user.value.isOrganizationAdmin)
const isUnderPaywall = computed(() => isFeatureUnderPaywall('inviteUserFull'))
const seatsLeft = computed(() =>
  isUnderPaywall.value ? (invitations.value?.availableLicenses ?? null) : null,
)
const seatsTotal = computed(() =>
  isUnderPaywall.value ?
    (invitations.value?.maxLicenses ?? 0)
  : getFeatureConfiguration('inviteUser').meta.maxSeats,
)

const removeUser = useMutation(backendMutationOptions('removeUser', remoteBackend))
const resendInvitation = useMutation(backendMutationOptions('resendInvitation', remoteBackend))
const deleteInvitation = useMutation(backendMutationOptions('deleteInvitation', remoteBackend))

function confirmRemoveMember(member: User) {
  void modals.ask(ConfirmDeleteModal, {
    cannotUndo: true,
    actionText: getText('deleteUserConfirmation', member.name, member.email),
    alert: getText('deleteUserAlert'),
    actionButtonLabel: getText('remove'),
    onConfirm: async () => {
      await removeUser.mutateAsync([member.userId])
    },
  })
}

/** Whether the invitation to this address is being resent. */
function isResending(email: EmailAddress) {
  return resendInvitation.isPending.value && resendInvitation.variables.value?.[0] === email
}

/** The link that signs up into the organization. */
function invitationLink(invitation: Invitation) {
  // eslint-disable-next-line camelcase
  const params = new URLSearchParams({ organization_id: invitation.organizationId }).toString()
  return `enso://auth/registration?=${params}`
}
</script>

<template>
  <ButtonGroup v-if="isAdmin" class="flex-initial" verticalAlign="center">
    <InviteUsersModal>
      <template #trigger>
        <Button variant="outline" rounded="full" size="medium">
          {{ getText('inviteMembers') }}
        </Button>
      </template>
    </InviteUsersModal>
    <div v-if="seatsLeft != null" class="flex items-center gap-1">
      <Text>
        {{ seatsLeft <= 0 ? getText('noSeatsLeft') : getText('seatsLeft', seatsLeft, seatsTotal) }}
      </Text>
      <PaywallDialogButton feature="inviteUserFull" variant="link" :showIcon="false" />
    </div>
  </ButtonGroup>

  <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="top-8">
    <table class="table-fixed self-start rounded-rows">
      <thead class="sticky top-0 z-1 bg-dashboard">
        <tr class="h-row">
          <th
            class="min-w-48 max-w-80 border-x-2 border-transparent bg-clip-padding px-cell-x text-left text-sm font-semibold last:border-r-0"
          >
            {{ getText('name') }}
          </th>
          <th
            class="w-48 border-x-2 border-transparent bg-clip-padding px-cell-x text-left text-sm font-semibold last:border-r-0"
          >
            {{ getText('status') }}
          </th>
        </tr>
      </thead>
      <tbody class="select-text">
        <tr v-for="member in members" :key="member.userId" class="group h-row rounded-rows-child">
          <td
            class="min-w-48 max-w-80 border-x-2 border-transparent bg-clip-padding px-4 py-1 first:rounded-l-full last:rounded-r-full last:border-r-0"
          >
            <Text truncate="1" class="block">{{ member.email }}</Text>
            <Text truncate="1" class="block text-2xs text-primary/40">{{ member.name }}</Text>
          </td>
          <td
            class="border-x-2 border-transparent bg-clip-padding px-cell-x first:rounded-l-full last:rounded-r-full last:border-r-0"
          >
            <div class="flex flex-col">
              {{ getText('active') }}
              <ButtonGroup v-if="member.email !== user.email && isAdmin" gap="small" class="mt-0.5">
                <Button variant="icon" size="custom" @press="confirmRemoveMember(member)">
                  {{ getText('remove') }}
                </Button>
              </ButtonGroup>
            </div>
          </td>
        </tr>
        <tr
          v-for="invitation in invitations?.invitations ?? []"
          :key="invitation.userEmail"
          class="group h-row rounded-rows-child"
        >
          <td
            class="border-x-2 border-transparent bg-clip-padding px-4 py-1 first:rounded-l-full last:rounded-r-full last:border-r-0"
          >
            <span class="block text-sm">{{ invitation.userEmail }}</span>
          </td>
          <td
            class="border-x-2 border-transparent bg-clip-padding px-cell-x first:rounded-l-full last:rounded-r-full last:border-r-0"
          >
            <div class="flex flex-col">
              {{ getText('pendingInvitation') }}
              <ButtonGroup v-if="isAdmin" gap="small" class="mt-0.5">
                <CopyButton
                  size="custom"
                  :copyText="invitationLink(invitation)"
                  :aria-label="getText('copyInviteLink')"
                  :copyIcon="null"
                >
                  {{ getText('copyInviteLink') }}
                </CopyButton>
                <Button
                  variant="icon"
                  size="custom"
                  :isLoading="isResending(invitation.userEmail)"
                  @press="resendInvitation.mutate([invitation.userEmail])"
                >
                  {{ getText('resend') }}
                </Button>
                <Button
                  variant="icon"
                  size="custom"
                  @press="deleteInvitation.mutateAsync([invitation.userEmail])"
                >
                  {{ getText('remove') }}
                </Button>
              </ButtonGroup>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </Scroller>
</template>
