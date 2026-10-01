<script setup lang="ts">
/**
 * @file A dot on the corner of its content, to notify the user of an item's state: the Vue
 * counterpart of the React `#/components/StatusBadge`.
 */
import { STATUS_BADGE_STYLES } from '$/components/Badge/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'

type StatusBadgeVariants = VariantProps<typeof STATUS_BADGE_STYLES>

const { color, hidden } = defineProps<{
  color?: StatusBadgeVariants['color']
  hidden?: boolean | undefined
}>()

const styles = computed(() => STATUS_BADGE_STYLES({ color, hidden }))
</script>

<template>
  <div :class="styles.base()">
    <slot />
    <div :class="styles.badge()" />
  </div>
</template>
