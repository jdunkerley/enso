<script setup lang="ts">
/**
 * @file The "Add Users" popover of a user group: a combo box of the organization's members who are
 * not in the group yet, "Add User" and "Done". It stays open after adding, so that several users
 * can be added in turn.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import Submit from '$/components/Form/Submit.vue'
import ComboBox from '$/components/Inputs/ComboBox.vue'
import UserWithPopover from '$/components/UserWithPopover/UserWithPopover.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { EmailAddress, User, UserGroupInfo } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { listUsersQueryOptions } from './queries'

const { userGroup } = defineProps<{ userGroup: UserGroupInfo }>()

const { getText } = useText()
const { remoteBackend } = useBackends()

const usersQuery = useQuery(listUsersQueryOptions(remoteBackend, Infinity))
await usersQuery.suspense()

const changeUserGroup = useMutation(backendMutationOptions('changeUserGroup', remoteBackend))

const allUsers = computed(() => usersQuery.data.value ?? [])
const emails = computed(() =>
  allUsers.value
    .filter((otherUser) => (otherUser.userGroups ?? []).includes(userGroup.id))
    .map((otherUser) => otherUser.email),
)
const otherEmails = computed(() =>
  allUsers.value
    .filter((otherUser) => !(otherUser.userGroups ?? []).includes(userGroup.id))
    .map((otherUser) => otherUser.email),
)
const usersByEmail = computed(
  () =>
    new Map<EmailAddress, User>(allUsers.value.map((otherUser) => [otherUser.email, otherUser])),
)

/** The text an option filters by: the user's name and address. */
function userText(email: EmailAddress) {
  const name = usersByEmail.value.get(email)?.name
  return name == null ? email : `${name} (${email})`
}

async function addUser({ email }: { email: EmailAddress }) {
  const otherUser = usersByEmail.value.get(email)
  if (otherUser == null) return
  const newUserGroups = [...(otherUser.userGroups ?? []), userGroup.id]
  await changeUserGroup.mutateAsync([
    otherUser.userId,
    { userGroups: newUserGroups },
    otherUser.name,
  ])
}
</script>

<template>
  <Form
    :schema="
      (z) =>
        z.object({
          email: z
            .custom<EmailAddress>((s) => typeof s === 'string')
            .refine((s) => !emails.includes(s), getText('thisUserIsAlreadyInTheUserGroup')),
        })
    "
    :defaultValues="{ email: '' as EmailAddress }"
    @submit="addUser"
  >
    <ComboBox
      name="email"
      :ariaLabel="getText('user')"
      :items="otherEmails"
      :toTextValue="userText"
    >
      <template #default="{ item: email }">
        <UserWithPopover
          v-if="usersByEmail.get(email) != null"
          :user="{ ...usersByEmail.get(email)!, name: userText(email) }"
          class="pointer-events-none"
        />
      </template>
    </ComboBox>
    <ButtonGroup>
      <Submit>{{ getText('addUser') }}</Submit>
      <DialogClose variant="outline">{{ getText('done') }}</DialogClose>
    </ButtonGroup>
  </Form>
</template>
