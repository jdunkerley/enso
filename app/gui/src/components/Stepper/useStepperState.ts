/**
 * @file The state of a `Stepper.vue`: the Vue counterpart of the React `useStepperState`, with the
 * same names and rules (steps are 0-indexed; going past the last step calls `onCompleted` instead).
 */
import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'

/** Options of {@link useStepperState}. */
export interface StepperStateOptions {
  /** The step to start on (0-indexed). */
  readonly defaultStep?: number
  /** The number of steps. */
  readonly steps: number
  readonly onStepChange?: (step: number, direction: 'back' | 'forward') => void
  readonly onCompleted?: () => void
}

/** What a `Stepper.vue` needs of its state. */
export interface StepperState {
  readonly currentStep: Readonly<Ref<number>>
  readonly totalSteps: number
  readonly goToStep: (step: number) => void
  readonly nextStep: () => void
  readonly previousStep: () => void
  readonly percentComplete: ComputedRef<number>
}

/** A stepper's state, and the helpers the React hook returns beside it. */
export function useStepperState(options: StepperStateOptions) {
  const { steps, defaultStep = 0, onStepChange, onCompleted } = options
  if (steps <= 0) throw new Error('Invalid number of steps')
  if (defaultStep < 0 || defaultStep >= steps) throw new Error('Invalid default step')

  const current = ref(defaultStep)

  function setCurrentStep(step: number | ((current: number) => number)) {
    const next = typeof step === 'function' ? step(current.value) : step
    const direction = next > current.value ? 'forward' : 'back'
    if (next < 0) {
      current.value = 0
    } else if (next > steps - 1) {
      onCompleted?.()
      current.value = steps - 1
    } else {
      onStepChange?.(next, direction)
      current.value = next
    }
  }

  const nextStep = () => setCurrentStep((step) => step + 1)
  const previousStep = () => setCurrentStep((step) => step - 1)
  const percentComplete = computed(() => (steps === 1 ? 100 : (current.value / (steps - 1)) * 100))

  const stepperState: StepperState = {
    currentStep: readonly(current),
    totalSteps: steps,
    goToStep: (step) => {
      if (step >= 0 && step < steps) setCurrentStep(step)
    },
    nextStep,
    previousStep,
    percentComplete,
  }

  return {
    stepperState,
    steps: Array.from({ length: steps }, (_, i) => i),
    currentStep: readonly(current),
    setCurrentStep,
    isCurrentStep: (step: number) => step === current.value,
    isFirstStep: computed(() => current.value === 0),
    isLastStep: computed(() => current.value === steps - 1),
    percentComplete,
    nextStep,
    previousStep,
    resetStepper: () => (current.value = defaultStep),
  }
}
