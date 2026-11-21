<script setup lang="ts">
/**
 * @file The kind picker's chip: the icon of the kind the value is, which on a selected node is a
 * button opening the list of the kinds. With `Nothing` chosen there is no icon: on a selected node
 * the chip is the `Nothing ▼` button standing in for the value, otherwise nothing at all.
 */
import type { UnionKind } from '$/providers/openedProjects/widgetRegistry/configuration'
import { kindIcon } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindIcon'
import { kindDefaultCode } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindMatch'
import { pickerMenuStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import SvgIcon from '@/components/SvgIcon.vue'
import DropdownWidget, { type DropdownEntry } from '@/components/widgets/DropdownWidget.vue'
import { unrefElement, useEvent } from '@/composables/events'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { injectWidgetTree } from '@/providers/widgetTree'
import { targetIsOutside } from '@/util/autoBlur'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  kinds: readonly UnionKind[]
  chosenIndex: number
  switchTo: (kind: UnionKind) => void
}>()

const tree = injectWidgetTree()
const popoverRoot = usePopoverRoot()

const chosen = computed<UnionKind | undefined>(() => props.kinds[props.chosenIndex])
const selected = computed(() => tree.showDetails)
const isNothing = computed(() => chosen.value?.config === null)
const icon = computed(() => (chosen.value ? kindIcon(chosen.value) : undefined))

const open = ref(false)
const buttonElement = useTemplateRef<HTMLElement>('buttonElement')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const { floatingStyles } = pickerMenuStyles(buttonElement, menuElement)

watch(selected, (isSelected) => {
  if (!isSelected) open.value = false
})

type KindEntry = DropdownEntry & { kind: UnionKind }
const entries = computed<KindEntry[]>(() =>
  props.kinds.flatMap((kind, index) =>
    kindDefaultCode(kind.config) == null ?
      []
    : [
        {
          value: kind.label,
          key: String(index),
          selected: index === props.chosenIndex,
          icon: kindIcon(kind),
          kind,
        },
      ],
  ),
)

function closeMenu(refocus: boolean) {
  open.value = false
  if (refocus) void nextTick(() => buttonElement.value?.focus())
}

useEvent(
  window,
  'pointerdown',
  (e) => {
    if (
      open.value &&
      targetIsOutside(e, unrefElement(menuElement)) &&
      targetIsOutside(e, unrefElement(buttonElement))
    )
      closeMenu(false)
  },
  { capture: true },
)
useEvent(
  window,
  'keydown',
  (e) => {
    if (open.value && e.key === 'Escape') {
      e.stopPropagation()
      closeMenu(true)
    }
  },
  { capture: true },
)

/** When the list opens, the focus goes to the current kind; the arrow keys then move it (Enter clicks). */
watch(open, (isOpen) => {
  if (!isOpen) return
  void nextTick(() => {
    const items = menuItems()
    ;(items.find((item) => item.classList.contains('selected')) ?? items[0])?.focus({
      preventScroll: true,
    })
  })
})

function menuItems(): HTMLElement[] {
  return Array.from(menuElement.value?.querySelectorAll<HTMLElement>('button.item') ?? [])
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  e.stopPropagation()
  const items = menuItems()
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  items[(current + step + items.length) % items.length]?.focus({ preventScroll: true })
}

watch(buttonElement, (element) => {
  // The chip may be a new instance by then (the edit changes the widget tree), hence the module-level record.
  if (element == null || pendingFocus == null || pendingFocus.node !== tree.externalId) return
  clearPendingFocus()
  element.focus()
})

function onEntry(entry: KindEntry) {
  closeMenu(true)
  if (entry.selected) return
  // The button stays the same element when both kinds have an icon: nothing is left to wait for.
  clearPendingFocus()
  pendingFocus = {
    node: tree.externalId,
    timer: setTimeout(() => (pendingFocus = undefined), 1000),
  }
  props.switchTo(entry.kind)
}
</script>

<script lang="ts">
/**
 * The node whose next chip button to appear takes the focus: a kind was just chosen there, and the
 * Nothing button and the icon button are different elements (of a chip that may itself be new, its
 * port being the new value's), which appear only once the edit has been applied.
 */
let pendingFocus: { node: unknown; timer: ReturnType<typeof setTimeout> } | undefined

function clearPendingFocus() {
  if (pendingFocus) clearTimeout(pendingFocus.timer)
  pendingFocus = undefined
}
</script>

<template>
  <span v-if="chosen && (selected || !isNothing)" class="KindChip" @keydown.enter.stop>
    <button
      v-if="selected"
      ref="buttonElement"
      type="button"
      class="kindButton"
      :class="{ nothingButton: isNothing }"
      :aria-label="`${chosen.label}, change kind`"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @pointerdown.stop
      @click.stop="open = !open"
    >
      <span v-if="isNothing">Nothing</span>
      <SvgIcon v-else-if="icon" :name="icon" class="kindSymbol" />
      <span v-else>{{ chosen.label }}</span>
      <SvgIcon name="arrow_right_head_only" class="kindArrow" />
    </button>
    <span v-else class="kindIcon" :title="chosen.label">
      <SvgIcon v-if="icon" :name="icon" class="kindSymbol" />
      <span v-else>{{ chosen.label }}</span>
    </span>
    <Teleport v-if="open && selected" :to="popoverRoot">
      <div
        ref="menuElement"
        class="menuElement widgetOutOfLayout"
        :style="floatingStyles"
        @keydown="onMenuKey"
      >
        <DropdownWidget class="outlined" :entries="entries" @clickEntry="onEntry" />
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.KindChip {
  display: inline-flex;
  align-items: center;
}

.kindIcon {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 4px;
  color: rgba(255 255 255 / 0.9);
  pointer-events: none;
}

.kindButton {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 3px 0 4px;
  gap: 1px;
  border: 0;
  border-radius: 9px;
  background: rgba(0 0 0 / 0.22);
  color: white;
  cursor: pointer;
  &:hover {
    background: rgba(0 0 0 / 0.34);
  }
}

.nothingButton {
  padding: 0 6px 0 8px;
  font-weight: bold;
}

.kindSymbol {
  width: 14px;
  height: 14px;
}

.kindArrow {
  width: 9px;
  height: 9px;
  transform: rotate(90deg);
  opacity: 0.9;
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}

.outlined {
  border: 1px solid color-mix(in oklab, var(--dropdown-bg), black 5%);
}
</style>
