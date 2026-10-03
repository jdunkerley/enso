<script setup lang="ts">
/**
 * @file A dimming overlay over the whole window, with a cutout around one element: the Vue port of
 * the React `useSpotlight`'s `Spotlight`. The cutout's corners follow the element's border radius. A
 * click on the overlay emits `close`.
 *
 * It follows the element every frame. React measured the element only when it was resized, so when
 * "Edit" opened the right panel, the cutout stayed where the section was as the panel began to
 * slide in, near the window's right edge; this one ends up around the section (see "Rulings from
 * #183").
 *
 * Like React's, it renders only while `index.html`'s `.enso-spotlight` element exists, and goes
 * into the overlays' root. The element it highlights must be raised above the overlay: give it
 * {@link SPOTLIGHT_TARGET_STYLE}.
 */
import { portalTarget } from '$/components/portal'
import { convertCSSUnitString } from '$/utils/convertCSSUnits'
import { useRafFn } from '@vueuse/core'
import { computed, ref, shallowRef, watchEffect } from 'vue'

// React's default padding around the element.
const { element, paddingPx = 8 } = defineProps<{
  element: HTMLElement | undefined
  paddingPx?: number | undefined
}>()
const emit = defineEmits<{ close: [] }>()

const hasBackground = document.getElementsByClassName('enso-spotlight')[0] != null

const bounds = shallowRef<DOMRect>()
useRafFn(() => {
  const rect = element?.getBoundingClientRect()
  if (
    rect != null &&
    (bounds.value == null ||
      rect.top !== bounds.value.top ||
      rect.left !== bounds.value.left ||
      rect.width !== bounds.value.width ||
      rect.height !== bounds.value.height)
  ) {
    bounds.value = rect
  }
})
const borderRadius = ref(0)
watchEffect(() => {
  if (element) {
    const sizeString = getComputedStyle(element).borderRadius
    borderRadius.value = convertCSSUnitString(sizeString, 'px', element).number
  }
})

const clipPath = computed(() => {
  if (bounds.value == null) return undefined
  const { height, width } = bounds.value
  const top = bounds.value.top - paddingPx
  const left = bounds.value.left - paddingPx
  const radius = borderRadius.value

  const r = Math.min(radius, height / 2 + paddingPx, width / 2 + paddingPx)
  const straightWidth = Math.max(0, width + paddingPx * 2 - radius * 2)
  const straightHeight = Math.max(0, height + paddingPx * 2 - radius * 2)

  return (
    // A rectangle covering the entire screen
    'path(evenodd, "M0 0L3840 0 3840 2160 0 2160Z' +
    // Move to top left
    `M${left + r} ${top}` +
    // Top edge
    `h${straightWidth}` +
    // Top right arc
    (r !== 0 ? `a${r} ${r} 0 0 1 ${r} ${r}` : '') +
    // Right edge
    `v${straightHeight}` +
    // Bottom right arc
    (r !== 0 ? `a${r} ${r} 0 0 1 -${r} ${r}` : '') +
    // Bottom edge
    `h-${straightWidth}` +
    // Bottom left arc
    (r !== 0 ? `a${r} ${r} 0 0 1 -${r} -${r}` : '') +
    // Left edge
    `v-${straightHeight}` +
    // Top left arc
    (r !== 0 ? `a${r} ${r} 0 0 1 ${r} -${r}` : '') +
    'Z")'
  )
})
</script>

<script lang="ts">
/** The style of the element a spotlight highlights: above the overlay, as React's `useSpotlight` gave it. */
export const SPOTLIGHT_TARGET_STYLE = { position: 'relative', zIndex: 3 } as const
</script>

<template>
  <Teleport v-if="hasBackground && element != null && clipPath != null" :to="portalTarget()">
    <div
      class="absolute inset-0 h-full w-full bg-primary/25 contain-strict"
      :style="{ clipPath }"
      @click="emit('close')"
    />
  </Teleport>
</template>
