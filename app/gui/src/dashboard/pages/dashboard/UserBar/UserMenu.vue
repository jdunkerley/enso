<script setup lang="ts">
/**
 * @file The user menu: the profile picture button at the right of the user bar, and the popover of
 * user actions and settings it opens (#83).
 *
 * It is a dialog ("User Settings") of buttons, operated with Tab, Enter and Space, not a `menu`.
 * Its entries are global actions while the user bar is mounted, whether or not the menu is open
 * (`useMenuEntries`): they are in the command palette, and their shortcuts (`Mod+,` for Settings,
 * `Mod+/` for About) work anywhere.
 *
 * There is no account to sign out of: the app always runs as the local user, and "Working locally"
 * stands in for the plan.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import Text from '$/components/Text/Text.vue'
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import type { UserSession } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'

const { user, goToSettingsPage } = defineProps<{
  user: UserSession['user']
  goToSettingsPage: () => void
}>()

const backends = useBackends()
const { getText } = useText()
const toasts = useToasts()
const modals = useModals()

/** Show an error toast, and log it. */
function toastAndLog(message: string) {
  toasts.show(message, { type: 'error' })
  console.error(message)
}

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
])
</script>

<template>
  <Popover testId="user-menu" size="xxsmall" :aria-label="getText('userMenuLabel')">
    <template #trigger>
      <Button size="custom" variant="icon" class="ml-2" :aria-label="getText('userMenuLabel')">
        <template #icon>
          <ProfilePicture :picture="null" :name="user.name" />
        </template>
      </Button>
    </template>
    <div
      class="mb-2 flex select-none items-center gap-icons overflow-hidden px-menu-entry transition-all duration-user-menu"
    >
      <ProfilePicture :picture="null" :name="user.name" />
      <div class="flex min-w-0 flex-col">
        <Text disableLineHeightCompensation variant="body" truncate="1" weight="semibold">
          {{ user.name }}
        </Text>
        <!-- There is no plan: the local user's synthetic one ("Community") would mislead. -->
        <Text disableLineHeightCompensation>{{ getText('userMenuWorkingLocally') }}</Text>
      </div>
    </div>

    <div class="flex flex-col overflow-hidden">
      <MenuEntry
        v-for="entry in entries"
        :key="entry.action"
        :action="entry.action"
        @press="entry.doAction"
      />
    </div>
  </Popover>
</template>
