/**
 * @file How a `RadioGroup.vue` shares its field with the radios inside it: the selected value, the
 * group's state, and which radio is being pressed, so that a selected radio can show that a sibling
 * is being pressed.
 */
import { createContextStore } from '@/providers'
import type { Ref } from 'vue'

/** What a radio group shares with its radios. */
export interface RadioGroupContext {
  readonly name: string
  readonly value: Readonly<Ref<string | undefined>>
  readonly isDisabled: Readonly<Ref<boolean>>
  readonly isInvalid: Readonly<Ref<boolean>>
  readonly isReadOnly: Readonly<Ref<boolean>>
  readonly isRequired: Readonly<Ref<boolean>>
  /** The value of the radio being pressed, if any. */
  readonly pressed: Ref<string | null>
  readonly select: (value: string) => void
  readonly onBlur: () => void
}

export const [provideRadioGroup, injectRadioGroup] = createContextStore(
  'RadioGroup',
  (context: RadioGroupContext) => context,
)
