<script setup lang="ts">
/**
 * @file A date picker bound to a form field holding an `@internationalized/date` value, styled by
 * `DATE_PICKER_STYLES`.
 *
 * It is a Reka `DatePicker`: the date is typed segment by
 * segment (`role="spinbutton"` segments; digits fill them, ArrowUp/ArrowDown change them,
 * ArrowLeft/ArrowRight and Tab move between them, Backspace clears), and the chevron button opens
 * a calendar grid navigated with the arrow keys, Enter selecting a day and Escape closing it. Dates
 * are written in ISO order, 24-hour, with English placeholders; the calendar speaks
 * the user's locale. The `x`
 * button clears the value (not shown when `isRequired`, unless `noResetButton` says otherwise).
 */
import Button from '$/components/Button/Button.vue'
import { POPOVER_MOTION, POPOVER_STYLES } from '$/components/Dialog/variants'
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import {
  CALENDAR_CELL_VUE_STATES,
  DATE_PICKER_STYLES,
  DATE_SEGMENT_VUE_STATES,
} from '$/components/Inputs/dateVariants'
import { portalTarget } from '$/components/portal'
import Text from '$/components/Text/Text.vue'
import { TEXT_STYLE } from '$/components/Text/variants'
import { useText } from '$/providers/text'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { DateValue } from '@internationalized/date'
import {
  DatePickerAnchor,
  DatePickerCalendar,
  DatePickerCell,
  DatePickerCellTrigger,
  DatePickerContent,
  DatePickerField,
  DatePickerGrid,
  DatePickerGridBody,
  DatePickerGridHead,
  DatePickerGridRow,
  DatePickerHeadCell,
  DatePickerHeader,
  DatePickerHeading,
  DatePickerInput,
  DatePickerNext,
  DatePickerPrev,
  DatePickerRoot,
  DatePickerTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { isoSegments, segmentText, type Segment, type SegmentPart } from './dateSegments'

type DatePickerVariants = VariantProps<typeof DATE_PICKER_STYLES>

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    defaultValue?: DateValue | undefined
    /** The latest date that may be picked; later days are disabled in the calendar. */
    maxValue?: DateValue | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    isInvalid?: boolean | undefined
    /** Hide the button that clears the value. Default: `isRequired`. */
    noResetButton?: boolean | undefined
    noCalendarHeader?: boolean | undefined
    granularity?: 'day' | 'hour' | 'minute' | 'second' | undefined
    /** The earliest date that may be chosen: earlier days are disabled in the calendar. */
    minValue?: DateValue | undefined
    /** Leave out a zoned value's time zone segment. */
    hideTimeZone?: boolean | undefined
    /** Segments to leave out, as `{ day: false }`. */
    segments?: Partial<Record<SegmentPart, boolean>> | undefined
    size?: DatePickerVariants['size']
    rounded?: DatePickerVariants['rounded']
    /** The accessible name, when there is no `label`. */
    ariaLabel?: string | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { isRequired: false, isInvalid: undefined, noResetButton: undefined, segments: () => ({}) },
)

const { getText } = useText()

const field = useField<DateValue | null | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const value = computed({
  get: () => field.value.value ?? null,
  set: (date: DateValue | null | undefined) => field.onChange(date ?? null),
})
const shownSegments = computed(() => props.segments ?? {})
const invalid = computed(() => props.isInvalid ?? field.isInvalid.value)
const showReset = computed(() => !(props.noResetButton ?? props.isRequired))
const styles = computed(() => DATE_PICKER_STYLES({ size: props.size, rounded: props.rounded }))
const popoverStyles = computed(() => POPOVER_STYLES({ size: 'auto' }))
const textStyles = TEXT_STYLE()

function segmentClass(part: SegmentPart, text: string) {
  return styles.value.dateSegment({
    className: `${part === 'literal' && text === ' ' ? 'w-1.5' : ''} ${textStyles} ${DATE_SEGMENT_VUE_STATES}`,
  })
}
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isRequired="isRequired"
    :isInvalid="invalid"
    :fullWidth="true"
    :preventLabelFocus="true"
    :ids="field.ids"
    :testId="testId"
  >
    <DatePickerRoot
      v-model="value"
      :hourCycle="24"
      v-bind="{
        ...(granularity != null ? { granularity } : {}),
        ...(minValue != null ? { minValue } : {}),
        ...(maxValue != null ? { maxValue } : {}),
      }"
      :hideTimeZone="hideTimeZone === true"
      :disabled="field.isDisabled.value"
      :required="isRequired === true"
      :closeOnSelect="true"
    >
      <div :class="styles.base({ className: props.class })" :data-invalid="invalid || undefined">
        <!-- The calendar opens below the field's start, as if the whole field were its trigger,
        not centred on the chevron. -->
        <DatePickerAnchor asChild>
          <DatePickerField
            v-slot="{ segments: fieldSegments }"
            :class="styles.inputContainer()"
            :aria-label="ariaLabel ?? label"
            :aria-invalid="invalid || undefined"
            :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
            @focusout="field.onBlur"
          >
            <div :class="styles.dateInput()">
              <template v-for="(segment, i) in isoSegments(fieldSegments as Segment[])" :key="i">
                <DatePickerInput
                  v-if="shownSegments[segment.part as SegmentPart] !== false"
                  :part="segment.part"
                  :class="segmentClass(segment.part as SegmentPart, segment.value)"
                >
                  {{ segmentText(segment.part as SegmentPart, segment.value) }}
                </DatePickerInput>
              </template>
            </div>
            <DatePickerTrigger asChild>
              <Button
                variant="icon"
                icon="chevron_right"
                :class="styles.calendarButton()"
                :tooltip="false"
              />
            </DatePickerTrigger>
            <Button
              v-if="showReset"
              variant="icon"
              icon="close"
              :aria-label="getText('reset')"
              :class="styles.resetButton()"
              @press="value = null"
            />
          </DatePickerField>
        </DatePickerAnchor>

        <DatePickerContent
          align="start"
          :portal="{ to: portalTarget() }"
          :sideOffset="8"
          :class="`${popoverStyles.base({ className: styles.calendarPopover() })} ${POPOVER_MOTION}`"
        >
          <div :class="popoverStyles.dialog({ className: styles.calendarDialog() })">
            <DatePickerCalendar v-slot="{ weekDays, grid }" :class="styles.calendarContainer()">
              <DatePickerHeader :class="styles.calendarHeader()">
                <DatePickerPrev asChild>
                  <Button variant="icon" icon="chevron_right" class="rotate-180" :tooltip="false" />
                </DatePickerPrev>
                <DatePickerHeading :class="styles.calendarHeading()" />
                <DatePickerNext asChild>
                  <Button variant="icon" icon="chevron_right" :tooltip="false" />
                </DatePickerNext>
              </DatePickerHeader>
              <DatePickerGrid
                v-for="month in grid"
                :key="month.value.toString()"
                :class="styles.calendarGrid()"
              >
                <DatePickerGridHead v-if="!noCalendarHeader" :class="styles.calendarGridHeader()">
                  <DatePickerGridRow>
                    <!-- The header cells show no text, so the weekdays are for screen
                    readers only. -->
                    <DatePickerHeadCell
                      v-for="(day, i) in weekDays"
                      :key="i"
                      :class="styles.calendarGridHeaderCell()"
                    >
                      <span class="sr-only">{{ day }}</span>
                    </DatePickerHeadCell>
                  </DatePickerGridRow>
                </DatePickerGridHead>
                <DatePickerGridBody :class="styles.calendarGridBody()">
                  <DatePickerGridRow v-for="(week, w) in month.rows" :key="w">
                    <DatePickerCell v-for="date in week" :key="date.toString()" :date="date">
                      <DatePickerCellTrigger
                        :day="date"
                        :month="month.value"
                        :class="`${styles.calendarGridCell()} ${CALENDAR_CELL_VUE_STATES}`"
                      />
                    </DatePickerCell>
                  </DatePickerGridRow>
                </DatePickerGridBody>
              </DatePickerGrid>
              <!-- The calendar ends with an (empty) error message, which gives it 4px more. -->
              <Text />
            </DatePickerCalendar>
          </div>
        </DatePickerContent>
      </div>
    </DatePickerRoot>
  </Field>
</template>
