<script setup lang="ts">
/**
 * @file A section of a settings tab, with its heading and entries. It is hidden when none of its
 * entries is visible.
 */
import Heading from '$/components/Text/Heading.vue'
import type { SettingsSectionData } from '$/configurations/settings'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import SettingsFormEntry from './SettingsFormEntry.vue'

const { data } = defineProps<{ data: SettingsSectionData }>()

const context = useSettingsContext()
const { getText } = useText()

const isVisible = computed(() =>
  data.entries.some((entry) => entry.getVisible?.(context.value) ?? true),
)
</script>

<template>
  <div v-if="isVisible" class="flex w-full flex-1 flex-col gap-2.5">
    <Heading v-if="data.heading !== false" :level="2" weight="bold" class="cursor-default">
      {{ getText(data.nameId) }}
    </Heading>
    <div class="flex min-h-0 flex-1 flex-col justify-start gap-2">
      <template v-for="(entry, i) in data.entries" :key="i">
        <SettingsFormEntry v-if="entry.type === 'form'" :data="entry" />
        <component
          :is="entry.component"
          v-else-if="entry.getVisible?.(context) ?? true"
          v-bind="entry.props"
        />
      </template>
    </div>
  </div>
</template>
