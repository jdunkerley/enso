<script setup lang="ts">
/**
 * @file The list of settings tabs, in their groups: the Vue port of the React `Sidebar`, with the
 * same elements and classes. Each tab is a button; the current one is highlighted.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Heading from '$/components/Text/Heading.vue'
import type { SettingsTabSectionData } from '$/configurations/settings'
import type SettingsTabType from '$/configurations/settingsTabs'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import type { AnySettingsTabData } from './tabs'

const { tabSections, tabsToShow, tab } = defineProps<{
  tabSections: readonly SettingsTabSectionData<AnySettingsTabData>[]
  /** The visible tabs that match the search. */
  tabsToShow: readonly SettingsTabType[]
  tab: SettingsTabType
}>()

const emit = defineEmits<{ 'update:tab': [tab: SettingsTabType] }>()

const { getText } = useText()

const groups = computed(() =>
  tabSections.flatMap((section) => {
    const tabs = section.tabs.filter((tabData) => tabsToShow.includes(tabData.settingsTab))
    return tabs.length === 0 ? [] : [{ name: getText(section.nameId), tabs }]
  }),
)

function select(settingsTab: SettingsTabType) {
  if (tab !== settingsTab) emit('update:tab', settingsTab)
}
</script>

<template>
  <div
    :aria-label="getText('settingsSidebarLabel')"
    class="w-settings-sidebar shrink-0 flex-col gap-4 overflow-y-auto"
  >
    <div v-for="group in groups" :key="group.name" class="flex flex-col items-start">
      <header
        :id="`${group.name}_header`"
        class="z-1 mb-sidebar-section-heading-b h-text px-sidebar-section-heading-x py-sidebar-section-heading-y text-[13.5px] font-bold leading-cozy"
      >
        <Heading variant="subtitle">{{ group.name }}</Heading>
      </header>
      <ButtonGroup gap="xxsmall" direction="column" align="start">
        <Button
          v-for="tabData in group.tabs"
          :id="tabData.settingsTab"
          :key="tabData.settingsTab"
          :icon="tabData.icon"
          variant="ghost-fading"
          loaderPosition="icon"
          size="medium"
          rounded="full"
          :class="
            tabData.settingsTab === tab ? 'z-1 bg-white font-medium opacity-100' : 'z-1 font-medium'
          "
          @press="select(tabData.settingsTab)"
        >
          {{ getText(tabData.nameId) }}
        </Button>
      </ButtonGroup>
    </div>
  </div>
</template>
