<script setup lang="ts">
/**
 * @file The user menu: the profile picture button at the right of the user bar, and the popover of
 * user actions and settings it opens. The Vue counterpart of the React `UserMenu` (#83).
 *
 * As in React it is a dialog ("User Settings") of buttons, operated with Tab, Enter and Space, not
 * a `menu`. Its entries are global actions while the user bar is mounted, whether or not the menu
 * is open (`useMenuEntries`): they are in the command palette, and their shortcuts (`Mod+,` for
 * Settings, `Mod+/` for About) work anywhere.
 *
 * The cloud-only parts come from `src/cloud/` (the organization switcher, "Upgrade Plan"); they are
 * imported directly, as the cloud registries of decision 6b do not exist yet.
 */
import { upgradePlanEntry } from '$/cloud/billing/userMenu'
import OrganizationSwitcher from '$/cloud/organization/OrganizationSwitcher.vue'
import { useOrganizationSwitcherEntries } from '$/cloud/organization/organizationSwitcher'
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import Text from '$/components/Text/Text.vue'
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import type { UserSession } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useDevtoolsStore } from '$/providers/devTools'
import { useModals } from '$/providers/modals'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const { user, goToSettingsPage } = defineProps<{
  user: UserSession['user']
  goToSettingsPage: () => void
}>()

const emit = defineEmits<{ signOut: [] }>()

const router = useRouter()
const backends = useBackends()
const { signOut } = useSession()
const { getText } = useText()
const toasts = useToasts()
const modals = useModals()
const devtools = useDevtoolsStore()

/** Show an error toast, and log it, as React's `toastAndLog` does. */
function toastAndLog(message: string) {
  toasts.show(message, { type: 'error' })
  console.error(message)
}

const organizationEntries = useOrganizationSwitcherEntries(() => user)

const entries = useMenuEntries<MenuEntryAction>(() => [
  backends.localBackend == null && {
    action: 'downloadApp',
    doAction: () => {
      modals.closeAll()
      void getDownloadUrl().then((downloadUrl) => {
        if (downloadUrl == null) {
          toastAndLog(`${getText('noAppDownloadError')}.`)
        } else {
          void download({ url: downloadUrl })
        }
      })
    },
  },
  { action: 'settings', doAction: goToSettingsPage },
  { action: 'aboutThisApp', doAction: openAboutModal },
  user.isEnsoTeamMember &&
    IS_DEV_MODE && {
      action: 'toggleEnsoDevtools',
      doAction: () => {
        devtools.showEnsoDevtools = !devtools.showEnsoDevtools
      },
    },
  upgradePlanEntry(user, router, () => emit('signOut')),
])

const tailEntries = useMenuEntries<MenuEntryAction>(() => [
  {
    action: 'signOut',
    doAction: () => {
      emit('signOut')
      void signOut()
    },
  },
])

const planText = computed(() => getText(user.plan))
</script>

<template>
  <Popover testId="user-menu" size="xxsmall" :aria-label="getText('userMenuLabel')">
    <template #trigger>
      <Button size="custom" variant="icon" class="ml-2" :aria-label="getText('userMenuLabel')">
        <template #icon>
          <ProfilePicture :picture="user.profilePicture" :name="user.name" />
        </template>
      </Button>
    </template>
    <div
      class="mb-2 flex select-none items-center gap-icons overflow-hidden px-menu-entry transition-all duration-user-menu"
    >
      <ProfilePicture :picture="user.profilePicture" :name="user.name" />
      <div class="flex min-w-0 flex-col">
        <Text disableLineHeightCompensation variant="body" truncate="1" weight="semibold">
          {{ user.name }}
        </Text>
        <Text disableLineHeightCompensation>{{ planText }}</Text>
      </div>
    </div>

    <OrganizationSwitcher v-if="user.maintainerAccount" :entries="organizationEntries" />

    <div class="flex flex-col overflow-hidden">
      <MenuEntry
        v-for="entry in entries"
        :key="entry.action"
        :action="entry.action"
        @press="entry.doAction"
      />
    </div>

    <div class="flex flex-col overflow-hidden">
      <MenuEntry
        v-for="entry in tailEntries"
        :key="entry.action"
        :action="entry.action"
        @press="entry.doAction"
      />
    </div>
  </Popover>
</template>
