<script setup lang="ts">
/**
 * @file A menu with information about the app, opened from the {@link InfoBar}: a popover of
 * buttons. It has no "Sign out": the app runs on the offline session only.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Icon from '$/components/Icon/Icon.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { PRODUCT_NAME } from 'enso-common/src/constants'

const { getText } = useText()
</script>

<template>
  <div
    class="mb-2 flex items-center gap-icons overflow-hidden px-menu-entry transition-all duration-user-menu"
  >
    <Icon icon="enso_logo" class="pointer-events-none h-7 w-7 text-primary" />
    <Text>{{ PRODUCT_NAME }}</Text>
  </div>
  <div :aria-label="getText('infoMenuLabel')" class="flex flex-col overflow-hidden">
    <MenuEntry action="aboutThisApp" @press="openAboutModal" />
  </div>
</template>
