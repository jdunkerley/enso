<script setup lang="ts">
/**
 * @file The User groups settings tab: the organization's user groups (`UserGroupsList.vue`) or, once
 * one is chosen with "Manage Users", that group's members (`UserGroupMembers.vue`). The Vue port of
 * the React `UserGroupsSettingsSection`.
 *
 * Users join a group through "Add Users", a combo box of the organization's other members: a
 * keyboard path as much as a pointer one. (The drag and drop of users onto groups that the
 * ticket mentions is long gone from the React tab, since upstream's #13111.)
 */
import type { UserGroupInfo } from 'enso-common/src/services/Backend'
import { shallowRef } from 'vue'
import UserGroupMembers from './UserGroupMembers.vue'
import UserGroupsList from './UserGroupsList.vue'

const userGroup = shallowRef<UserGroupInfo | null>(null)
</script>

<template>
  <UserGroupsList v-if="userGroup == null" @manage="userGroup = $event" />
  <UserGroupMembers v-else :userGroup="userGroup" @back="userGroup = null" />
</template>
