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
import { endOnClickOutside } from '@/util/autoBlur'
import { autoUpdate, flip, shift, useFloating } from '@floating-ui/vue'
import { computed, onMounted, ref, watch } from 'vue'
import type { GridMenuItem } from './gridPopupMenuItems'

const { items, point } = defineProps<{
  items: GridMenuItem[]
  /** Location to display the menu near, in client coordinates. */
  point: { x: number; y: number }
}>()
const emit = defineEmits<{ close: [] }>()

const menu = ref<HTMLElement>()
const interaction = injectInteractionHandler()

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
  const menuInteraction = endOnClickOutside(menu, {
    cancel: () => emit('close'),
    end: () => emit('close'),
  })
  interaction.setCurrent(menuInteraction)
})
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
