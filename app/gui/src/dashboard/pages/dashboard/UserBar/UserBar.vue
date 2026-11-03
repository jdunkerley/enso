<script setup lang="ts">
/**
 * @file The user bar, at the right of the app container's top bar: the settings menu (#83),
 * mounted by `AppContainer.vue`.
 */
import UserMenu from './UserMenu.vue'

const { goToSettingsPage } = defineProps<{ goToSettingsPage: () => void }>()
</script>

<template>
  <div class="flex-shrink-0 pt-0.5">
    <div class="flex h-full shrink-0 cursor-default items-center gap-user-bar pl-icons-x">
      <UserMenu :goToSettingsPage="goToSettingsPage" />
    </div>
  </div>
</template>
