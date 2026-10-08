<script setup lang="ts" generic="T">
/**
 * @file A styled dropdown that expands in place, styled by `DROPDOWN_STYLES`. The options are a
 * Reka `Listbox` (`role="listbox"`): Tab focuses the list and expands it, arrow keys and
 * typeahead move between options, Enter or Space selects. A mouse press on the dropdown toggles it;
 * a press elsewhere closes it.
 *
 * Each item is rendered by the default slot (`{ item }`), in the list and as the current value.
 * Single selection is `v-model:selectedIndex`; with `multiple` it is `v-model:selectedIndices`, and
 * the `multiple` slot (`{ items }`) shows the selection.
 * `FormDropdown.vue` binds one to a form field.
 */
import Icon from '$/components/Icon/Icon.vue'
import { DROPDOWN_OPTION_VUE_STATES, DROPDOWN_STYLES } from '$/components/Inputs/dropdownVariants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { useEventListener } from '@vueuse/core'
import { ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui'
import { computed, ref, watch } from 'vue'

type DropdownVariants = VariantProps<typeof DROPDOWN_STYLES>

const {
  items,
  multiple = false,
  readOnly = false,
  rounded,
  size,
  ariaLabel = 'Dropdown',
  class: className,
} = defineProps<{
  items: readonly T[]
  multiple?: boolean | undefined
  readOnly?: boolean | undefined
  rounded?: DropdownVariants['rounded']
  size?: DropdownVariants['size']
  /** The list's accessible name. */
  ariaLabel?: string | undefined
  class?: string | undefined
}>()

const selectedIndex = defineModel<number | null>('selectedIndex', { default: null })
const selectedIndices = defineModel<readonly number[]>('selectedIndices', { default: () => [] })

defineSlots<{
  default: (props: { item: T }) => unknown
  multiple?: (props: { items: readonly T[] }) => unknown
}>()

const root = ref<HTMLElement>()
const isFocusWithin = ref(false)
const isMouseFocused = ref(false)
/** Whether the last interaction was the keyboard. */
const isKeyboardModality = ref(false)

useEventListener(document, 'keydown', () => (isKeyboardModality.value = true), { capture: true })
useEventListener(
  document,
  'mousedown',
  (event) => {
    isKeyboardModality.value = false
    if (!(event.target instanceof Node) || !root.value?.contains(event.target)) {
      isMouseFocused.value = false
    }
  },
  { capture: true },
)

const isFocused = computed(() =>
  isKeyboardModality.value ? isFocusWithin.value : isMouseFocused.value,
)

const currentIndices = computed(() =>
  multiple ? selectedIndices.value
  : selectedIndex.value != null ? [selectedIndex.value]
  : [],
)
const selectedItems = computed(() =>
  currentIndices.value.flatMap((i) => (items[i] !== undefined ? [items[i] as T] : [])),
)
const displayedItem = computed(() =>
  selectedIndex.value == null ? undefined : items[selectedIndex.value],
)

const styles = computed(() =>
  DROPDOWN_STYLES({
    isFocused: isFocused.value,
    isReadOnly: readOnly,
    multiple,
    rounded,
    size,
  }),
)

const listModel = computed<number | number[] | null>({
  get: () => (multiple ? [...selectedIndices.value] : selectedIndex.value),
  set: (value) => {
    if (readOnly) return
    if (multiple) {
      selectedIndices.value = Array.isArray(value) ? value : []
    } else if (typeof value === 'number') {
      selectedIndex.value = value
      close()
    }
  },
})

function close() {
  isMouseFocused.value = false
  isKeyboardModality.value = false
  const active = document.activeElement
  if (active instanceof HTMLElement && root.value?.contains(active)) active.blur()
}

let wasFocused = false
watch(isFocused, (focused) => requestAnimationFrame(() => (wasFocused = focused)))

function onMouseDown(event: MouseEvent) {
  // A press on an option selects it (Reka selects on click), which closes a single dropdown.
  if (event.target instanceof Element && event.target.closest('[role="option"]') != null) return
  // Anywhere else it toggles: open when closed, closed when open.
  isMouseFocused.value = !wasFocused
}

/**
 * While it has a selection, the list takes the first Escape and stops the key there, so an
 * enclosing dialog closes only on the second Escape (kept from before the Vue port, #75). The
 * selection is not cleared.
 */
let escapeTaken = false
watch([selectedIndex, selectedIndices], () => (escapeTaken = false))
function onEscape(event: KeyboardEvent) {
  if (escapeTaken || currentIndices.value.length === 0) return
  escapeTaken = true
  event.stopPropagation()
}

function onFocusOut(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) {
    isFocusWithin.value = false
    isMouseFocused.value = false
    escapeTaken = false
  }
}
</script>

<template>
  <div
    ref="root"
    tabindex="-1"
    :class="styles.base({ className })"
    :data-focused="isFocused || undefined"
    @mousedown="onMouseDown"
    @focusin="isFocusWithin = true"
    @focusout="onFocusOut"
  >
    <div :class="styles.container()">
      <div :class="styles.options()">
        <!-- Spacing. -->
        <div :class="styles.input()">&nbsp;</div>
        <div :class="styles.optionsContainer()">
          <!-- `contents`, so that the grid row's item is the list itself, with `overflow-auto`: a
          scroll container, which the closed row collapses (its minimum height is 0). With
          the root as the item (`min-h-0`, before #198), the closed list overflowed it, and a nested
          dropdown at a fractional position lost its bottom border (the datalink editor's lists). -->
          <ListboxRoot
            v-model="listModel"
            class="contents"
            :multiple="multiple"
            :selectionBehavior="multiple ? 'toggle' : 'replace'"
            :disabled="readOnly"
          >
            <ListboxContent
              :class="styles.optionsList()"
              :aria-label="ariaLabel"
              @keydown.escape="onEscape"
            >
              <ListboxItem
                v-for="(item, i) in items"
                :key="i"
                :value="i"
                :class="`${styles.optionsItem()} ${DROPDOWN_OPTION_VUE_STATES}`"
              >
                <Icon
                  icon="check"
                  :class="styles.icon({ className: currentIndices.includes(i) ? '' : 'invisible' })"
                />
                <slot :item="item" />
              </ListboxItem>
            </ListboxContent>
          </ListboxRoot>
        </div>
      </div>
    </div>
    <div :class="styles.input()">
      <Icon icon="chevron_right" :class="styles.dropdownArrow()" />
      <div :class="styles.inputDisplay()">
        <template v-if="isMouseFocused && !multiple">&nbsp;</template>
        <slot v-else-if="displayedItem !== undefined" :item="displayedItem" />
        <slot v-else-if="multiple" name="multiple" :items="selectedItems" />
      </div>
    </div>
    <!-- Hidden, but required for the width of the parent element to be correct. -->
    <div :class="styles.hiddenOptions()" aria-hidden="true">
      <div v-for="(item, i) in items" :key="i" :class="styles.hiddenOption()">
        <Icon icon="check" />
        <slot :item="item" />
      </div>
    </div>
  </div>
</template>
