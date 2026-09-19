<script setup lang="ts">
/**
 * A small floating popup rendering a flat `GridMenuItem[]` list — the Community-fallback
 * replacement for AG Grid Enterprise's native context/column menu renderer. Positioning and
 * dismissal mirror `@/components/ContextMenu.vue`.
 */
import MenuButton from '@/components/MenuButton.vue'
import MenuPanel from '@/components/MenuPanel.vue'
import { useResizeObserver } from '@/composables/events'
import { injectInteractionHandler } from '@/providers/interactionHandler'
import { endOnClickOutside, targetIsOutside } from '@/util/autoBlur'
import { autoUpdate, flip, shift, useFloating } from '@floating-ui/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GridMenuItem } from './shared/AgGridTableView/gridPopupMenuItems'

const { items, point } = defineProps<{
  items: GridMenuItem[]
  /** Location to display the menu near, in client coordinates. */
  point: { x: number; y: number }
}>()
const emit = defineEmits<{ close: [] }>()

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

onMounted(() => {
  if (interaction) {
    const menuInteraction = endOnClickOutside(menu, {
      cancel: () => emit('close'),
      end: () => emit('close'),
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
  if (targetIsOutside(event, menu.value)) emit('close')
}
</script>

<template>
  <Teleport to="#floatingLayer">
    <MenuPanel
      ref="menu"
      class="GridPopupMenu"
      :style="floatingStyles"
      data-testid="gridPopupMenu"
      @contextmenu.stop.prevent="emit('close')"
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
