/** @file How a `Stepper.vue` shares its state with the `StepContent.vue`s inside it. */
import { createContextStore } from '@/providers'
import type { StepperState } from './useStepperState'

export const [provideStepper, injectStepper] = createContextStore(
  'Stepper',
  (state: StepperState) => state,
)
