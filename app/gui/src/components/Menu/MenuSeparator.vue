<script setup lang="ts">
/** @file A divider between groups of `MenuItem`s. */
import { DropdownMenuSeparator } from 'reka-ui'
import { MENU_SEPARATOR_STYLES } from './variants'
</script>

<template>
  <DropdownMenuSeparator :class="MENU_SEPARATOR_STYLES({ size: 'thin' })" />
</template>
