<script setup lang="ts">
/**
 * @file An icon from `icons.svg`.
 *
 * `icons.svg` is the one icon set (see "Assets and icons" in `app/gui/CLAUDE.md`); the
 * project-view `SvgIcon` draws from it too. An unknown name
 * renders the "missing" glyph, exactly as `SvgIcon` does. Something other than an `icons.svg` icon
 * (an element, a spinner) goes in the default slot instead of `icon`, and is wrapped in the same
 * sized box.
 */
import { ICON_STYLES, type IconVariants } from '$/components/Icon/variants'
import type { Icon } from '@/util/iconMetadata/iconName'
import { svgUseHref } from '@/util/icons'
import { computed } from 'vue'

const {
  icon,
  size,
  color,
  alt = '',
  testId,
  class: className,
} = defineProps<{
  icon?: Icon | undefined
  size?: IconVariants['size']
  color?: IconVariants['color']
  /** An accessible name. Without one the icon is decorative (`role="presentation"`). */
  alt?: string | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const classes = computed(() => ICON_STYLES({ size, color, className }))
</script>

<template>
  <svg
    v-if="icon != null"
    :class="classes"
    :data-testid="testId"
    :role="alt.length > 0 ? 'img' : 'presentation'"
    viewBox="0 0 16 16"
    preserveAspectRatio="xMidYMid slice"
    :aria-label="alt"
  >
    <use :href="svgUseHref(icon)" class="h-full w-full" aria-hidden="true" :data-icon="icon" />
  </svg>
  <span v-else-if="$slots.default" :class="classes" :data-testid="testId"><slot /></span>
</template>
