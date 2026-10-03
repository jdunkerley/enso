<script setup lang="ts">
/**
 * @file The Account tab in local-only mode (authentication disabled): the offline stand-in user,
 * with the default picture, and why the cloud account's settings are missing. It belongs to the
 * core, not to `src/cloud/`, so that a build without the cloud shows it too.
 */
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import Text from '$/components/Text/Text.vue'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'

const context = useSettingsContext()
const { getText } = useText()
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="offline-user-settings">
    <div class="flex items-center gap-4">
      <ProfilePicture :picture="null" :name="context.user.name" size="xlarge" />
      <div class="flex min-w-0 flex-col">
        <Text variant="subtitle" truncate="1" testId="offline-user-name">
          {{ context.user.name }}
        </Text>
        <Text>{{ getText('offlineUserStatus') }}</Text>
      </div>
    </div>
    <Text elementType="p" balance>{{ getText('offlineUserDescription') }}</Text>
  </div>
</template>
