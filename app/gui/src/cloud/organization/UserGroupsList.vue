<script setup lang="ts">
/**
 * @file The organization's user groups, each with its members' pictures and (for an admin) "Manage
 * Users" and a menu to delete it; above them, for an admin, "New User Group" and, on a plan that
 * limits them, how many groups are left. The root view of `UserGroupsSettingsSection.vue`.
 */
import PaywallDialogButton from '$/cloud/billing/paywall/PaywallDialogButton.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useBackends } from '$/providers/backends'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import type { UserGroupInfo } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import NewUserGroupForm from './NewUserGroupForm.vue'
import { listUserGroupsQueryOptions, listUsersQueryOptions } from './queries'
import UserGroupRow from './UserGroupRow.vue'
import { USER_GROUPS_COLUMN_CLASS } from './userGroupStyles'

/** The maximum number of user groups on a plan that limits them (the team plan). */
const MAXIMUM_USER_GROUPS_NUMBER = 10

const emit = defineEmits<{ manage: [userGroup: UserGroupInfo] }>()

const { getText } = useText()
const { remoteBackend } = useBackends()
const context = useSettingsContext()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()

const userGroupsQuery = useQuery(listUserGroupsQueryOptions(remoteBackend))
// Only the rows need the members, as in React, where each row asked for them.
const usersQuery = useQuery(
  listUsersQueryOptions(
    remoteBackend,
    Infinity,
    computed(() => (userGroupsQuery.data.value?.length ?? 0) > 0),
  ),
)
// As React's tab suspended: on the groups, then (through their rows) on the members.
await userGroupsQuery.suspense()
if ((userGroupsQuery.data.value?.length ?? 0) > 0) await usersQuery.suspense()

const userGroups = computed(() => userGroupsQuery.data.value ?? [])
const users = computed(() => usersQuery.data.value ?? [])
const isAdmin = computed(() => context.value.user.isOrganizationAdmin)
const isUnderPaywall = computed(() => isFeatureUnderPaywall('userGroupsFull'))
const userGroupsLeft = computed(() =>
  isUnderPaywall.value ? MAXIMUM_USER_GROUPS_NUMBER - userGroups.value.length : Infinity,
)
const shouldDisplayPaywall = computed(() => isUnderPaywall.value && userGroupsLeft.value <= 0)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <ButtonGroup v-if="isAdmin" verticalAlign="center" class="flex-initial">
      <PaywallDialogButton
        v-if="shouldDisplayPaywall"
        feature="userGroupsFull"
        variant="outline"
        size="medium"
        rounded="full"
        iconPosition="end"
        :tooltip="getText('userGroupsPaywallMessage')"
      >
        {{ getText('newUserGroup') }}
      </PaywallDialogButton>
      <Popover v-else size="small" placement="bottom-start">
        <template #trigger>
          <Button variant="outline">{{ getText('newUserGroup') }}</Button>
        </template>
        <NewUserGroupForm />
      </Popover>
      <span v-if="isUnderPaywall" class="text-xs">
        {{
          userGroupsLeft <= 0 ?
            getText('userGroupsPaywallMessage')
          : getText('userGroupsLimitMessage', MAXIMUM_USER_GROUPS_NUMBER, userGroupsLeft)
        }}
      </span>
    </ButtonGroup>
    <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="mt-8">
      <table
        :aria-label="getText('userGroups')"
        class="max-w-3xl table-fixed self-start rounded-rows"
      >
        <thead class="sticky top-0 z-1 h-row bg-dashboard">
          <tr>
            <th :class="USER_GROUPS_COLUMN_CLASS({ className: 'w-48 min-w-48' })">
              {{ getText('userGroup') }}
            </th>
            <th :class="USER_GROUPS_COLUMN_CLASS({ className: 'w-[21rem] min-w-[21rem]' })">
              {{ getText('users') }}
            </th>
            <th v-if="isAdmin" :class="USER_GROUPS_COLUMN_CLASS()">{{ getText('actions') }}</th>
          </tr>
        </thead>
        <tbody class="select-text">
          <tr v-if="userGroups.length === 0" class="h-10">
            <td :colspan="999" class="px-2.5 placeholder">
              {{
                isAdmin ?
                  getText('youHaveNoUserGroupsAdmin')
                : getText('youHaveNoUserGroupsNonAdmin')
              }}
            </td>
          </tr>
          <UserGroupRow
            v-for="userGroup in userGroups"
            :key="userGroup.id"
            :userGroup="userGroup"
            :users="users"
            :isAdmin="isAdmin"
            @manage="emit('manage', userGroup)"
          />
        </tbody>
      </table>
    </Scroller>
  </div>
</template>
