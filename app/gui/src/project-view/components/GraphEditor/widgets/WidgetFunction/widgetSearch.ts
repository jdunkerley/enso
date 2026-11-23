/**
 * @file The search query of a searchable argument: while text is typed in its dropdown, a second
 * `resolve_call` visualization for that argument only, with `search` set to the text once typing
 * pauses for `SEARCH_DEBOUNCE_MS`. Latest wins: an answer whose `search` echo is not the current
 * text is ignored. With no text nothing is asked, and the node's own answer (the full list) shows.
 */
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { NodeVisualizationConfiguration } from '$/providers/openedProjects/project/executionContext'
import {
  widgetQueryAnswerSchema,
  type WidgetQueryAnswer,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { SEARCH_DEBOUNCE_MS } from '$/providers/openedProjects/widgetRegistry/widgetQueryPlan'
import type { ToValue } from '$/utils/reactivity'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { computed, onScopeDispose, shallowRef, toValue, watch, type ComputedRef } from 'vue'
import { stableByValue } from './stableConfig'

/** The text typed in one argument's dropdown. */
export interface SearchText {
  readonly argument: string
  readonly text: string
}

/**
 * The search query of the argument being edited (`typed`: its text, `undefined` or `''` text when
 * nothing is typed). `build` makes the query of one argument with a search text, from the node's
 * own query.
 */
export function useWidgetSearch(
  project: ToValue<Pick<ProjectStore, 'useVisualizationData'>>,
  build: (argument: string, search: string) => Opt<NodeVisualizationConfiguration>,
  typed: ToValue<SearchText | undefined>,
): { answer: ComputedRef<{ argument: string; answer: WidgetQueryAnswer } | undefined> } {
  const debounced = shallowRef<SearchText>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopTimer = () => {
    if (timer != null) clearTimeout(timer)
    timer = undefined
  }
  watch(
    () => {
      const value = toValue(typed)
      return value?.text ? `${value.argument}\u0000${value.text}` : ''
    },
    () => {
      stopTimer()
      const value = toValue(typed)
      if (!value?.text) {
        debounced.value = undefined
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        debounced.value = value
      }, SEARCH_DEBOUNCE_MS)
    },
    { flush: 'sync' },
  )
  onScopeDispose(stopTimer)

  const config = stableByValue(() => {
    const search = debounced.value
    return search && build(search.argument, search.text)
  })
  const data = toValue(project).useVisualizationData(config)

  const answer = computed(() => {
    const search = debounced.value
    const result = data.value
    if (search == null || result == null || !result.ok) return undefined
    const parsed = widgetQueryAnswerSchema.safeParse(result.value)
    if (!parsed.success || parsed.data.search !== search.text) return undefined
    return { argument: search.argument, answer: parsed.data }
  })
  return { answer }
}
