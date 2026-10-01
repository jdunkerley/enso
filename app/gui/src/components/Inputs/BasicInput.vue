<script setup lang="ts">
/**
 * @file A styled text input without a form field: the Vue counterpart of the React `BasicInput`,
 * styled by the same `INPUT_STYLES`. `Input.vue` wraps it in a `Field`; `ComboBox.vue` uses it bare.
 *
 * The value is `v-model`. The addons and a custom icon are slots (`addonStart`, `addonEnd`, `icon`);
 * `icon` also takes an `icons.svg` name. Attributes (`name`, `autocomplete`, `aria-*`, native
 * listeners) go on the `<input>`, as React spreads its props onto it. Clicking anywhere in the box
 * focuses the input.
 */
import Icon from '$/components/Icon/Icon.vue'
import { INPUT_STYLES } from '$/components/Inputs/variants'
import Text from '$/components/Text/Text.vue'
import type { ExtractFunction, VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed, ref } from 'vue'
import { useAutoFocus } from './autoFocus'

type InputVariants = VariantProps<typeof INPUT_STYLES>

defineOptions({ inheritAttrs: false })

const {
  type = 'text',
  size,
  rounded,
  variant,
  variants = INPUT_STYLES,
  isInvalid = false,
  isDisabled = false,
  // `undefined`, not `false`: React passes it through unset, which adds no read-only class.
  readOnly = undefined,
  description,
  descriptionId,
  icon,
  placeholder,
  autoFocus = false,
  class: className,
} = defineProps<{
  type?: string | undefined
  size?: InputVariants['size']
  rounded?: InputVariants['rounded']
  variant?: InputVariants['variant']
  variants?: ExtractFunction<typeof INPUT_STYLES> | undefined
  isInvalid?: boolean | undefined
  isDisabled?: boolean | undefined
  readOnly?: boolean | undefined
  description?: string | undefined
  /** The description's id, so that the field can reference it from `aria-describedby`. */
  descriptionId?: string | undefined
  icon?: IconName | undefined
  placeholder?: string | undefined
  /** Focus the input on mount; `select` also selects its text. */
  autoFocus?: boolean | 'select' | undefined
  /** Classes for the `<input>`, as React's `className`. */
  class?: string | undefined
}>()

const model = defineModel<string | number | null | undefined>()

const input = ref<HTMLInputElement>()

const classes = computed(() =>
  variants({
    variant,
    size,
    rounded,
    invalid: isInvalid,
    readOnly,
    disabled: isDisabled,
  }),
)

useAutoFocus(
  input,
  () => autoFocus !== false,
  () => {
    if (autoFocus === 'select') input.value?.select()
  },
)

function onInput(event: Event) {
  model.value = (event.target as HTMLInputElement).value
}

defineExpose({ input, focus: () => input.value?.focus() })
</script>

<template>
  <div :class="classes.base()" @click="input?.focus({ preventScroll: true })">
    <div :class="classes.content()">
      <div v-if="$slots.addonStart" :class="classes.addonStart()" data-testid="addon-start">
        <slot name="addonStart" />
      </div>

      <slot name="icon">
        <Icon v-if="icon != null" :icon="icon" :class="classes.icon()" />
      </slot>

      <div :class="classes.inputContainer()">
        <input
          ref="input"
          v-bind="$attrs"
          :type="type"
          :value="model ?? ''"
          :placeholder="placeholder"
          :readonly="readOnly === true"
          :disabled="isDisabled"
          :aria-invalid="isInvalid ? 'true' : undefined"
          :class="classes.textArea({ className })"
          data-testid="input"
          @input="onInput"
        />
      </div>

      <div v-if="$slots.addonEnd" :class="classes.addonEnd()" data-testid="addon-end">
        <slot name="addonEnd" />
      </div>
    </div>

    <Text
      v-if="description != null"
      :id="descriptionId"
      :class="classes.description()"
      data-testid="description"
    >
      {{ description }}
    </Text>
  </div>
</template>
