<script setup lang="ts">
/**
 * @file The drive's search bar: a search field over a popover of the query's tags (`name:`,
 * `type:`, …), the labels (in the cloud) and suggestions for the term being typed. Its keyboard
 * behaviour:
 *
 * - typing anywhere on the drive (outside a text field and a modal) focuses the field;
 * - the arrow keys move through the suggestions, previewing each in the field, and Escape returns
 *   to what was typed; Enter, or a press on a suggestion, takes it;
 * - Shift with a press adds a suggestion and keeps the popover open (Shift again removes it);
 * - Escape otherwise leaves the field, keeping its text.
 *
 * The suggestions come from the table (`useSuggestions`), which knows the listed assets, the labels
 * and the users. The suggestion the arrow keys highlight takes the focus (it is focused whenever
 * the popover re-renders, which outlasts the field's own refocus): typing then goes nowhere until
 * the field is clicked, and Escape drops the focus.
 */
import { useSuggestions, type Suggestion } from '#/layouts/Drive/suggestions'
import DriveLabel from '#/pages/dashboard/components/DriveLabel.vue'
import Button from '$/components/Button/Button.vue'
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { useContainerData } from '$/providers/container'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import AssetQuery, { type AssetQueryKey } from '$/utils/AssetQuery'
import { backendQueryOptions } from '$/utils/backendQuery'
import { compareCaseInsensitive } from '$/utils/data/string'
import { isElementTextInput, isPotentiallyShortcut, isTextInputEvent } from '$/utils/event'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useQuery } from '@tanstack/vue-query'
import { useEventListener } from '@vueuse/core'
import type { Backend, Label as BackendLabel } from 'enso-common/src/services/Backend'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { computed, nextTick, onMounted, onUpdated, ref, shallowRef, watch } from 'vue'

const { backend, isCloud, query, setQuery } = defineProps<{
  backend: Backend | null
  isCloud: boolean
  query: AssetQuery
  setQuery: (query: AssetQuery) => void
}>()

const { getText } = useText()
const container = useContainerData()
const modals = useModals()
const { suggestions: rawSuggestions } = useSuggestions()

/** The query as of the start of moving through the suggestions. */
let baseQuery = query
let querySource: QuerySource = QuerySource.external

const suggestions = shallowRef<readonly Suggestion[]>(rawSuggestions.value)
const selectedIndex = ref<number | null>(null)
/** Whether the suggestions show, as rendered; see {@link setAreSuggestionsVisible}. */
const areSuggestionsVisible = ref(false)
/** Whether the suggestions are to show, at once. */
let suggestionsVisibleNow = false
/**
 * Show or hide the suggestions after anything else the event changed has rendered: so the table
 * re-renders for a new query while a suggestion still has the focus, and does not take the focus
 * from it (it takes the focus only from the body).
 */
function setAreSuggestionsVisible(value: boolean) {
  suggestionsVisibleNow = value
  void nextTick(() => {
    areSuggestionsVisible.value = suggestionsVisibleNow
  })
}
const selectedIndices = shallowRef<ReadonlySet<number>>(new Set())
const root = ref<HTMLLabelElement>()
const searchInput = ref<HTMLInputElement>()

const placeholder = computed(() =>
  isCloud ?
    isOnMacOS() ? getText('remoteBackendSearchPlaceholderMacOs')
    : getText('remoteBackendSearchPlaceholder')
  : getText('localBackendSearchPlaceholder'),
)

watch(rawSuggestions, (newSuggestions) => {
  if (querySource !== QuerySource.tabbing) suggestions.value = newSuggestions
})

/** Put the caret at the end of the field. */
function moveCaretToEnd() {
  const input = searchInput.value
  if (input == null) return
  const end = input.value.length
  input.setSelectionRange(end, end)
}

// The effects of a new query, in order, run after rendering.
watch(
  () => query,
  (newQuery) => {
    if (querySource !== QuerySource.tabbing) baseQuery = newQuery
    if (querySource !== QuerySource.tabbing) selectedIndex.value = null
    if (querySource !== QuerySource.internal && querySource !== QuerySource.tabbing) {
      if (searchInput.value != null) searchInput.value.value = newQuery.query
    }
    if (querySource !== QuerySource.typing && searchInput.value != null) {
      searchInput.value.value = newQuery.toString()
    }
    if (querySource !== QuerySource.tabbing) {
      baseQuery = newQuery
      querySource = QuerySource.external
    }
  },
  { flush: 'post' },
)

// Moving through the suggestions previews each one in the field.
watch(
  selectedIndex,
  (index) => {
    if (querySource === QuerySource.internal || querySource === QuerySource.tabbing) {
      let newQuery = query
      const suggestion = index == null ? null : suggestions.value[index]
      if (suggestion != null) {
        newQuery = suggestion.addToQuery(baseQuery)
        setQuery(newQuery)
      }
      searchInput.value?.focus()
      moveCaretToEnd()
      if (searchInput.value != null) searchInput.value.value = newQuery.toString()
      void nextTick(focusSelectedSuggestion)
    }
  },
  { flush: 'post' },
)

/** The suggestions' buttons, by index. */
const suggestionButtons = new Map<number, HTMLElement>()
function setSuggestionButton(element: unknown, index: number) {
  if (element instanceof HTMLElement) suggestionButtons.set(index, element)
  else suggestionButtons.delete(index)
}

/** Focus the highlighted suggestion, on every render of the popover. */
function focusSelectedSuggestion() {
  if (selectedIndex.value != null) suggestionButtons.get(selectedIndex.value)?.focus()
}
onUpdated(focusSelectedSuggestion)

onMounted(() => {
  if (searchInput.value != null) searchInput.value.value = query.query
})

useEventListener(root, 'keydown', (event: KeyboardEvent) => {
  if (!suggestionsVisibleNow) return
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopImmediatePropagation()
    querySource = QuerySource.tabbing
    const reverse = event.key === 'ArrowUp'
    const oldIndex = selectedIndex.value
    const length = Math.max(1, suggestions.value.length)
    selectedIndex.value =
      reverse ?
        oldIndex == null ?
          length - 1
        : (oldIndex + length - 1) % length
      : oldIndex == null ? 0
      : (oldIndex + 1) % length
  }
  if (
    event.key === 'Enter' ||
    (event.key === ' ' && document.activeElement !== searchInput.value)
  ) {
    querySource = QuerySource.external
    if (searchInput.value != null) {
      searchInput.value.focus()
      moveCaretToEnd()
    }
  }
  if (event.key === 'Enter') setAreSuggestionsVisible(false)
  if (event.key === 'Escape') {
    if (querySource === QuerySource.tabbing) {
      querySource = QuerySource.external
      setQuery(baseQuery)
      setAreSuggestionsVisible(false)
    } else {
      searchInput.value?.blur()
    }
  }
})

useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  // Allow `alt` to be held, in case it is being used to enter special characters.
  if (
    !isElementTextInput(event.target) &&
    (!(event.target instanceof Node) || root.value?.contains(event.target) !== true) &&
    isTextInputEvent(event) &&
    event.key !== ' ' &&
    event.key !== 'Delete' &&
    modals.stack.value.length === 0 &&
    container.focusedPanel.type === 'drive'
  ) {
    searchInput.value?.focus()
  }
  if (
    event.target instanceof Node &&
    root.value?.contains(event.target) === true &&
    isPotentiallyShortcut(event)
  ) {
    searchInput.value?.focus()
  }
})

/**
 * The field keeps to the query's `query`, not what the effects above wrote there: after moving
 * through the suggestions and pressing Escape, the field shows nothing, and on focus it shows the
 * query again, so typing goes on from it.
 */
function onInputFocus(event: FocusEvent) {
  const input = event.target as HTMLInputElement
  if (input.value !== query.query) input.value = query.query
}

function onInput(event: Event) {
  if (querySource !== QuerySource.internal) {
    querySource = QuerySource.typing
    setQuery(AssetQuery.fromString((event.target as HTMLInputElement).value))
  }
}

function onInputKeyDown(event: KeyboardEvent) {
  // Escape keeps a non-empty field, rather than letting the browser clear it.
  if (event.key === 'Escape' && (event.target as HTMLInputElement).value !== '') {
    event.preventDefault()
  }
  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    // Clone the query to refresh the results.
    setQuery(query.clone())
  }
}

function onRootFocusIn() {
  setAreSuggestionsVisible(true)
}

function onRootFocusOut(event: FocusEvent) {
  const next = event.relatedTarget
  if (!(next instanceof Node) || root.value?.contains(next) !== true) {
    if (querySource === QuerySource.tabbing) querySource = QuerySource.external
    setAreSuggestionsVisible(false)
  }
}

const tagNames = computed(() =>
  (isCloud ? AssetQuery.tagNames : AssetQuery.localTagNames).flatMap(([key, tag]) =>
    tag == null ? [] : [{ key, tag }],
  ),
)

function addTag(key: AssetQueryKey) {
  querySource = QuerySource.internal
  setQuery(query.add(key, ['']))
}

function pressSuggestion(index: number, suggestion: Suggestion, event: MouseEvent) {
  querySource = QuerySource.internal
  setQuery(
    selectedIndices.value.has(index) ?
      suggestion.deleteFromQuery(event.shiftKey ? query : baseQuery)
    : suggestion.addToQuery(event.shiftKey ? query : baseQuery),
  )
  if (event.shiftKey) {
    selectedIndices.value = new Set(
      selectedIndices.value.has(index) ?
        [...selectedIndices.value].filter((otherIndex) => otherIndex !== index)
      : [...selectedIndices.value, index],
    )
  } else {
    setAreSuggestionsVisible(false)
  }
}

const labelsQuery = useQuery(computed(() => backendQueryOptions(backend, 'listTags', [])))
const sortedLabels = computed(() =>
  [...(labelsQuery.data.value ?? [])].sort((a, b) => compareCaseInsensitive(a.value, b.value)),
)

function toggleLabel(label?: BackendLabel) {
  if (label == null) return
  querySource = QuerySource.internal
  setQuery(query.withToggled('labels', label.value))
}

const popoverClass = DIALOG_BACKGROUND({
  className:
    'absolute left-0 right-0 top-0 z-1 grid w-full overflow-hidden rounded-default border-0.5 border-primary/20 -outline-offset-1 outline-primary',
})
</script>

<script lang="ts">
/** The reason behind a new query. */
enum QuerySource {
  /**
   * A change from moving through the suggestions. While technically internal, it does not change
   * the base query.
   */
  tabbing = 'tabbing',
  /** A change made by this component. */
  internal = 'internal',
  /** A change from typing in the field. */
  typing = 'typing',
  /** A change made by another component. */
  external = 'external',
}
</script>

<template>
  <div class="relative w-full max-w-[60em]">
    <label
      ref="root"
      data-testid="asset-search-bar"
      class="group z-1 flex grow items-center gap-asset-search-bar rounded-full border-0.5 border-primary/50 py-[3.5px] pl-2 pr-1.5 text-primary"
      @focusin="onRootFocusIn"
      @focusout="onRootFocusOut"
    >
      <div class="relative size-4 placeholder" />
      <div v-if="areSuggestionsVisible" :class="popoverClass">
        <div class="overflow-hidden">
          <div class="relative mt-3 flex flex-col gap-3 pt-8">
            <!-- Tags (`name:`, `modified:`, …) -->
            <div
              data-testid="asset-search-tag-names"
              class="pointer-events-auto flex flex-wrap gap-2 whitespace-nowrap px-1.5"
            >
              <Button
                v-for="{ key, tag } in tagNames"
                :key="key"
                variant="outline"
                size="xsmall"
                class="min-w-12"
                @press="addTag(key)"
              >
                {{ tag + ':' }}
              </Button>
            </div>
            <!-- The labels -->
            <div
              v-if="isCloud && sortedLabels.length !== 0"
              data-testid="asset-search-labels"
              class="pointer-events-auto flex gap-2 px-1.5"
            >
              <DriveLabel
                v-for="label in sortedLabels"
                :key="label.id"
                :color="label.color"
                :label="label"
                :active="query.labels.some((term) => term === label.value)"
                :onPress="toggleLabel"
              >
                {{ label.value }}
              </DriveLabel>
            </div>
            <!-- Suggestions -->
            <div
              class="flex max-h-search-suggestions-list flex-col overflow-y-auto overflow-x-hidden pb-0.5 pl-0.5"
            >
              <button
                v-for="(suggestion, index) in suggestions"
                :key="suggestion.key"
                :ref="(element) => setSuggestionButton(element, index)"
                data-testid="asset-search-suggestion"
                type="button"
                :class="
                  twMerge(
                    'flex w-full cursor-pointer rounded-l-default rounded-r-sm px-[7px] py-0.5 text-left transition-[background-color] hover:bg-primary/5',
                    selectedIndices.has(index) && 'bg-primary/10',
                    index === selectedIndex && 'bg-selected-frame',
                  )
                "
                @click="pressSuggestion(index, suggestion, $event)"
              >
                <Text variant="body" truncate="1" class="w-full">
                  <component :is="() => suggestion.render()" />
                </Text>
              </button>
            </div>
          </div>
        </div>
      </div>
      <Icon
        icon="find"
        class="absolute left-2.5 top-[50%] z-1 -mt-[1px] -translate-y-1/2 text-primary"
      />
      <div
        class="relative grow before:text before:absolute before:-inset-x-1 before:my-auto before:rounded-full before:transition-all"
        :data-empty="query.query === '' ? 'true' : undefined"
      >
        <input
          ref="searchInput"
          :aria-label="getText('assetSearchFieldLabel')"
          type="search"
          size="1"
          :placeholder="placeholder"
          class="peer text relative z-1 w-full bg-transparent placeholder-primary/40"
          @focus="onInputFocus"
          @input="onInput"
          @keydown="onInputKeyDown"
        />
      </div>
    </label>
  </div>
</template>
