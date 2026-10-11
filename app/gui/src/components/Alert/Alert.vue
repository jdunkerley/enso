<script setup lang="ts">
/**
 * @file An alert box, styled by `ALERT_STYLES`. An `error` alert is an `alert` live region and can
 * take focus programmatically (`tabindex="-1"`).
 */
import { ALERT_STYLES } from '$/components/Alert/variants'
import Icon from '$/components/Icon/Icon.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed } from 'vue'

type AlertVariants = VariantProps<typeof ALERT_STYLES>

const {
  variant = 'error',
  size,
  rounded,
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the variant default applies.
  fullWidth = undefined,
  icon,
  class: className,
} = defineProps<{
  variant?: AlertVariants['variant']
  size?: AlertVariants['size']
  rounded?: AlertVariants['rounded']
  fullWidth?: boolean | undefined
  icon?: IconName | undefined
  class?: string | undefined
}>()

const styles = computed(() => ALERT_STYLES({ variant, size, rounded, fullWidth }))
</script>

<template>
  <div
    :class="styles.base({ className })"
    :tabindex="variant === 'error' ? -1 : undefined"
    :role="variant === 'error' ? 'alert' : undefined"
  >
    <Icon v-if="icon != null" :icon="icon" size="medium" :class="styles.iconContainer()" />
    <div :class="styles.children()"><slot /></div>
  </div>
</template>
