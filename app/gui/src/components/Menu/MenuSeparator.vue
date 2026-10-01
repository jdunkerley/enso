<script setup lang="ts">
/** @file A divider between groups of {@link MenuItem}s; the Vue counterpart of `Menu.Separator`. */
import { DropdownMenuSeparator } from 'reka-ui'
import { MENU_SEPARATOR_STYLES } from './variants'
</script>

<template>
  <DropdownMenuSeparator :class="MENU_SEPARATOR_STYLES()" />
</template>
