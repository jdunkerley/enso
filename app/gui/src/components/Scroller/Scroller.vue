<script setup lang="ts">
/**
 * @file A scrolling container that fades its edges while there is more to scroll to: the Vue
 * counterpart of the React `#/components/Scroller`, styled by the same `SCROLLER_STYLES`.
 */
import { SCROLLER_STYLES } from '$/components/Scroller/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

type ScrollerVariants = VariantProps<typeof SCROLLER_STYLES>

const {
  orientation = 'horizontal',
  scrollbar = false,
  snap = false,
  showShadows = true,
  background = 'primary',
  fullSize = undefined,
  shadowStartClass,
  testId,
  class: className,
} = defineProps<{
  orientation?: ScrollerVariants['orientation']
  scrollbar?: boolean | undefined
  snap?: boolean | undefined
  showShadows?: boolean | undefined
  background?: ScrollerVariants['background']
  fullSize?: boolean | undefined
  shadowStartClass?: string | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const content = ref<HTMLElement>()
const startHidden = ref(true)
const endHidden = ref(true)

function updateShadows() {
  const element = content.value
  if (element == null || !showShadows) return
  const horizontal = orientation === 'horizontal'
  const scrollStart = horizontal ? element.scrollLeft : element.scrollTop
  const size = horizontal ? element.clientWidth : element.clientHeight
  const scrollSize = horizontal ? element.scrollWidth : element.scrollHeight
  startHidden.value = scrollStart === 0
  endHidden.value = Math.ceil(scrollStart + size) >= scrollSize
}

onMounted(updateShadows)
useEventListener(content, 'scroll', updateShadows, { passive: true })
useResizeObserver(content, updateShadows)

const styles = computed(() =>
  SCROLLER_STYLES({
    scrollbar,
    snap,
    orientation,
    startHidden: startHidden.value,
    endHidden: endHidden.value,
    showShadows,
    background,
    fullSize,
  }),
)

defineExpose({ content })
</script>

<template>
  <div :class="styles.base({ className })" :data-testid="testId">
    <div ref="content" :class="styles.content()"><slot /></div>
    <div aria-hidden="true" :class="styles.shadowStart({ className: shadowStartClass })" />
    <div aria-hidden="true" :class="styles.shadowEnd()" />
  </div>
</template>
