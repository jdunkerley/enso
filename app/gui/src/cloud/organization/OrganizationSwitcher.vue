<script setup lang="ts">
/**
 * @file The user menu's organization switcher (#83), drawn from the entries
 * `useOrganizationSwitcherEntries` made: the current organization highlighted, each with its
 * picture.
 */
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { OrganizationEntry } from './organizationSwitcher'

const { entries } = defineProps<{ entries: readonly OrganizationEntry[] }>()
</script>

<template>
  <div class="-mx-1.5 mb-1 flex flex-col overflow-hidden">
    <div
      v-for="(entry, index) in entries"
      :key="`${entry.action}-${index}`"
      :class="
        twMerge(
          'px-1.5 transition-colors',
          entry.isSelected ? 'bg-hover-bg hover:bg-black-a16' : 'hover:bg-hover-bg',
        )
      "
    >
      <MenuEntry
        :action="entry.action"
        :label="entry.label"
        truncateLabel
        :hasHoverBackground="false"
        @press="entry.doAction"
      >
        <template #picture>
          <ProfilePicture
            size="xsmall"
            :picture="entry.organization.picture"
            :name="entry.organization.name || ''"
          />
        </template>
      </MenuEntry>
    </div>
  </div>
</template>
