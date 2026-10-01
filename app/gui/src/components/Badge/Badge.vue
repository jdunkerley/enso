<script setup lang="ts">
/**
 * @file Highlights an item's status for quick recognition: the Vue counterpart of the React
 * `#/components/Badge`.
 */
import { BADGE_STYLES } from '$/components/Badge/variants'
import Icon from '$/components/Icon/Icon.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed } from 'vue'

type BadgeVariants = VariantProps<typeof BADGE_STYLES>

const {
  variant,
  color,
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the default applies.
  rounded = undefined,
  size,
  icon,
  class: className,
} = defineProps<{
  variant?: BadgeVariants['variant']
  color?: BadgeVariants['color']
  rounded?: BadgeVariants['rounded']
  size?: BadgeVariants['size']
  icon?: IconName | undefined
  class?: string | undefined
}>()

const styles = computed(() => BADGE_STYLES({ color, rounded, variant, size }))
</script>

<template>
  <div :class="styles.base({ class: className })">
    <Icon v-if="icon != null" :icon="icon" :class="styles.icon()" />
    <div :class="styles.content()"><slot /></div>
  </div>
</template>
