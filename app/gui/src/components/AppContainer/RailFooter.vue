<script setup lang="ts">
/**
 * @file The three buttons at the bottom of the left rail, under the divider: Settings (the cog),
 * Documentation (the user documentation site's introduction, in the browser) and About (#566).
 * `LeftPanel.vue` mounts it.
 *
 * All are plain rail buttons, labelled when the rail is extended. Their actions, and "Download
 * app" (only without a local backend, and with no button), are global while this is mounted
 * (`useMenuEntries`): they are in the command palette, and the shortcuts (`Mod+,` for Settings,
 * `Mod+/` for About; Documentation has none) work anywhere.
 *
 * There is no account to show or sign out of: the app always runs as the local user.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import { documentationBase } from '$/providers/openedProjects/suggestionDatabase/entry'
import { useBackends } from '$/providers/backends'
import { useContainerData } from '$/providers/container'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'
import SvgButton from '@/components/SvgButton.vue'

const { extended = false } = defineProps<{
  /** The rail is expanded: the buttons show their labels, as the rail's other buttons do. */
  extended?: boolean
}>()

const backends = useBackends()
const { openSettingsTab } = useContainerData()
const { getText } = useText()
const toasts = useToasts()
const modals = useModals()

/** The documentation site's introduction page; no button without a configured site. */
const documentationRoot = documentationBase($config.DOCS_URL)
const documentationUrl = documentationRoot != null ? `${documentationRoot}intro/` : undefined

function openDocumentation() {
  if (documentationUrl != null) window.open(documentationUrl, '_blank')
}

/** Show an error toast, and log it. */
function toastAndLog(message: string) {
  toasts.show(message, { type: 'error' })
  console.error(message)
}

useMenuEntries<MenuEntryAction>(() => [
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
  documentationUrl != null && { action: 'documentation', doAction: openDocumentation },
  { action: 'aboutThisApp', doAction: openAboutModal },
])
</script>

<template>
  <div class="RailFooter">
    <SvgButton
      class="RailButton"
      name="settings"
      :label="extended ? getText('settingsShortcut') : undefined"
      :title="getText('settingsShortcut')"
      @activate="openSettingsTab()"
    />
    <SvgButton
      v-if="documentationUrl != null"
      class="RailButton"
      name="help"
      :label="extended ? getText('documentationShortcut') : undefined"
      :title="getText('documentationShortcut')"
      @activate="openDocumentation()"
    />
    <SvgButton
      class="RailButton"
      name="info"
      :label="extended ? getText('aboutThisAppShortcut') : undefined"
      :title="getText('aboutThisAppShortcut')"
      @activate="openAboutModal()"
    />
  </div>
</template>

<style scoped>
.RailFooter {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 8px;
}

/* `SvgButton` pulls itself out by 4px; the rail's padding already places the icons. */
.RailFooter .RailButton {
  margin: 0;
}
</style>
