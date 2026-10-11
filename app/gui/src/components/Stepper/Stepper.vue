<script setup lang="ts">
/**
 * @file A multi-step process, styled by `STEPPER_STYLES`. Its state comes from `useStepperState`.
 *
 * - The `step` slot renders each step's marker, usually a `Step.vue`, with
 *   `{ index, isCurrent, isCompleted, isFirst, isLast, isDisabled, … }`. Without it no markers show.
 * - The default slot is the current step's content, with `{ currentStep, isFirst, isLast,
 *   nextStep, previousStep, goToStep, … }`, inside an error boundary and a suspense loader. It is
 *   re-created on every step change. `StepContent.vue`s inside it show only the current step's
 *   content.
 */
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import { STEPPER_STYLES } from '$/components/Stepper/variants'
import { computed } from 'vue'
import { provideStepper } from './stepperContext'
import type { StepperState } from './useStepperState'

const { state, class: className } = defineProps<{
  state: StepperState
  class?: string | undefined
}>()

/** What every slot receives. */
interface BaseSlotProps {
  readonly currentStep: number
  readonly totalSteps: number
  readonly isFirst: boolean
  readonly isLast: boolean
  readonly goToStep: (step: number) => void
  readonly nextStep: () => void
  readonly previousStep: () => void
}

defineSlots<{
  default?: (props: BaseSlotProps) => unknown
  step?: (
    props: BaseSlotProps & {
      readonly index: number
      readonly isCurrent: boolean
      readonly isCompleted: boolean
      readonly isDisabled: boolean
    },
  ) => unknown
}>()

provideStepper(state)

const styles = STEPPER_STYLES()

const base = computed<BaseSlotProps>(() => ({
  currentStep: state.currentStep.value,
  totalSteps: state.totalSteps,
  isFirst: state.currentStep.value === 0,
  isLast: state.currentStep.value === state.totalSteps - 1,
  goToStep: state.goToStep,
  nextStep: state.nextStep,
  previousStep: state.previousStep,
}))

function stepProps(index: number) {
  const current = state.currentStep.value
  return {
    ...base.value,
    index,
    isFirst: index === 0,
    isLast: index === state.totalSteps - 1,
    isCurrent: index === current,
    isCompleted: index < current,
    isDisabled: index > current,
  }
}
</script>

<template>
  <div :class="styles.base({ className })">
    <div v-if="$slots.step" :class="styles.steps()">
      <div v-for="index in state.totalSteps" :key="index" :class="styles.step()">
        <slot name="step" v-bind="stepProps(index - 1)" />
      </div>
    </div>

    <div :class="styles.content()">
      <div :key="state.currentStep.value">
        <ErrorBoundary>
          <SuspenseLoader :loaderProps="{ minHeight: 'h32' }">
            <slot v-bind="base" />
          </SuspenseLoader>
        </ErrorBoundary>
      </div>
    </div>
  </div>
</template>
