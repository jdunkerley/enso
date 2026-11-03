<script setup lang="ts">
/**
 * @file The settings menu: the settings cog at the right of the user bar, and the popover of
 * actions it opens (#83).
 *
 * It is a dialog ("Settings menu") of buttons, operated with Tab, Enter and Space, not a `menu`.
 * Its entries are global actions while the user bar is mounted, whether or not the menu is open
 * (`useMenuEntries`): they are in the command palette, and their shortcuts (`Mod+,` for Settings,
 * `Mod+/` for About) work anywhere.
 *
 * There is no account to show or sign out of: the app always runs as the local user.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'

const { goToSettingsPage } = defineProps<{ goToSettingsPage: () => void }>()

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
      <Button variant="icon" class="ml-2" icon="settings" :aria-label="getText('userMenuLabel')" />
    </template>
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
