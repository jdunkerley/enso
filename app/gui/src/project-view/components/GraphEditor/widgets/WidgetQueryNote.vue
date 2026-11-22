<script setup lang="ts">
import { Score, defineWidget, widgetProps } from '$/providers/openedProjects/widgetRegistry'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import { argumentNameShown } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { NoteAfterNameKey } from '@/components/GraphEditor/widgets/WidgetQueryNote/noteAfterNameKey'
import QueryNoteMarker from '@/components/GraphEditor/widgets/WidgetQueryNote/QueryNoteMarker.vue'
import { WidgetQueryNoteKey } from '@/util/callTree'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const note = computed(() => props.input[WidgetQueryNoteKey])
/** Where `WidgetArgumentName` will draw the argument's name, the marker goes after it. */
const afterName = computed(() => argumentNameShown(props.input))
const innerInput = computed(() =>
  afterName.value ? { ...props.input, [NoteAfterNameKey]: note.value } : props.input,
)
</script>

<script lang="ts">
/**
 * An argument shown with its fallback (its type's widget, or none) instead of the widget its
 * resolver computes: a marker whose tooltip says why, then the argument as drawn without the
 * resolver's widget. `unavailable`: an argument the resolver reads is an error (the engine logged
 * it once at Info); an argument the call does not set is no error to show, and gets no note
 * (`withoutUnsetDependencyNotes`). `loading`: the resolver has not answered within
 * `RESOLVER_TIME_BOX_MS`; its widget replaces the fallback when it does. The marker stands inside
 * the argument's chip, after its name (`NoteAfterNameKey`), where the name is drawn; elsewhere (an
 * operand, a vector item) in front of the value.
 */
export const widgetDefinition = defineWidget(
  WidgetQueryNoteKey,
  { priority: 3, score: Score.Perfect },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetQueryNote widgetParent">
    <QueryNoteMarker v-if="!afterName" :note="note" />
    <NodeWidget :input="innerInput" />
  </div>
</template>

<style scoped>
.WidgetQueryNote {
  gap: var(--widget-token-pad-unit);
}
</style>
