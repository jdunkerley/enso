<script setup lang="ts">
/**
 * @file One scheduled execution of a project on the Schedule tab's selected day: when it runs (and,
 * on hover, its repeat interval, time zone and, with the advanced options, its maximum duration),
 * the logs of the session it started, if any, and an actions menu to delete it. It is always
 * compact, as the calendar shows it.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DropdownMenu from '$/components/Menu/DropdownMenu.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import Text from '$/components/Text/Text.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useContainerData } from '$/providers/container'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import { backendMutationOptions } from '@/composables/backend'
import { now, parseAbsolute, toZoned, type ZonedDateTime } from '@internationalized/date'
import { useMutation } from '@tanstack/vue-query'
import {
  PROJECT_EXECUTION_REPEAT_TYPE_TO_TEXT_ID,
  type Backend,
  type ProjectAsset,
  type ProjectExecution,
  type ProjectSession,
} from 'enso-common/src/services/Backend'
import {
  DAY_3_LETTER_TEXT_IDS,
  DAY_TEXT_IDS,
  getDescriptionForTimeZone,
  getTimeZoneOffsetStringWithGMT,
  MONTH_3_LETTER_TEXT_IDS,
  zonedDateTimeToReadableIsoString,
} from 'enso-common/src/utilities/data/dateTime'
import { computed } from 'vue'
import { useGetOrdinal, usePreferredTimeZone } from './schedule'

const { backend, item, projectExecution, session, ...props } = defineProps<{
  backend: Backend
  item: ProjectAsset
  projectExecution: ProjectExecution
  /** Defaults to the first date of `projectExecution` if not given. */
  date?: ZonedDateTime | undefined
  session: ProjectSession | undefined
}>()

const MONTHS_IN_YEAR = 12
/** The execution's styles, compact as the calendar shows it (and always enabled). */
const PROJECT_EXECUTION_STYLES = tv({
  base: 'group flex flex-row gap-1 w-full rounded-default items-center odd:bg-primary/5 p-2',
  variants: {
    compact: { true: { base: 'px-2' } },
  },
  slots: {
    timeContainer: 'flex flex-row items-center gap-2 grow px-2 py-0.5',
    times: 'flex flex-col max-h-[10lh] overflow-auto grow',
  },
})
const styles = PROJECT_EXECUTION_STYLES({ compact: true })

const { getText } = useText()
const getOrdinal = useGetOrdinal()
const container = useContainerData()
const modals = useModals()
const timeZone = usePreferredTimeZone()
const enableAdvancedProjectExecutionOptions = useFeatureFlag(
  'enableAdvancedProjectExecutionOptions',
)

/** `hh:mm` with "am" or "pm", in the user's language. */
function timeOfDay(dateTime: ZonedDateTime) {
  const minuteString = String(dateTime.minute).padStart(2, '0')
  return getText(dateTime.hour > 11 ? 'xPm' : 'xAm', `${dateTime.hour % 12 || 12}:${minuteString}`)
}

const repeatString = computed(() => {
  if (props.date != null) return timeOfDay(toZoned(props.date, timeZone.value))
  const { repeat } = projectExecution
  const zonedStartDate = parseAbsolute(projectExecution.startDate, timeZone.value)
  const startDateDailyRepeat = timeOfDay(zonedStartDate)
  switch (repeat.type) {
    case 'none': {
      return zonedDateTimeToReadableIsoString(zonedStartDate)
    }
    case 'daily': {
      return `${startDateDailyRepeat} ${getText('everyDaySuffix')}`
    }
    case 'weekly': {
      const dayNames = repeat.daysOfWeek
        .map((day) => getText(DAY_3_LETTER_TEXT_IDS[day] ?? 'monday3'))
        .join(', ')
      return `${startDateDailyRepeat} ${dayNames}`
    }
    case 'monthlyDate':
    case 'monthlyWeekday':
    case 'monthlyLastWeekday': {
      const monthNames =
        repeat.months.length === MONTHS_IN_YEAR ?
          getText('everyMonth')
        : repeat.months
            .map((month) => getText(MONTH_3_LETTER_TEXT_IDS[month] ?? 'january3'))
            .join(', ')
      switch (repeat.type) {
        case 'monthlyDate': {
          return getText(
            'repeatsTimeXMonthsXDateX',
            startDateDailyRepeat,
            monthNames,
            getOrdinal(repeat.date),
          )
        }
        case 'monthlyWeekday': {
          return getText(
            'repeatsTimeXMonthsXDayXWeekX',
            startDateDailyRepeat,
            monthNames,
            getText(DAY_TEXT_IDS[repeat.dayOfWeek] ?? 'monday'),
            getText('xthWeek', getOrdinal(repeat.weekNumber)),
          )
        }
        case 'monthlyLastWeekday': {
          return getText(
            'repeatsTimeXMonthsXDayXLastWeek',
            startDateDailyRepeat,
            monthNames,
            getText(DAY_TEXT_IDS[repeat.dayOfWeek] ?? 'monday'),
          )
        }
      }
    }
  }
  return ''
})

const deleteProjectExecution = useMutation(
  backendMutationOptions('deleteProjectExecution', backend),
)

const maxDuration = computed(
  () =>
    `${getText('maxDurationLabel')}: ${getText('xMinutes', projectExecution.maxDurationMinutes)}`,
)
const repeatInterval = computed(
  () =>
    `${getText('repeatIntervalLabel')}: ${getText(
      PROJECT_EXECUTION_REPEAT_TYPE_TO_TEXT_ID[projectExecution.repeat.type],
    )}`,
)
const timeZoneDescription = computed(
  () =>
    `${getText('timeZoneLabel')}: ${getTimeZoneOffsetStringWithGMT(now(projectExecution.timeZone))} ${getDescriptionForTimeZone(projectExecution.timeZone)}`,
)

function askToDelete() {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('deleteThisProjectExecution'),
    onConfirm: () => deleteProjectExecution.mutateAsync([projectExecution.executionId, item.title]),
  })
}
</script>

<template>
  <div :class="styles.base()">
    <div :class="styles.timeContainer()">
      <VisualTooltip tooltipPlacement="left" :class="styles.times()">
        <div>{{ repeatString }}</div>
        <template #tooltip>
          <div>
            <Text v-if="enableAdvancedProjectExecutionOptions" color="inherit">
              {{ maxDuration }}
            </Text>
            <Text color="inherit">{{ repeatInterval }}</Text>
            <Text color="inherit">{{ timeZoneDescription }}</Text>
          </div>
        </template>
      </VisualTooltip>
      <ButtonGroup
        direction="row"
        gap="joined"
        class="shrink-0 grow-0"
        :buttonVariants="{ size: 'small', variant: 'outline' }"
      >
        <Button
          v-if="session"
          icon="log"
          @press="container.openProjectLogTab(session.projectSessionId, item.title)"
        >
          {{ getText('showLogs') }}
        </Button>
        <DropdownMenu placement="bottom" :offset="8">
          <template #trigger>
            <Button icon="chevron_down" iconPosition="end" variant="outline">
              <template v-if="!session" #default>{{ getText('actions') }}</template>
            </Button>
          </template>
          <MenuItem icon="trash" @select="askToDelete">{{ getText('delete') }}</MenuItem>
        </DropdownMenu>
      </ButtonGroup>
    </div>
  </div>
</template>
