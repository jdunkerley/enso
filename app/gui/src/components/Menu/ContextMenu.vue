<script setup lang="ts">
/**
 * @file A menu that opens at the pointer on a right click inside its trigger area, for the drive's
 * asset table.
 *
 * The trigger area is the `trigger` slot; the items are the default slot, the same `MenuItem`,
 * `MenuSection` and `MenuSeparator` as a `DropdownMenu` uses. It is a Reka `DropdownMenu`
 * positioned against the clicked point, so it has the same keyboard behaviour, closes on Escape or
 * an outside click, and also closes when anything outside it scrolls or is right-clicked.
 *
 * It is controlled (`v-model:open`), and exposes `open({ pageX, pageY })` and `close()` for
 * imperative callers, which open it from a row's own handler.
 * (Reka's own `ContextMenu` cannot be closed programmatically, which the drive needs.)
 */
import { portalTarget } from '$/components/portal'
import { useEventListener } from '@vueuse/core'
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, Slot } from 'reka-ui'
import { computed, ref } from 'vue'
import { MENU_STYLES } from './variants'

const {
  variant = 'light',
  isDisabled = false,
  testId = 'context-menu',
  class: className,
} = defineProps<{
  variant?: 'dark' | 'light' | undefined
  isDisabled?: boolean | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const isOpen = defineModel<boolean>('open', { default: false })

const classes = computed(() => MENU_STYLES({ variant, className }))

/** The point the menu opens at, in viewport coordinates. */
const point = ref({ x: 0, y: 0 })
/** A zero-size element at {@link point}, for the menu to be positioned against. */
const reference = computed(() => {
  const { x, y } = point.value
  return {
    getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
  }
})

function openAt(x: number, y: number) {
  point.value = { x, y }
  isOpen.value = true
}

function onContextMenu(event: MouseEvent) {
  if (isDisabled) return
  event.preventDefault()
  openAt(event.clientX, event.clientY)
}

function isInMenu(target: EventTarget | null) {
  return target instanceof Element && target.closest('[role="menu"]') != null
}

// It sits at a fixed point, so scrolling anything else, or right-clicking elsewhere, closes it.
useEventListener(
  document,
  'scroll',
  (event) => {
    if (isOpen.value && !isInMenu(event.target)) isOpen.value = false
  },
  { capture: true, passive: true },
)

defineExpose({
  /** Open the menu at a point in page coordinates, as if right-clicked there. */
  open(position: { pageX: number; pageY: number }) {
    openAt(position.pageX - window.scrollX, position.pageY - window.scrollY)
  },
  close() {
    isOpen.value = false
  },
})
</script>

<template>
  <DropdownMenuRoot v-model:open="isOpen">
    <Slot @contextmenu="onContextMenu">
      <slot name="trigger" />
    </Slot>
    <DropdownMenuPortal :to="portalTarget()">
      <DropdownMenuContent
        :reference="reference"
        side="right"
        align="start"
        :sideOffset="2"
        :class="classes"
        :data-testid="testId"
        loop
      >
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
