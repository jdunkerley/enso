<script setup lang="ts">
/**
 * @file The drive's bar: the location (Up and the breadcrumbs), drawn in the panel's toolbar, and
 * the toolbar of actions with the search bar. The Vue port of React's `DriveBar`, which put the
 * location there through a portal into the element the left panel gave it.
 */
import type AssetQuery from '$/utils/AssetQuery'
import DriveBarNavigation from './DriveBarNavigation.vue'
import DriveBarToolbar from './DriveBarToolbar.vue'

const { query, setQuery, toolbar } = defineProps<{
  query: AssetQuery
  setQuery: (query: AssetQuery) => void
  /** The panel's toolbar, where the location goes. */
  toolbar: HTMLElement | null | undefined
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <Teleport v-if="toolbar != null" :to="toolbar">
      <DriveBarNavigation />
    </Teleport>
    <DriveBarToolbar :query="query" :setQuery="setQuery" />
  </div>
</template>
