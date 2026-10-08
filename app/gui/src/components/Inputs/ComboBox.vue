<script setup lang="ts" generic="T">
/**
 * @file A combo box bound to a form field: a text input that filters a list of items, the Vue
 * counterpart of the React `ComboBox`, styled by the same `COMBO_BOX_STYLES` and `INPUT_STYLES`.
 *
 * It is a Reka `Combobox`, which gives what react-aria's did: `role="combobox"` with
 * `aria-expanded` and `aria-controls`, typing filters and opens the list, ArrowDown/ArrowUp open it
 * and move through it, Enter selects, Escape closes it. The chevron button opens it too, and the
 * `x` button clears the typed text (unless `noResetButton`).
 *
 * Escape closes the list first (the WAI-ARIA combobox pattern), and the next Escape the dialog or
 * popover around it, even while the list is still fading out (see {@link onEscapeCapture}).
 *
 * The field holds the item itself. Each item needs a unique text: `toKey`, else `toTextValue`,
 * else the item when it is a string. `toTextValue` is what typing filters by; `toOptionText` what
 * an option shows, if different; `toTooltip` what the option's tooltip shows. The default slot (`{ item }`) renders an option; without it, the text.
 */
import Button from '$/components/Button/Button.vue'
import { POPOVER_MOTION, POPOVER_STYLES } from '$/components/Dialog/variants'
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { injectDialogContext } from '$/components/Dialog/dialogContext'
import { COMBO_BOX_STYLES } from '$/components/Inputs/comboBoxVariants'
import { INPUT_STYLES } from '$/components/Inputs/variants'
import { portalTarget } from '$/components/portal'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useText } from '$/providers/text'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import {
  ComboboxAnchor,
  ComboboxCancel,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { computed, ref, useSlots } from 'vue'

type ComboBoxVariants = VariantProps<typeof COMBO_BOX_STYLES>

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    items: readonly T[]
    toKey?: ((item: T) => string) | undefined
    toTextValue?: ((item: T) => string) | undefined
    toTooltip?: ((item: T) => string) | undefined
    /** The text an option shows, when not its `toTextValue`. React's `children` returning a string. */
    toOptionText?: ((item: T) => string) | undefined
    defaultValue?: T | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    placeholder?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    /** Hide the `x` button that clears the typed text. */
    noResetButton?: boolean | undefined
    size?: ComboBoxVariants['size']
    rounded?: ComboBoxVariants['rounded']
    /** The accessible name of the input and list, when there is no `label`. */
    ariaLabel?: string | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { noResetButton: false },
)

defineSlots<{
  default?: (props: { item: T }) => unknown
  addonStart?: (props: { item: T | undefined }) => unknown
  addonEnd?: (props: { item: T | undefined }) => unknown
}>()

const slots = useSlots()
const { getText } = useText()
const input = ref<InstanceType<typeof ComboboxInput>>()
const isChevronHovered = ref(false)
const viewport = ref<InstanceType<typeof ComboboxViewport>>()

const dialog = injectDialogContext(true)
const isOpen = ref(false)

/**
 * Escape, before the combo box sees it. While the closed list fades out, Reka keeps it as the
 * topmost dismissable layer, which would take the key and do nothing: the dialog or popover around
 * the combo box closes instead, as it does once the list has gone.
 */
function onEscapeCapture() {
  // The list's viewport is on the page from opening until the exit animation has ended.
  if (!isOpen.value && viewport.value != null) dialog?.close()
}

/**
 * On opening, scroll the selected item to the top of the list, as react-aria did. Reka scrolls it
 * only as far as needed (to the bottom), after the list has rendered.
 */
function onOpenChange(open: boolean) {
  isOpen.value = open
  if (!open) return
  setTimeout(() => {
    const element: unknown = viewport.value?.$el
    if (!(element instanceof HTMLElement)) return
    const selected = element.querySelector<HTMLElement>('[data-state="checked"]')
    if (selected == null) return
    element.scrollTop = selected.offsetTop
  })
}

const field = useField<T | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
  focus: () => (input.value?.$el as HTMLElement | undefined)?.focus(),
})

/** The item's text: `toTextValue`, else the item when it is a string. */
function textOf(item: T): string {
  const text = props.toTextValue?.(item) ?? (typeof item === 'string' ? item : null)
  if (text == null) throw new Error('Every element in a `ComboBox` must have a text value.')
  return text
}
const keyOf = (item: T) => props.toKey?.(item) ?? textOf(item)
const optionText = (item: T) => props.toOptionText?.(item) ?? textOf(item)

const itemsByKey = computed(() => new Map(props.items.map((item) => [keyOf(item), item])))

/** Reka works on string keys; the field holds the item. */
const selectedKey = computed<string | null>({
  get: () => {
    const value = field.value.value
    return value === undefined || value === null ? null : keyOf(value)
  },
  set: (key) => field.onChange(key == null ? undefined : itemsByKey.value.get(key)),
})

const styles = computed(() => COMBO_BOX_STYLES({ size: props.size, rounded: props.rounded }))
const inputStyles = computed(() => INPUT_STYLES({ size: 'custom', variant: 'custom' }))
const popoverStyles = computed(() => POPOVER_STYLES({ size: 'auto-xxsmall' }))
const accessibleName = computed(() => props.ariaLabel ?? props.label ?? 'Combo box')
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :fullWidth="true"
    :ids="field.ids"
    :testId="testId"
  >
    <ComboboxRoot
      v-model="selectedKey"
      :disabled="field.isDisabled.value"
      :class="styles.base({ className: props.class })"
      @focusout="field.onBlur"
      @update:open="onOpenChange"
      @keydown.esc.capture="onEscapeCapture"
    >
      <ComboboxAnchor :class="styles.inputContainer()">
        <!-- The field's `<label>` wraps this button, and it is the first control in it, so hovering
        anywhere on the field hovers it too (`:hover` reaches a label's control). React styled real
        pointer hovers only (react-aria's `data-hovered`), and so does this. -->
        <ComboboxTrigger asChild>
          <Button
            variant="icon"
            icon="chevron_right"
            class="rotate-90 data-[hovered]:bg-white hover:bg-transparent"
            :aria-label="getText('showSuggestions')"
            :tooltip="false"
            :data-hovered="isChevronHovered || undefined"
            @pointerenter="isChevronHovered = $event.pointerType === 'mouse'"
            @pointerleave="isChevronHovered = false"
          />
        </ComboboxTrigger>
        <div :class="inputStyles.base()">
          <div :class="inputStyles.content()">
            <div
              v-if="slots.addonStart"
              :class="inputStyles.addonStart()"
              data-testid="addon-start"
            >
              <slot name="addonStart" :item="field.value.value" />
            </div>
            <div :class="inputStyles.inputContainer()">
              <ComboboxInput
                ref="input"
                :name="name"
                :placeholder="placeholder"
                :displayValue="
                  (key: string) => (itemsByKey.get(key) != null ? textOf(itemsByKey.get(key)!) : '')
                "
                :aria-label="accessibleName"
                :aria-invalid="field.isInvalid.value || undefined"
                :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
                :class="inputStyles.textArea()"
                data-testid="input"
              />
            </div>
            <div v-if="slots.addonEnd" :class="inputStyles.addonEnd()" data-testid="addon-end">
              <slot name="addonEnd" :item="field.value.value" />
            </div>
          </div>
        </div>
        <!-- In the tab order, as react-aria's was; Reka takes it out. -->
        <ComboboxCancel v-if="!noResetButton" asChild>
          <Button
            variant="icon"
            icon="close"
            tabindex="0"
            :aria-label="getText('reset')"
            :class="styles.resetButton()"
          />
        </ComboboxCancel>
      </ComboboxAnchor>

      <!-- No list without items: react-aria's popover does not open on an empty list. -->
      <ComboboxPortal v-if="items.length > 0" :to="portalTarget()">
        <!-- As react-aria's: as wide as the input's box, at its start, and no taller than the space
        below it (less 12px), the list scrolling inside. React's `--trigger-width` excludes the 48px
        the shared variants add back. -->
        <ComboboxContent
          position="popper"
          align="start"
          :sideOffset="8"
          :collisionPadding="12"
          :aria-label="accessibleName"
          :class="`${popoverStyles.base({ className: styles.popover() })} ${POPOVER_MOTION} flex max-h-[var(--reka-combobox-content-available-height)] flex-col [--trigger-width:calc(var(--reka-combobox-trigger-width)_-_48px)] [&:not(:has([role=option]))]:hidden`"
        >
          <ComboboxViewport
            ref="viewport"
            :class="popoverStyles.dialog({ className: styles.listBox() })"
          >
            <ComboboxItem
              v-for="item in items"
              :key="keyOf(item)"
              :value="keyOf(item)"
              :textValue="textOf(item)"
              :class="styles.listBoxItem()"
            >
              <VisualTooltip
                v-if="slots.default"
                :tooltip="toTooltip?.(item) ?? textOf(item)"
                class="flex w-full"
              >
                <slot :item="item" />
              </VisualTooltip>
              <Text
                v-else
                truncate="1"
                class="w-full"
                :tooltip="toTooltip?.(item) ?? optionText(item)"
                tooltipPlacement="left"
              >
                {{ optionText(item) }}
              </Text>
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </Field>
</template>
