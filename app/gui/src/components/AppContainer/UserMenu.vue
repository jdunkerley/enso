<script setup lang="ts">
/**
 * @file The settings menu: the settings cog at the bottom of the left rail, and the popover of
 * actions it opens (#83). `LeftPanel.vue` mounts it.
 *
 * It is a dialog ("Settings menu") of buttons, operated with Tab, Enter and Space, not a `menu`.
 * Its entries are global actions while the menu is mounted, whether or not the menu is open
 * (`useMenuEntries`): they are in the command palette, and their shortcuts (`Mod+,` for Settings,
 * `Mod+/` for About) work anywhere.
 *
 * There is no account to show or sign out of: the app always runs as the local user.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Popover from '$/components/Dialog/Popover.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import { useBackends } from '$/providers/backends'
import { useContainerData } from '$/providers/container'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'
import SvgIcon from '@/components/SvgIcon.vue'

const { extended = false } = defineProps<{
  /** The rail is expanded: the button shows its label, as the rail's other buttons do. */
  extended?: boolean
}>()

const backends = useBackends()
const { openSettingsTab } = useContainerData()
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
  { action: 'settings', doAction: () => openSettingsTab() },
  { action: 'aboutThisApp', doAction: openAboutModal },
])
</script>

<template>
  <!-- Opens up and to the right of the rail's bottom, so that it is not clipped by the window. -->
  <Popover
    testId="user-menu"
    size="xxsmall"
    placement="right-end"
    :aria-label="getText('userMenuLabel')"
  >
    <template #trigger>
      <button type="button" class="UserMenuButton" :aria-label="getText('userMenuLabel')">
        <SvgIcon name="settings" />
        <span v-if="extended">{{ getText('settingsShortcut') }}</span>
      </button>
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

<style scoped>
/* As the rail's other buttons (`MenuButton`). */
.UserMenuButton {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: max-content;
  height: var(--button-height, 26px);
  padding: 4px;
  border: none;
  border-radius: var(--radius-full);
  transition: background-color 0.1s;
  cursor: pointer;

  &:hover,
  &:focus,
  &:active,
  &[data-state='open'] {
    background-color: var(--color-menu-entry-hover-bg);
  }
}
</style>
