/**
 * @file The Vue `Stepper`, `Step`, `StepContent` and `useStepperState`: the step markers' states,
 * the current step's content, and moving between steps as the React stepper does.
 */
import {
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { h, nextTick } from 'vue'
import Step from '../Step.vue'
import StepContent from '../StepContent.vue'
import Stepper from '../Stepper.vue'
import { useStepperState } from '../useStepperState'

usePrimitiveTestEnvironment()

describe('Stepper', () => {
  test('shows each step marker with its state, and the current step content', async () => {
    const onCompleted = vi.fn()
    const { stepperState, currentStep } = useStepperState({ steps: 3, onCompleted })
    mountWithProviders(() =>
      h(
        Stepper,
        { state: stepperState },
        {
          step: (props: { index: number; isCurrent: boolean; isCompleted: boolean }) =>
            h(Step, { ...props, title: `Step ${props.index + 1}` } as never),
          default: ({ nextStep, isLast }: { nextStep: () => void; isLast: boolean }) => [
            h(StepContent, { index: 0 }, () => 'First'),
            h(StepContent, { index: 1 }, () => 'Second'),
            h(StepContent, { index: 2 }, () => 'Third'),
            h('button', { 'data-testid': 'next', onClick: nextStep }, isLast ? 'Finish' : 'Next'),
          ],
        },
      ),
    )
    const text = () => document.body.textContent ?? ''
    expect(text()).toContain('Step 1')
    expect(text()).toContain('Step 3')
    expect(text()).toContain('First')
    expect(text()).not.toContain('Second')

    const user = userEvent.setup()
    await user.click(document.querySelector('[data-testid="next"]')!)
    await nextTick()
    expect(currentStep.value).toBe(1)
    expect(text()).toContain('Second')
    // The completed first step shows a check instead of its number.
    expect(document.querySelector('[data-icon="check"]')).not.toBeNull()

    await user.click(document.querySelector('[data-testid="next"]')!)
    await nextTick()
    expect(text()).toContain('Finish')
    await user.click(document.querySelector('[data-testid="next"]')!)
    expect(onCompleted).toHaveBeenCalledOnce()
    expect(currentStep.value).toBe(2)
  })

  test('useStepperState clamps, reports changes and resets', () => {
    const onStepChange = vi.fn()
    const state = useStepperState({ steps: 3, defaultStep: 1, onStepChange })
    state.previousStep()
    expect(onStepChange).toHaveBeenCalledWith(0, 'back')
    state.previousStep()
    expect(state.currentStep.value).toBe(0)
    state.setCurrentStep(2)
    expect(state.isLastStep.value).toBe(true)
    expect(state.percentComplete.value).toBe(100)
    state.resetStepper()
    expect(state.currentStep.value).toBe(1)
  })
})
