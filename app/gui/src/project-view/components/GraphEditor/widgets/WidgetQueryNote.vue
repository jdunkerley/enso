<script setup lang="ts">
import { Score, defineWidget, widgetProps } from '$/providers/openedProjects/widgetRegistry'
import { useText } from '$/providers/text'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import GrowingSpinner from '@/components/shared/GrowingSpinner.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import TooltipTrigger from '@/components/TooltipTrigger.vue'
import { WidgetQueryNoteKey } from '@/util/callTree'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { getText } = useText()
const note = computed(() => props.input[WidgetQueryNoteKey])
const title = computed(() =>
  note.value.kind === 'unavailable' ?
    getText('widgetQueryUnavailable', note.value.dependency)
  : getText('widgetQueryLoading'),
)
</script>

<script lang="ts">
/**
 * An argument shown with its fallback (its type's widget, or none) instead of the widget its
 * resolver computes: a marker whose tooltip says why, then the argument as drawn without the
 * resolver's widget. `unavailable`: an argument the resolver reads is an error (the engine logged
 * it once at Info). `loading`: the resolver has not answered within `RESOLVER_TIME_BOX_MS`; its
 * widget replaces the fallback when it does.
 */
export const widgetDefinition = defineWidget(
  WidgetQueryNoteKey,
  { priority: 3, score: Score.Perfect },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetQueryNote widgetParent">
    <TooltipTrigger>
      <template #default="triggerProps">
        <!-- A span, not the icon itself: `TooltipTrigger` reacts only to an `HTMLElement`. -->
        <span
          v-bind="triggerProps"
          class="marker"
          role="img"
          :aria-label="title"
          :data-testid="`widget-query-note-${note.kind}`"
        >
          <GrowingSpinner v-if="note.kind === 'loading'" :size="12" phase="loading-medium" />
          <SvgIcon v-else name="info" />
        </span>
      </template>
      <template #tooltip>{{ title }}</template>
    </TooltipTrigger>
    <NodeWidget :input="props.input" />
  </div>
</template>

<style scoped>
.WidgetQueryNote {
  gap: var(--widget-token-pad-unit);
}
.marker {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.7;
}
</style>
