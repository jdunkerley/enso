<script setup lang="ts">
/**
 * @file A {@link Spinner} that starts at `initial` and moves to the given phase on the next frame,
 * so that the arc animates into it.
 */
import type { SpinnerPhase } from '$/components/Spinner/variants'
import { onScopeDispose, ref, watch } from 'vue'
import Spinner from './Spinner.vue'

const {
  phase: targetPhase,
  size,
  padding,
  thickness,
  class: className,
} = defineProps<{
  phase: SpinnerPhase
  size?: number | undefined
  padding?: number | undefined
  thickness?: number | undefined
  class?: string | undefined
}>()

const phase = ref<SpinnerPhase>('initial')
let frame: number | undefined
watch(
  () => targetPhase,
  (next) => {
    if (frame != null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      phase.value = next
    })
  },
  { immediate: true },
)
onScopeDispose(() => {
  if (frame != null) cancelAnimationFrame(frame)
})
</script>

<template>
  <Spinner
    :phase="phase"
    :size="size"
    :padding="padding"
    :thickness="thickness"
    :class="className"
  />
</template>
