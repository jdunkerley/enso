<script setup lang="ts">
/**
 * @file The form scheduling a new execution of a project: its tag, time zone, first occurrence,
 * repeat interval (with the days or months it repeats on, and the next few occurrences), and with
 * the advanced options its parallel mode and maximum duration. A successful submission closes the
 * enclosing dialog.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import ComboBox from '$/components/Inputs/ComboBox.vue'
import DatePicker from '$/components/Inputs/DatePicker.vue'
import FormDropdown from '$/components/Inputs/FormDropdown.vue'
import Input from '$/components/Inputs/Input.vue'
import MultiSelector from '$/components/Inputs/MultiSelector.vue'
import Selector from '$/components/Inputs/Selector.vue'
import Text from '$/components/Text/Text.vue'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { endOfMonth, now, toZoned, type ZonedDateTime } from '@internationalized/date'
import { useMutation, useQuery } from '@tanstack/vue-query'
import {
  PARALLEL_MODE_TO_DESCRIPTION_ID,
  PARALLEL_MODE_TO_TEXT_ID,
  PROJECT_EXECUTION_REPEAT_TYPES,
  PROJECT_PARALLEL_MODES,
  type Backend,
  type ProjectAsset,
  type ProjectExecutionRepeatType,
} from 'enso-common/src/services/Backend'
import {
  firstProjectExecutionOnOrAfter,
  nextProjectExecutionDate,
} from 'enso-common/src/services/Backend/projectExecution'
import {
  DAY_3_LETTER_TEXT_IDS,
  DAY_TEXT_IDS,
  DAYS,
  DAYS_PER_WEEK,
  getDay,
  getDescriptionForTimeZone,
  getTimeZoneFromDescription,
  getTimeZoneOffsetStringWithGMT,
  getWeekOfMonth,
  IanaTimeZone,
  MONTH_3_LETTER_TEXT_IDS,
  MONTHS,
  WHITELISTED_TIME_ZONE_DESCRIPTIONS,
  zonedDateTimeToReadableIsoString,
} from 'enso-common/src/utilities/data/dateTime'
import { computed, watch } from 'vue'
import { versionTagsQueryOptions } from './queries'
import {
  MAX_DURATION_DEFAULT_MINUTES,
  MAX_DURATION_MAXIMUM_MINUTES,
  MAX_DURATION_MINIMUM_MINUTES,
  UPSERT_EXECUTION_SCHEMA,
  useGetOrdinal,
  usePreferredTimeZone,
} from './schedule'

const { backend, item, defaultDate } = defineProps<{
  backend: Backend
  item: ProjectAsset
  defaultDate?: ZonedDateTime | undefined
}>()

// "Monthly on the last weekday" is never offered.
const DISABLE_LAST_WEEKDAY_REPEAT_TYPE = true as boolean
const REPEAT_TIMES_COUNT = 3

const { getText } = useText()
const getOrdinal = useGetOrdinal()
const preferredTimeZone = usePreferredTimeZone()
const timeZone = IanaTimeZone(preferredTimeZone.value)
const timeZoneDescription = getDescriptionForTimeZone(timeZone)
const enableAdvancedProjectExecutionOptions = useFeatureFlag(
  'enableAdvancedProjectExecutionOptions',
)

// The start of today, when the form opens.
const minFirstOccurrence = now(timeZone).set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
const defaultStartDate = defaultDate ?? minFirstOccurrence

const createProjectExecution = useMutation(
  backendMutationOptions('createProjectExecution', backend),
)
const tagsQuery = useQuery(versionTagsQueryOptions(backend))

const form = useForm({
  method: 'dialog',
  schema: UPSERT_EXECUTION_SCHEMA,
  defaultValues: {
    projectId: item.id,
    repeatType: 'daily',
    parallelMode: 'restart',
    startDate: defaultStartDate,
    maxDurationMinutes: MAX_DURATION_DEFAULT_MINUTES,
    days: DAYS,
    months: MONTHS,
    timeZone: timeZoneDescription,
    tag: undefined,
  },
  onSubmit: async (values) => {
    await createProjectExecution.mutateAsync([values, item.title])
  },
})

const values = computed(() => form.watch())
const repeatType = computed(() => values.value.repeatType ?? 'daily')
const parallelMode = computed(() => values.value.parallelMode ?? 'restart')
const startDateValue = computed(() => values.value.startDate ?? defaultStartDate)
const formTimeZone = computed(() =>
  // `timeZone` may be `null` while the combo box is cleared.
  getTimeZoneFromDescription(values.value.timeZone ?? timeZoneDescription),
)
const date = computed(() => toZoned(startDateValue.value, formTimeZone.value))
const validRepeatTypes = computed(() => {
  const daysToEndOfMonth = endOfMonth(date.value).day - date.value.day
  return DISABLE_LAST_WEEKDAY_REPEAT_TYPE || daysToEndOfMonth >= DAYS_PER_WEEK ?
      PROJECT_EXECUTION_REPEAT_TYPES.filter((type) => type !== 'monthlyLastWeekday')
    : PROJECT_EXECUTION_REPEAT_TYPES
})

// Keep the first occurrence's instant in the chosen time zone, from the first render on.
watch(formTimeZone, (zone) => form.setValue('startDate', toZoned(startDateValue.value, zone)), {
  immediate: true,
})

/** The next few occurrences, once the form is valid. */
const repeatTimes = computed(() => {
  const parsed = UPSERT_EXECUTION_SCHEMA.safeParse(values.value)
  const projectExecution = parsed.data
  if (!projectExecution) return []
  let nextDate: ZonedDateTime | null = firstProjectExecutionOnOrAfter(projectExecution, date.value)
  const dates = date.value.compare(nextDate) !== 0 ? [nextDate] : []
  nextDate = nextProjectExecutionDate(projectExecution, nextDate)
  while (nextDate && dates.length < REPEAT_TIMES_COUNT) {
    dates.push(nextDate)
    nextDate = nextProjectExecutionDate(projectExecution, nextDate)
  }
  return dates
})

/** What a repeat type means for the chosen first occurrence. */
function repeatText(otherRepeatType: ProjectExecutionRepeatType) {
  const dayOfWeek = getText(DAY_TEXT_IDS[getDay(date.value)] ?? 'monday')
  switch (otherRepeatType) {
    case 'none': {
      return getText('doesNotRepeat')
    }
    case 'daily': {
      return getText('daily')
    }
    case 'weekly': {
      return getText('weekly')
    }
    case 'monthlyDate': {
      return getText('monthlyXthDay', getOrdinal(date.value.day))
    }
    case 'monthlyWeekday': {
      return getText('monthlyXthXDay', getOrdinal(getWeekOfMonth(date.value.day)), dayOfWeek)
    }
    case 'monthlyLastWeekday': {
      return getText('monthlyLastXDay', dayOfWeek)
    }
  }
}

/** A time zone's description, after its offset from GMT on the chosen date. */
function timeZoneOption(description: string) {
  const otherTimeZone = getTimeZoneFromDescription(description)
  return `${getTimeZoneOffsetStringWithGMT(toZoned(date.value, otherTimeZone))} ${description}`
}
</script>

<template>
  <Form :form="form" class="w-full">
    <ComboBox name="tag" :label="getText('tagLabel')" :items="tagsQuery.data.value ?? []" />
    <ComboBox
      isRequired
      name="timeZone"
      :label="getText('timeZoneLabel')"
      :items="WHITELISTED_TIME_ZONE_DESCRIPTIONS"
      :toTextValue="(otherTimeZone) => otherTimeZone"
      :toOptionText="timeZoneOption"
      class="w-full"
    >
      <template #addonStart>
        <Text class="w-20">{{ getTimeZoneOffsetStringWithGMT(toZoned(date, formTimeZone)) }}</Text>
      </template>
    </ComboBox>
    <DatePicker
      isRequired
      noCalendarHeader
      name="startDate"
      hideTimeZone
      :label="getText('firstOccurrenceLabel')"
      :minValue="minFirstOccurrence"
      class="w-full"
    />
    <FormDropdown
      v-slot="{ item: otherItem }"
      isRequired
      name="repeatType"
      :label="getText('repeatIntervalLabel')"
      :items="validRepeatTypes"
      size="medium"
      class="w-full"
    >
      {{ repeatText(otherItem) }}
    </FormDropdown>
    <MultiSelector
      v-if="repeatType === 'weekly'"
      isRequired
      name="days"
      :label="getText('daysLabel')"
      :items="DAYS"
      :toLabel="(n) => getText(DAY_3_LETTER_TEXT_IDS[n] ?? 'monday3')"
      variant="separate-outline"
    />
    <MultiSelector
      v-if="repeatType === 'monthlyDate' || repeatType === 'monthlyWeekday'"
      isRequired
      name="months"
      :label="getText('monthsLabel')"
      :items="MONTHS"
      :columns="6"
      :toLabel="(n) => getText(MONTH_3_LETTER_TEXT_IDS[n] ?? 'january3')"
      variant="separate-outline"
    />
    <div :class="repeatType === 'none' ? 'hidden' : ''">
      <Text>{{ getText('repeatsAt') }}</Text>
      <Text v-for="(dateTime, i) in repeatTimes" :key="i">
        {{ zonedDateTimeToReadableIsoString(dateTime) }}
      </Text>
      <Text>{{ getText('ellipsis') }}</Text>
    </div>
    <details v-if="enableAdvancedProjectExecutionOptions" class="w-full">
      <summary class="cursor-pointer">{{ getText('advancedOptions') }}</summary>
      <div class="flex w-full flex-col">
        <Selector
          isRequired
          name="parallelMode"
          :label="getText('parallelModeLabel')"
          :items="PROJECT_PARALLEL_MODES"
          :toLabel="(mode) => getText(PARALLEL_MODE_TO_TEXT_ID[mode])"
        />
        <Text>{{ getText(PARALLEL_MODE_TO_DESCRIPTION_ID[parallelMode]) }}</Text>
      </div>
      <Input
        name="maxDurationMinutes"
        type="number"
        :defaultValue="MAX_DURATION_DEFAULT_MINUTES"
        :min="MAX_DURATION_MINIMUM_MINUTES"
        :max="MAX_DURATION_MAXIMUM_MINUTES"
        :label="getText('maxDurationMinutesLabel')"
      />
    </details>

    <ButtonGroup>
      <Submit />
      <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
    </ButtonGroup>

    <FormError />
  </Form>
</template>
