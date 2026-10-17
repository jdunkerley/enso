<script setup lang="ts">
/**
 * @file The user bar, at the right of the app container's top bar: the offline notice, the
 * notification tray and the user menu (#83), mounted by `AppContainer.vue`.
 *
 * The user menu has no account entries: the app always runs as the local user.
 */
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useAuth } from '$/providers/auth'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import NotificationTray from './NotificationTray/NotificationTray.vue'
import UserMenu from './UserMenu.vue'

const { goToSettingsPage } = defineProps<{ goToSettingsPage: () => void }>()

const auth = useAuth()
const { getText } = useText()
const isOnline = useIsOnline()

const user = computed(() => auth.session?.user)
const isAuthDisabled = computed(() => auth.session?.isAuthDisabled === true)
</script>

<template>
  <div v-if="user" class="flex-shrink-0 pt-0.5">
    <div class="flex h-full shrink-0 cursor-default items-center gap-user-bar pl-icons-x">
      <div v-if="!isOnline" class="mr-2 flex items-center gap-2">
        <Icon icon="cloud_offline" />
        <Text :tooltip="getText('offlineToastMessage')" tooltipDisplay="always">
          {{ getText('youAreOffline') }}
        </Text>
      </div>
      <NotificationTray />
      <UserMenu
        :user="user"
        :isAuthDisabled="isAuthDisabled"
        :goToSettingsPage="goToSettingsPage"
      />
    </div>
  </div>
</template>
