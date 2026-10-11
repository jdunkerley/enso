<script setup lang="ts">
/**
 * @file The content of one step, shown only while that step is current (or always, with
 * `forceRender`). Use it inside a `Stepper.vue`; the default slot receives the same props as the
 * stepper's.
 */
import { computed } from 'vue'
import { injectStepper } from './stepperContext'

const { index, forceRender = false } = defineProps<{
  index: number
  forceRender?: boolean | undefined
}>()

const state = injectStepper()
const current = computed(() => state.currentStep.value)
</script>

<template>
  <template v-if="current === index || forceRender">
    <slot
      :currentStep="current"
      :totalSteps="state.totalSteps"
      :isFirst="current === 0"
      :isLast="current === state.totalSteps - 1"
      :goToStep="state.goToStep"
      :nextStep="state.nextStep"
      :previousStep="state.previousStep"
    />
  </template>
</template>
