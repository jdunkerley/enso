/**
 * @file How a `CheckboxGroup.vue` tells the checkboxes inside it which values are selected, and
 * lets them toggle theirs: the Vue counterpart of the React `CheckboxGroupProvider`.
 */
import { createContextStore } from '@/providers'
import type { Ref } from 'vue'

/** What a checkbox group shares with its checkboxes. */
export interface CheckboxGroupContext {
  readonly name: string
  readonly selected: Readonly<Ref<readonly string[]>>
  readonly isDisabled: Readonly<Ref<boolean>>
  readonly isInvalid: Readonly<Ref<boolean>>
  readonly isReadOnly: Readonly<Ref<boolean>>
  readonly isRequired: Readonly<Ref<boolean>>
  readonly toggle: (value: string, selected: boolean) => void
  readonly onBlur: () => void
}

export const [provideCheckboxGroup, injectCheckboxGroup] = createContextStore(
  'CheckboxGroup',
  (context: CheckboxGroupContext) => context,
)
