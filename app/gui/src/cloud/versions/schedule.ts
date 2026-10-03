/**
 * @file Helpers of the right panel's Schedule tab and its new-execution dialog: the user's preferred
 * time zone, ordinal numbers in the user's language, the query of a project's executions in a month
 * (with React's key and options), and the new-execution form's schema.
 */
import { useText } from '$/providers/text'
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import LocalStorage from '$/utils/LocalStorage'
import { getLocalTimeZone, now, toZoned, ZonedDateTime } from '@internationalized/date'
import { queryOptions } from '@tanstack/vue-query'
import {
  PROJECT_EXECUTION_REPEAT_TYPES,
  PROJECT_PARALLEL_MODES,
  type Backend,
  type ProjectExecutionInfo,
  type ProjectExecutionRepeatInfo,
  type ProjectId,
} from 'enso-common/src/services/Backend'
import {
  DAYS_PER_WEEK,
  getDay,
  getTimeZoneFromDescription,
  getWeekOfMonth,
  MONTHS_PER_YEAR,
  toRfc3339,
} from 'enso-common/src/utilities/data/dateTime'
import { computed, onScopeDispose, ref } from 'vue'
import * as z from 'zod'

/** The default maximum duration of an execution, in minutes. */
export const MAX_DURATION_DEFAULT_MINUTES = 60
/** The shortest maximum duration of an execution, in minutes. */
export const MAX_DURATION_MINIMUM_MINUTES = 1
/** The longest maximum duration of an execution, in minutes. */
export const MAX_DURATION_MAXIMUM_MINUTES = 180

/**
 * The new-execution form's schema, as React's: the time zone is chosen by its description, and the
 * repeat is built from the repeat type, the days or months, and the first occurrence.
 */
export const UPSERT_EXECUTION_SCHEMA = z
  .object({
    projectId: z.string().refine((_x: unknown): _x is ProjectId => true),
    repeatType: z.enum(PROJECT_EXECUTION_REPEAT_TYPES),
    days: z
      .number()
      .int()
      .min(0)
      .max(DAYS_PER_WEEK - 1)
      .array()
      .min(1)
      .transform((arr) => arr.sort((a, b) => a - b))
      .readonly(),
    months: z
      .number()
      .int()
      .min(0)
      .max(MONTHS_PER_YEAR - 1)
      .array()
      .min(1)
      .transform((arr) => arr.sort((a, b) => a - b))
      .readonly(),
    startDate: z.instanceof(ZonedDateTime).nullable().optional(),
    timeZone: z.string(),
    maxDurationMinutes: z
      .number()
      .int()
      .min(MAX_DURATION_MINIMUM_MINUTES)
      .max(MAX_DURATION_MAXIMUM_MINUTES),
    parallelMode: z.enum(PROJECT_PARALLEL_MODES),
    tag: z.string().optional(),
  })
  .transform(
    ({
      projectId,
      startDate = null,
      repeatType,
      maxDurationMinutes,
      parallelMode,
      days,
      months,
      timeZone: description,
      tag,
    }): ProjectExecutionInfo => {
      const timeZone = getTimeZoneFromDescription(description)
      const zonedStartDate = startDate == null ? now(timeZone) : toZoned(startDate, timeZone)
      const startDateTime = toRfc3339(new Date(zonedStartDate.toAbsoluteString()))
      const repeat = ((): ProjectExecutionRepeatInfo => {
        switch (repeatType) {
          case 'none':
          case 'daily': {
            return { type: repeatType }
          }
          case 'weekly': {
            return { type: repeatType, daysOfWeek: days }
          }
          case 'monthlyDate': {
            return { type: repeatType, date: zonedStartDate.day, months }
          }
          case 'monthlyWeekday': {
            return {
              type: repeatType,
              dayOfWeek: getDay(zonedStartDate),
              weekNumber: getWeekOfMonth(zonedStartDate.day),
              months,
            }
          }
          case 'monthlyLastWeekday': {
            return { type: repeatType, dayOfWeek: getDay(zonedStartDate), months }
          }
        }
      })()
      return {
        projectId,
        timeZone,
        repeat,
        maxDurationMinutes,
        parallelMode,
        startDate: startDateTime,
        endDate: null,
        tag,
      }
    },
  )

/** As React's `listProjectExecutionsQueryOptions` sets it. */
const PROJECT_EXECUTIONS_STALE_TIME = 60_000

/** Options for a query of a project's executions in a month (`month` counts from 1). */
export function projectExecutionsQueryOptions(
  backend: Backend,
  projectId: ProjectId,
  title: string,
  year: number,
  month: number,
) {
  return queryOptions({
    ...backendBaseOptions(backend),
    queryKey: backendQueryKey(backend, 'listProjectExecutions', [projectId, title, year, month]),
    queryFn: () => backend.listProjectExecutions(projectId, title, year, month),
    staleTime: PROJECT_EXECUTIONS_STALE_TIME,
    meta: { persist: true },
  })
}

/**
 * The time zone the user chose in the settings (`preferredTimeZone` in local storage), else the
 * system's. Follows changes to the setting.
 */
export function usePreferredTimeZone() {
  const localStorage = LocalStorage.getInstance()
  const preferred = ref(localStorage.get('preferredTimeZone'))
  onScopeDispose(localStorage.subscribe('preferredTimeZone', (value) => (preferred.value = value)))
  return computed(() => preferred.value ?? getLocalTimeZone())
}

/** A function writing a number as an ordinal ("1st", "2nd", …) in the user's language. */
export function useGetOrdinal() {
  const text = useText()
  const pluralRules = computed(() => new Intl.PluralRules(text.locale, { type: 'ordinal' }))
  return (n: number) => {
    const suffix =
      {
        one: text.getText('pluralOne'),
        two: text.getText('pluralTwo'),
        few: text.getText('pluralFew'),
        other: text.getText('pluralOther'),
      }[pluralRules.value.select(n) as string] ?? ''
    return `${n}${suffix}`
  }
}
