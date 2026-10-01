<script setup lang="ts">
/**
 * @file A titled group of `MenuItem`s (`role="group"`, labelled by its title): the Vue counterpart
 * of the React `Menu.Section`.
 */
import { DropdownMenuGroup, DropdownMenuLabel } from 'reka-ui'
import { MENU_SECTION_STYLES } from './variants'

const { title, testId } = defineProps<{ title: string; testId?: string | undefined }>()

const styles = MENU_SECTION_STYLES()
</script>

<template>
  <DropdownMenuGroup :class="styles.base()" :data-testid="testId" :aria-label="title">
    <DropdownMenuLabel as="header" :class="styles.header()">{{ title }}</DropdownMenuLabel>
    <slot />
  </DropdownMenuGroup>
</template>
