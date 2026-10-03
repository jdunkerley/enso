<script setup lang="ts">
/**
 * @file A row of the user groups: the group's name, the pictures of its first members (with how
 * many more there are), and, for an admin, "Manage Users" joined to a menu that deletes the group
 * once confirmed. The Vue port of React's `UserGroupRow`.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DropdownMenu from '$/components/Menu/DropdownMenu.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import type { User, UserGroupInfo } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import { USER_GROUP_CELL_CLASS } from './userGroupStyles'

/** The most members whose pictures a row shows. */
const MAXIMUM_USER_ICONS = 6

const { userGroup, users: allUsers } = defineProps<{
  userGroup: UserGroupInfo
  /** Every member of the organization. */
  users: readonly User[]
  isAdmin: boolean
}>()

const emit = defineEmits<{ manage: [] }>()

const { getText } = useText()
const { remoteBackend } = useBackends()
const modals = useModals()

const deleteUserGroup = useMutation(backendMutationOptions('deleteUserGroup', remoteBackend))

const users = computed(() =>
  allUsers.filter((otherUser) =>
    (otherUser.userGroups ?? []).some((otherGroup) => otherGroup === userGroup.id),
  ),
)

function confirmDelete() {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('deleteUserGroupActionText', userGroup.groupName),
    // As in React, the confirmation closes at once, without waiting for the deletion.
    onConfirm: () => {
      deleteUserGroup.mutate([userGroup.id, userGroup.groupName])
    },
  })
}
</script>

<template>
  <tr class="group h-10 select-none rounded-rows-child">
    <td :class="USER_GROUP_CELL_CLASS">
      <Text nowrap truncate="1" weight="semibold">{{ userGroup.groupName }}</Text>
    </td>
    <td :class="USER_GROUP_CELL_CLASS">
      <div class="flex items-center gap-2">
        <VisualTooltip
          v-for="otherUser in users.slice(0, MAXIMUM_USER_ICONS)"
          :key="otherUser.userId"
          :tooltip="`${otherUser.name} (${otherUser.email})`"
          class="shrink-0"
        >
          <ProfilePicture :picture="otherUser.profilePicture" :name="otherUser.name" />
        </VisualTooltip>
        <Text v-if="users.length === 0" nowrap truncate="1">{{ getText('zeroUsers') }}</Text>
        <Text v-if="users.length > MAXIMUM_USER_ICONS" nowrap truncate="1">
          {{ getText('plusXUsers', users.length - MAXIMUM_USER_ICONS) }}
        </Text>
      </div>
    </td>
    <td v-if="isAdmin" :class="USER_GROUP_CELL_CLASS">
      <ButtonGroup
        gap="joined"
        class="shrink-0 grow-0"
        :buttonVariants="{ size: 'small', variant: 'outline' }"
      >
        <Button icon="people_settings" @press="emit('manage')">
          {{ getText('manageUsers') }}
        </Button>
        <DropdownMenu placement="bottom" :offset="8">
          <template #trigger>
            <Button icon="chevron_down" iconPosition="end" variant="outline" />
          </template>
          <MenuItem icon="trash" @select="confirmDelete">{{ getText('delete') }}</MenuItem>
        </DropdownMenu>
      </ButtonGroup>
    </td>
  </tr>
</template>
