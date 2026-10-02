<script setup lang="ts">
/**
 * @file The user bar, at the right of the app container's top bar: the offline notice, the trial
 * indicator, "Invite" and "Upgrade", the notification tray and the user menu. The Vue counterpart
 * of the React `UserBar` (#83), mounted by `AppContainer.vue`.
 *
 * The cloud-only parts come from `src/cloud/`, imported directly (decision 6b's registries do not
 * exist yet). "Invite" stays a React leaf until the organization port (#87) moves its dialog.
 *
 * In local mode (authentication disabled, the offline stand-in session) there is no cloud account:
 * the trial indicator, "Invite" and "Upgrade" are not shown, nor are the user menu's cloud entries.
 */
import TrialProgress from '$/cloud/billing/TrialProgress.vue'
import UpgradeButton from '$/cloud/billing/UpgradeButton.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useAuth } from '$/providers/auth'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import { reactComponent } from '$/utils/react'
import { InviteUsersButton as InviteUsersButtonReact } from '#/modals/InviteUsersModal/InviteUsersButton'
import { Plan } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import NotificationTray from './NotificationTray/NotificationTray.vue'
import UserMenu from './UserMenu.vue'

const InviteUsersButton = reactComponent(InviteUsersButtonReact)

const { goToSettingsPage } = defineProps<{ goToSettingsPage: () => void }>()
const emit = defineEmits<{ signOut: [] }>()

const auth = useAuth()
const { getText } = useText()
const isOnline = useIsOnline()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()

const user = computed(() => auth.session?.user)
const isAuthDisabled = computed(() => auth.session?.isAuthDisabled === true)
const shouldShowInviteButton = computed(
  () => !isAuthDisabled.value && !isFeatureUnderPaywall('inviteUser'),
)
const shouldShowUpgradeButton = computed(
  () =>
    !isAuthDisabled.value &&
    user.value?.isOrganizationAdmin === true &&
    user.value.plan === Plan.free,
)
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
      <TrialProgress v-if="!isAuthDisabled" :user="user" />
      <InviteUsersButton v-if="shouldShowInviteButton" />
      <UpgradeButton v-if="shouldShowUpgradeButton" />
      <NotificationTray />
      <UserMenu
        :user="user"
        :isAuthDisabled="isAuthDisabled"
        :goToSettingsPage="goToSettingsPage"
        @signOut="emit('signOut')"
      />
    </div>
  </div>
</template>
