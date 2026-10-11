<script setup lang="ts">
/**
 * @file What the labels popover shows when no label matches the search: a colour swatch and
 * "Create <search>", which creates a label of that name in that colour. The Vue port of the React
 * `NotFoundLabel`. The swatch ("Next color") starts at the least used colour, and each press moves
 * it to the next of `COLORS`.
 *
 * "Create …" is not a submit button of the popover's form: in React it carried a `form` attribute
 * naming no form (its form instance, as text), so neither a click on it nor Enter in the search
 * field submitted the popover's form through it.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
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

const form = useForm({
  schema: (z) => z.object({ color: z.custom<LChColor>() }),
  defaultValues: { color: leastUsedColor },
  onSubmit: ({ color }) => onCreateLabel(query, color),
})

const color = computed(() => form.watch('color') as LChColor)

function rotateColor() {
  const index = COLORS.findIndex((item) => colorsAreEqual(item, color.value))
  form.setValue('color', COLORS[(index + 1) % COLORS.length] ?? leastUsedColor)
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
