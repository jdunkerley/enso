<script setup lang="ts">
/**
 * @file One user group's members, opened from the user groups' "Manage Users": back to the list,
 * "Add Users" (a combo box of the organization's other members), "Delete User Group", and per member
 * "Remove", each confirmed first. The Vue port of React's `UserGroupSettingsSection`.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import type { User, UserGroupInfo } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { listUsersQueryOptions } from './queries'
import UserGroupAddUserForm from './UserGroupAddUserForm.vue'
import { USER_GROUPS_COLUMN_CLASS } from './userGroupStyles'

const { userGroup } = defineProps<{ userGroup: UserGroupInfo }>()

const emit = defineEmits<{ back: [] }>()

const { getText } = useText()
const { remoteBackend } = useBackends()
const modals = useModals()

const usersQuery = useQuery(listUsersQueryOptions(remoteBackend, Infinity))
await usersQuery.suspense()

const deleteUserGroup = useMutation(backendMutationOptions('deleteUserGroup', remoteBackend))
const changeUserGroup = useMutation(backendMutationOptions('changeUserGroup', remoteBackend))

const users = computed(() =>
  (usersQuery.data.value ?? []).filter((otherUser) =>
    (otherUser.userGroups ?? []).some((otherGroup) => otherGroup === userGroup.id),
  ),
)

const CELL_CLASS =
  'border-x-2 border-transparent bg-clip-padding px-4 py-1 first:rounded-l-full last:rounded-r-full last:border-r-0'

function confirmDeleteGroup() {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('deleteUserGroupActionText', userGroup.groupName),
    // As in React: back to the list, and the confirmation closes at once.
    onConfirm: () => {
      emit('back')
      deleteUserGroup.mutate([userGroup.id, userGroup.groupName])
    },
  })
}

function confirmRemoveUser(otherUser: User) {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('removeUserFromUserGroupActionText', otherUser.name, userGroup.groupName),
    onConfirm: () => {
      const newUserGroups = (otherUser.groups ?? [])
        .filter((group) => group.id !== userGroup.id)
        .map((group) => group.id)
      changeUserGroup.mutate([otherUser.userId, { userGroups: newUserGroups }, otherUser.name])
    },
  })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <Button
      variant="icon"
      size="medium"
      icon="arrow_circle_left"
      class="-ml-2"
      @press="emit('back')"
    >
      {{ getText('returnToGroupsList') }}
    </Button>
    <ButtonGroup verticalAlign="center" class="flex-initial">
      <Popover>
        <template #trigger>
          <Button variant="outline">{{ getText('addUsers') }}</Button>
        </template>
        <UserGroupAddUserForm :userGroup="userGroup" />
      </Popover>
      <Button variant="delete-outline" @press="confirmDeleteGroup">
        {{ getText('deleteUserGroup') }}
      </Button>
    </ButtonGroup>
    <Text elementType="h1" variant="subtitle" balance>
      {{ getText('managingUserGroupX', userGroup.groupName) }}
    </Text>
    <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="mt-8">
      <table>
        <thead class="sticky top-0 z-1 h-row bg-dashboard">
          <tr>
            <th :class="USER_GROUPS_COLUMN_CLASS({ className: 'w-80 max-w-80' })">
              {{ getText('user') }}
            </th>
            <th :class="USER_GROUPS_COLUMN_CLASS({ className: 'w-32 max-w-32' })">
              {{ getText('actions') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="otherUser in users"
            :key="otherUser.userId"
            class="group h-row rounded-rows-child"
          >
            <td :class="`min-w-48 max-w-80 ${CELL_CLASS}`">
              <Text truncate="1" class="block">{{ otherUser.email }}</Text>
              <Text truncate="1" class="block text-2xs text-primary/40">{{ otherUser.name }}</Text>
            </td>
            <td :class="CELL_CLASS">
              <ButtonGroup
                gap="joined"
                class="shrink-0 grow-0"
                :buttonVariants="{ size: 'small', variant: 'outline' }"
              >
                <Button icon="data_output" @press="confirmRemoveUser(otherUser)">
                  {{ getText('remove') }}
                </Button>
              </ButtonGroup>
            </td>
          </tr>
          <tr v-if="users.length === 0">
            <td>
              <Text color="muted">{{ getText('noUsersInThisGroup') }}</Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Scroller>
  </div>
</template>
