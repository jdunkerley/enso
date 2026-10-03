<script setup lang="ts">
/**
 * @file The content of a settings tab: the Vue port of the React `Tab`. Sections are laid out in
 * one column, or in two side by side on wide screens when a section asks for column 2.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import type { SettingsSectionData } from '$/configurations/settings'
import { twMerge } from '$/utils/style/tailwindMerge'
import { computed } from 'vue'
import SettingsSection from './SettingsSection.vue'

const { sections } = defineProps<{ sections: readonly SettingsSectionData[] }>()

const columns = computed(() => {
  const result: { sections: SettingsSectionData[]; class: string }[] = []
  for (const section of sections) {
    const columnNumber = section.column ?? 1
    while (result.length < columnNumber) result.push({ sections: [], class: '' })
    const column = result[columnNumber - 1]!
    column.sections.push(section)
    if (section.columnClass != null) {
      column.class =
        column.class === '' ? section.columnClass : `${column.class} ${section.columnClass}`
    }
  }
  return result
})
</script>

<template>
  <ErrorBoundary onlyRenderErrors>
    <SuspenseLoader>
      <div
        v-if="columns.length === 1"
        :class="twMerge('flex max-w-[512px] flex-none grow flex-col gap-8', columns[0]?.class)"
      >
        <SettingsSection v-for="section in sections" :key="section.nameId" :data="section" />
      </div>
      <div
        v-else
        class="grid min-h-full max-w-[1024px] flex-none grow grid-cols-1 gap-8 lg:h-auto lg:grid-cols-2"
      >
        <div
          v-for="(column, i) in columns"
          :key="i"
          :class="twMerge('flex h-fit flex-1 flex-col gap-8', column.class)"
        >
          <SettingsSection
            v-for="section in column.sections"
            :key="section.nameId"
            :data="section"
          />
        </div>
      </div>
    </SuspenseLoader>
  </ErrorBoundary>
</template>
