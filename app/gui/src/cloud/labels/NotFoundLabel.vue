<script setup lang="ts">
/**
 * @file What the labels popover shows when no label matches the search: a colour swatch and
 * "Create <search>", which creates a label of that name in that colour. The Vue port of the React
 * `NotFoundLabel`.
 *
 * Kept as React had it: the swatch ("Next color") does not change the colour. React's
 * `ColorSwitcher` set the next colour on the form around it (the popover's), not on this one, so
 * the swatch, and the colour the label is created with, stayed the least used colour. The button
 * still does the same, invisibly. Fixing it is a visible change, for a separate decision.
 *
 * "Create …" is not a submit button of the popover's form: in React it carried a `form` attribute
 * naming no form (its form instance, as text), so neither a click on it nor Enter in the search
 * field submitted the popover's form through it.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import { useFormContext } from '$/components/Form/formContext'
import { useForm } from '$/components/Form/useForm'
import { useText } from '$/providers/text'
import {
  COLORS,
  colorsAreEqual,
  lChColorToCssColor,
  type LChColor,
} from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { query, leastUsedColor, onCreateLabel } = defineProps<{
  query: string
  leastUsedColor: LChColor
  onCreateLabel: (name: string, color: LChColor) => Promise<void>
}>()

const { getText } = useText()

const outerForm = useFormContext()
const form = useForm({
  schema: (z) => z.object({ color: z.custom<LChColor>() }),
  defaultValues: { color: leastUsedColor },
  onSubmit: ({ color }) => onCreateLabel(query, color),
})

const color = computed(() => form.watch('color') as LChColor)

/** React's `ColorSwitcher`: it sets the next colour on the enclosing form, not on this one. */
function rotateColor() {
  const index = COLORS.findIndex((item) => colorsAreEqual(item, color.value))
  const nextColor = COLORS[(index + 1) % COLORS.length]
  outerForm.setValue('color' as never, nextColor ?? leastUsedColor)
}
</script>

<template>
  <ButtonGroup verticalAlign="center" gap="xxsmall" align="center" class="my-4">
    <Button
      variant="icon"
      size="custom"
      class="aspect-square h-4 w-4"
      :tooltip="getText('manageLabelsModal.nextColor')"
      :aria-label="getText('manageLabelsModal.nextColor')"
      :style="{ backgroundColor: lChColorToCssColor(color) }"
      @press="rotateColor"
    />

    <Button
      variant="icon"
      size="small"
      :isLoading="form.formState.isSubmitting"
      @press="form.submit()"
    >
      {{ getText('manageLabelsModal.createLabelWithTitle', query) }}
    </Button>
  </ButtonGroup>
</template>
