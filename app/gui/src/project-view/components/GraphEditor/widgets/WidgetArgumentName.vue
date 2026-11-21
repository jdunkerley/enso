<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { isRequiredArgument } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import RequiredArgumentArrow from '@/components/GraphEditor/widgets/WidgetArgumentName/RequiredArgumentArrow.vue'
import KindChip from '@/components/GraphEditor/widgets/WidgetKindPicker/KindChip.vue'
import {
  KindChipKey,
  chipReplacesValue,
} from '@/components/GraphEditor/widgets/WidgetKindPicker/kindChipKey'
import WidgetMultiSelection from '@/components/GraphEditor/widgets/WidgetMultiSelection.vue'
import WidgetSelection from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { injectPortInfo } from '@/providers/portInfo'
import { injectWidgetTree } from '@/providers/widgetTree'
import { injectWidgetUsageInfo, usageKeyForInput } from '@/providers/widgetUsageInfo'
import { Ast } from '@/util/ast'
import { ApplicationKind, ArgumentInfoKey } from '@/util/callTree'
import { computed, useTemplateRef } from 'vue'
import type { SuggestionEntryArgument } from 'ydoc-shared/languageServerTypes/suggestions'

const props = defineProps(widgetProps(widgetDefinition))

const currentProject = useCurrentProject()
const tree = injectWidgetTree()
const graph = computed(() => currentProject.graph.value)
const portInfo = injectPortInfo(true)
const parentUsageInfo = injectWidgetUsageInfo(true)
const usageKey = computed(() => usageKeyForInput(props.input))
const sameInputParentWidgets = computed(() =>
  parentUsageInfo?.usageKey === usageKey.value ? parentUsageInfo?.previouslyUsed : undefined,
)

const showArgumentValue = computed(() => {
  return (
    portInfo == null ||
    !portInfo.hasPersistedConnection ||
    (WidgetInput.isAst(props.input) && portInfo.portId !== props.input.value?.id)
  )
})

const missing = computed(
  () =>
    WidgetInput.isPlaceholder(props.input) && isRequiredArgument(props.input[ArgumentInfoKey].info),
)
const primary = computed(() => props.nesting < 2)

/** The kind picker's chip, handed down to stand between the name and the value. */
const kindChip = computed(() => props.input[KindChipKey])
const showValue = computed(
  () =>
    showArgumentValue.value &&
    !(kindChip.value && chipReplacesValue(kindChip.value, tree.showDetails)),
)

const innerInput = computed(() => ({
  ...props.input,
  [ArgumentNameShownKey]: true,
  [KindChipKey]: undefined,
}))

const childWidgetRef = useTemplateRef<typeof NodeWidget>('childWidgetRef')
const isChildWidgetEmpty = computed(() => !childWidgetRef.value?.isSelected)
const visuallyHideArrow = computed(() => portInfo?.isVisualTarget ?? false)
const showArrow = computed(() => {
  const selectionWidgetsShown =
    sameInputParentWidgets.value?.has(WidgetSelection) ||
    sameInputParentWidgets.value?.has(WidgetMultiSelection)
  const otherWidgetsCanBeShown = showArgumentValue.value && !isChildWidgetEmpty.value
  return missing.value && !selectionWidgetsShown && !otherWidgetsCanBeShown
})
</script>

<script lang="ts">
function hasKnownArgumentName(input: WidgetInput): input is WidgetInput & {
  value: Exclude<WidgetInput['value'], Ast.Token>
  [ArgumentInfoKey]: { info: SuggestionEntryArgument }
} {
  return !WidgetInput.isToken(input) && input[ArgumentInfoKey]?.info != null
}

/**
 * Whether an argument shows its parameter's name: every prefix argument, set or not, positional or
 * named, at any depth. No operand of an infix operator does: an operator chain reads as code
 * (`docs/superpowers/specs/2026-11-19-single-line-nodes-and-operator-chains-design.md`).
 */
function showsArgumentName(
  input: WidgetInput & {
    [ArgumentInfoKey]: { appKind: ApplicationKind; info: SuggestionEntryArgument }
  },
): boolean {
  if (WidgetInput.isPlaceholder(input)) return true
  return input[ArgumentInfoKey].appKind === ApplicationKind.Prefix
}

/** Whether `WidgetArgumentName` draws this input's parameter name (its own score). */
export function argumentNameShown(input: WidgetInput): boolean {
  return hasKnownArgumentName(input) && showsArgumentName(input)
}

export const widgetDefinition = defineWidget(
  hasKnownArgumentName,
  {
    priority: 100,
    score: (props) => (showsArgumentName(props.input) ? Score.Perfect : Score.Mismatch),
  },
  import.meta.hot,
)

export const ArgumentNameShownKey: unique symbol = Symbol.for('WidgetInput:ArgumentNameShown')
</script>

<template>
  <div class="WidgetArgumentName widgetParent widgetRounded" :class="{ primary, missing }">
    <RequiredArgumentArrow
      v-if="showArrow"
      :hide="visuallyHideArrow"
      @arrowClick="graph.createEdgeFromPort(props.input.portId, $event)"
    />
    <span class="name widgetSingleLine">
      <span class="widgetApplyPadding" :class="{ widgetRounded: missing }">{{
        props.input[ArgumentInfoKey].info.name
      }}</span>
    </span>
    <KindChip v-if="kindChip" v-bind="kindChip" />
    <NodeWidget v-if="showValue" ref="childWidgetRef" :input="innerInput" allowEmpty />
  </div>
</template>

<style scoped>
/* Each argument is a chip of its own: its parameter's name, small and dim, then its value. */
.WidgetArgumentName {
  gap: var(--widget-token-pad-unit);
  border-radius: var(--node-port-border-radius);
  background-color: color-mix(in srgb, currentColor 12%, transparent);
}

.name {
  /* Centred on the row like the values beside it; a small sans name sits low in a code-height box. */
  align-self: center;
  padding-bottom: 2px;
  opacity: 0.6;
  font-family: var(--font-sans);
  font-size: 12px;
  border-radius: var(--node-port-border-radius);
  transition:
    background-color,
    color,
    opacity 0.2s ease;
  .missing & {
    opacity: 1;
    background-color: var(--color-missing-value);
    color: var(--color-node-text-missing-value);
  }
}
</style>
