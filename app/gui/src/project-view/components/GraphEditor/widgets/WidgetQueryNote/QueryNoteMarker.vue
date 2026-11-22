<script setup lang="ts">
/**
 * The marker of a widget query note: an ⓘ ("choices unavailable") or a spinner ("loading"), with
 * the reason as its tooltip. As high as a value chip and centred on the row, like the kind
 * picker's icon, so it sits in the argument beside the value.
 */
import type { WidgetQueryNote } from '$/providers/openedProjects/widgetRegistry/configuration'
import { useText } from '$/providers/text'
import GrowingSpinner from '@/components/shared/GrowingSpinner.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import TooltipTrigger from '@/components/TooltipTrigger.vue'
import { computed } from 'vue'

const props = defineProps<{ note: WidgetQueryNote }>()
const { getText } = useText()
const title = computed(() =>
  props.note.kind === 'unavailable' ?
    getText('widgetQueryUnavailable', props.note.dependency)
  : getText('widgetQueryLoading'),
)
</script>

<template>
  <TooltipTrigger>
    <template #default="triggerProps">
      <!-- A span, not the icon itself: `TooltipTrigger` reacts only to an `HTMLElement`. -->
      <span
        v-bind="triggerProps"
        class="QueryNoteMarker"
        role="img"
        :aria-label="title"
        :data-testid="`widget-query-note-${note.kind}`"
      >
        <GrowingSpinner v-if="note.kind === 'loading'" :size="12" phase="loading-medium" />
        <SvgIcon v-else name="info" class="icon" />
      </span>
    </template>
    <template #tooltip>{{ title }}</template>
  </TooltipTrigger>
</template>

<style scoped>
/* The kind chip's box (`KindChip.vue`'s `.kindIcon`): a port high, so the row keeps its height
   and the glyph is centred on the values beside it. */
.QueryNoteMarker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  flex-shrink: 0;
  height: var(--node-port-height);
  padding: 0 calc(var(--widget-token-pad-unit) / 2);
  opacity: 0.7;
}

.icon {
  width: 14px;
  height: 14px;
}
</style>
