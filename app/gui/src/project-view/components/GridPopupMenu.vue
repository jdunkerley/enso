<script setup lang="ts">
/**
 * A small floating popup rendering a flat `GridMenuItem[]` list — the grids' context and column
 * menus (AG Grid Community has no menu renderer of its own). Positioning and dismissal mirror
 * `@/components/ContextMenu.vue`.
 */
import MenuButton from '@/components/MenuButton.vue'
import MenuPanel from '@/components/MenuPanel.vue'
import { useResizeObserver } from '@/composables/events'
import { injectInteractionHandler } from '@/providers/interactionHandler'
import { endOnClickOutside, targetIsOutside } from '@/util/autoBlur'
import { autoUpdate, flip, shift, useFloating } from '@floating-ui/vue'
import { unrefElement, useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GridMenuItem } from './shared/AgGridTableView/gridPopupMenuItems'

const {
  items,
  point,
  focusFirst = false,
} = defineProps<{
  items: GridMenuItem[]
  /** Location to display the menu near, in client coordinates. */
  point: { x: number; y: number }
  /**
   * Put the focus on the first item when the menu opens, for a menu asked for from the keyboard.
   * The arrow keys, Home and End then move between the items, and Escape asks to close.
   */
  focusFirst?: boolean
}>()
const emit = defineEmits<{
  /** `pointer` when the pointer closed it (a click outside, a right-click on it), not a key or an item. */
  close: [reason?: 'pointer']
}>()

const menu = ref<HTMLElement>()
// `true` here means "don't throw if no ancestor provided this" — required because `GridPopupMenu`
// is also mounted from `TableVisualization`, which lives inside an `enso-visualization-host-N`
// *custom element*. Vue 3 only inherits `provide()`s from an ancestor that is itself a
// `VueElement`; this custom element's DOM ancestors are plain elements, so none of ProjectView's
// providers (the interaction handler included) reach it — `VisualizationHost.vue` provides only
// `initializeActions()`/`provideVisualizationConfig(...)` for exactly this reason (see its own
// source). Without this, mounting the popup there throws during setup and no menu appears at all.
// When the handler IS available (the `WidgetTableEditor` column-menu path), it's still used, so
// dismissal there is unchanged; otherwise `onWindowPointerDown` below is the fallback.
const interaction = injectInteractionHandler(true)

const virtualEl = computed(() => {
  const { x, y } = point
  return {
    getBoundingClientRect() {
      return {
        width: 0,
        height: 0,
        x,
        y,
        top: y,
        left: x,
        right: x,
        bottom: y,
      }
    },
  }
})
const { floatingStyles, update } = useFloating(virtualEl, menu, {
  placement: 'bottom-start',
  middleware: [flip(), shift({ crossAxis: true })],
  whileElementsMounted: autoUpdate,
})

const menuSize = useResizeObserver(menu)
watch(menuSize, update)

function activate(item: Extract<GridMenuItem, { type: 'item' }>) {
  if (item.disabled) return
  item.action()
  emit('close')
}

/** The items that can take the focus. */
function enabledButtons(): HTMLElement[] {
  const panel = unrefElement(menu)
  return panel == null ?
      []
    : Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled)'))
}

/**
 * The keys of a menu: the arrows (wrapping), Home and End move the focus, Escape and Tab close. A
 * key the menu uses goes no further, so the graph beneath does not also move or deselect.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  const buttons = enabledButtons()
  const current = buttons.indexOf(document.activeElement as HTMLElement)
  let target: HTMLElement | undefined
  switch (event.key) {
    case 'ArrowDown':
      target = buttons[(current + 1) % buttons.length]
      break
    case 'ArrowUp':
      target = buttons[(current <= 0 ? buttons.length : current) - 1]
      break
    case 'Home':
      target = buttons[0]
      break
    case 'End':
      target = buttons[buttons.length - 1]
      break
    case 'Escape':
    case 'Tab':
      event.preventDefault()
      event.stopPropagation()
      emit('close')
      return
    case 'Enter':
    case ' ':
      // The button does the activating (a click); the graph's own Enter bindings must not also act.
      event.stopPropagation()
      return
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
  target?.focus()
}

// The popup is placed from a click point and the keyboard is not its own: close it on Escape, and
// when anything scrolls (it would otherwise float over content that moved away from the click) —
// as the tree visualization's menu does. `scroll` does not bubble, so a capturing listener is the
// only way to see every scroller; scrolling inside the popup itself is not a reason to close it.
// A scroll inside a shadow root never reaches `window`: such a host (the grid) closes the popup
// itself on its own scroll event.
// Escape is listened for in the capture phase too: the grid stops a prevented key event from
// bubbling (`AgGridTableView`'s `stopIfPrevented`), and AG Grid prevents Escape on a focused cell,
// so a bubbling listener on `window` never saw it (found by the Playwright spec for #814).
//
// A scroll event is delivered at the next frame, after the scroll itself. The right-click that
// opened the popup may have scrolled something (the browser scrolls a focused element into view),
// and that event arrives after the popup has mounted — a user does not scroll in that first frame,
// so scrolls are only taken as the user's once it has passed. (A `requestAnimationFrame` callback
// runs after the frame's scroll events.) Without this, such a menu was closed ~30 ms after it
// opened, which failed the sorted-table Playwright spec on Linux CI.
const settled = ref(false)
let settleFrame: number | undefined
onMounted(() => {
  settleFrame = requestAnimationFrame(() => {
    settled.value = true
  })
})
onUnmounted(() => {
  if (settleFrame != null) cancelAnimationFrame(settleFrame)
})
// A key pressed inside the menu (a keyboard-opened one has the focus there) is the menu's own
// `onKeydown`'s: it stops the key reaching the graph and asks to close once. This capture listener
// runs first and would ask a second time, so it leaves those keys alone.
useEventListener(
  window,
  'keydown',
  (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    const panel = unrefElement(menu)
    if (event.target instanceof Node && panel?.contains(event.target)) return
    emit('close')
  },
  { capture: true },
)
useEventListener(
  window,
  'scroll',
  (event: Event) => {
    if (settled.value && targetIsOutside(event, menu.value)) emit('close')
  },
  { capture: true, passive: true },
)

onMounted(() => {
  if (focusFirst) void nextTick(() => enabledButtons()[0]?.focus())
  if (interaction) {
    const menuInteraction = endOnClickOutside(menu, {
      cancel: () => emit('close', 'pointer'),
      end: () => emit('close', 'pointer'),
    })
    interaction.setCurrent(menuInteraction)
  } else {
    // Fallback dismissal when there's no interaction handler to hook into (see `interaction`'s
    // declaration above). Capture-phase, mirroring how `App.vue` wires the handler-backed path's
    // own `pointerdown` listener (`interaction.handlePointerDown`) the same way.
    window.addEventListener('pointerdown', onWindowPointerDown, { capture: true })
  }
})

onUnmounted(() => {
  if (!interaction)
    window.removeEventListener('pointerdown', onWindowPointerDown, { capture: true })
})

function onWindowPointerDown(event: PointerEvent) {
  if (targetIsOutside(event, menu.value)) emit('close', 'pointer')
}

/**
 * A `contextmenu` event on the menu closes it (a right-click on it, as `ContextMenu.vue` does). The
 * context-menu key is different: on Windows the browser fires its `contextmenu` on key *up*, at
 * the focused element, which by then is the first item of the menu that the key *down* opened, and
 * would close it at once. So a keyboard-opened menu ignores a `contextmenu` that no pointer press
 * on the menu came before.
 */
let pointerPressed = false
function onPointerDown() {
  pointerPressed = true
}
function onContextMenu() {
  if (focusFirst && !pointerPressed) return
  emit('close', 'pointer')
}
</script>

<template>
  <Teleport to="#floatingLayer">
    <MenuPanel
      ref="menu"
      class="GridPopupMenu"
      :style="floatingStyles"
      data-testid="gridPopupMenu"
      @keydown="onKeydown"
      @pointerdown.capture="onPointerDown"
      @contextmenu.stop.prevent="onContextMenu"
    >
      <template v-for="(item, index) in items" :key="index">
        <div v-if="item.type === 'separator'" class="separator" />
        <MenuButton v-else :disabled="item.disabled" class="entry" @activate="activate(item)">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-if="item.icon" class="icon" v-html="item.icon" />
          <!-- Keep the gutter when an item has no icon, so labels stay aligned in a menu that
               mixes the two (e.g. the column menu's autosize entries alongside Remove Column). -->
          <span v-else class="icon" aria-hidden="true" />
          <span class="name" v-text="item.name" />
          <span v-if="item.shortcut" class="shortcut" v-text="item.shortcut" />
        </MenuButton>
      </template>
    </MenuPanel>
  </Teleport>
</template>

<style scoped>
.GridPopupMenu {
  position: absolute;
  top: 0;
  left: 0;
  height: fit-content;
  width: fit-content;
  min-width: 160px;
}
.entry {
  display: flex;
  align-items: center;
  justify-content: left;
  padding-left: 8px;
  padding-right: 8px;
  width: 100%;
}
.icon {
  display: inline-flex;
  /* Fixed, so an item without an icon still reserves the gutter and labels line up. Matches the
     16x16 sprite `menuIconHtml` emits. */
  flex: none;
  width: 16px;
  margin-right: 8px;
}
.name {
  flex: 1;
}
.shortcut {
  margin-left: auto;
  padding-left: 2em;
  opacity: 0.8;
}
.separator {
  height: 1px;
  margin: 4px 0;
  background: var(--color-menu-entry-hover-bg);
}
</style>
