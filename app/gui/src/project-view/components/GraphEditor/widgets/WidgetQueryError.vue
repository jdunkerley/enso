<script setup lang="ts">
import { Score, defineWidget, widgetProps } from '$/providers/openedProjects/widgetRegistry'
import { useText } from '$/providers/text'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import TooltipTrigger from '@/components/TooltipTrigger.vue'
import { WidgetQueryErrorKey } from '@/util/callTree'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { getText } = useText()
const title = computed(() => getText('widgetQueryError', props.input[WidgetQueryErrorKey].message))
</script>

<script lang="ts">
/**
 * An argument whose widget query failed (`Widget_Query.resolve_call` answered an error): a warning
 * marker whose tooltip is the error, then the argument as it would be drawn without a widget. The
 * engine logged the error, with its cause and stack, in the Logs panel.
 */
export const widgetDefinition = defineWidget(
  WidgetQueryErrorKey,
  { priority: 2, score: Score.Perfect },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetQueryError widgetParent">
    <TooltipTrigger>
      <template #default="triggerProps">
        <SvgIcon
          v-bind="triggerProps"
          class="marker"
          name="warning"
          role="img"
          :aria-label="title"
          data-testid="widget-query-error"
        />
      </template>
      <template #tooltip>{{ title }}</template>
    </TooltipTrigger>
    <NodeWidget :input="props.input" />
  </div>
</template>

<style scoped>
.WidgetQueryError {
  gap: var(--widget-token-pad-unit);
}
.marker {
  color: var(--color-warning);
  flex-shrink: 0;
}
</style>
