<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import type { UnionKind } from '$/providers/openedProjects/widgetRegistry/configuration'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import { argumentNameShown } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import KindChip from '@/components/GraphEditor/widgets/WidgetKindPicker/KindChip.vue'
import {
  KindChipKey,
  chipReplacesValue,
  type KindChipProps,
} from '@/components/GraphEditor/widgets/WidgetKindPicker/kindChipKey'
import {
  kindDefaultCode,
  matchKind,
} from '@/components/GraphEditor/widgets/WidgetKindPicker/kindMatch'
import { useKindImports } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindImports'
import { underKindPicker } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { injectWidgetTree } from '@/providers/widgetTree'
import { Ast } from '@/util/ast'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { module } = useCurrentProject()
const tree = injectWidgetTree()

const kinds = computed(() => unionKinds(props.input))
const chosenIndex = computed(() => matchKind(kinds.value, valueAst(props.input)))
const chip = computed<KindChipProps | undefined>(() =>
  chosenIndex.value == null ?
    undefined
  : { kinds: kinds.value, chosenIndex: chosenIndex.value, switchTo },
)
/**
 * Whether `WidgetArgumentName` draws the argument's name (it comes after the picker): the chip is
 * then handed to it, to stand between the name and the value, so the name is drawn in every state.
 */
const chipAfterName = computed(() => argumentNameShown(props.input))
const replacesValue = computed(() =>
  chip.value ? chipReplacesValue(chip.value, tree.showDetails) : false,
)

/**
 * The argument's own widget for the chosen kind (`Nothing` has none). The picker is excluded on the
 * same port, so it is not chosen again.
 */
const innerInput = computed<WidgetInput>(() => {
  const config = chip.value ? kinds.value[chip.value.chosenIndex]?.config : undefined
  return underKindPicker({
    ...props.input,
    dynamicConfig: config ?? undefined,
    ...(chipAfterName.value ? { [KindChipKey]: chip.value } : {}),
  })
})

const addKindImports = useKindImports()

/** Write the kind's default code, with its imports, as one edit (one undo step). */
function switchTo(kind: UnionKind) {
  const code = kindDefaultCode(kind.config)
  if (code == null) return
  module.value.edit((edit) => {
    addKindImports(edit, kind.config)
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value: code },
      directInteraction: true,
    })
  })
}
</script>

<script lang="ts">
function unionKinds(input: WidgetInput): readonly UnionKind[] {
  return input.dynamicConfig?.kind === 'Union' ? input.dynamicConfig.kinds : []
}

function valueAst(input: WidgetInput): Ast.Expression | undefined {
  return input.value instanceof Ast.Ast ? (input.value as Ast.Expression) : undefined
}

/** `Perfect` for a union whose kind the value is (or an unset argument); otherwise the picker steps aside. */
export function kindPickerScore(input: WidgetInput): Score {
  const kinds = unionKinds(input)
  if (kinds.length === 0) return Score.Mismatch
  return matchKind(kinds, valueAst(input)) == null ? Score.Mismatch : Score.Perfect
}

/**
 * The kind picker: in front of a union argument's value, the icon of the kind the value is, which on
 * a selected node is a button opening a list of the kinds. The value itself is drawn by the chosen
 * kind's own widget, so the node still shows its code. Where the argument shows its name, the icon
 * (`KindChip`) is drawn by `WidgetArgumentName`, between the name and the value. Priority 44: before
 * the widgets of the kinds (`WidgetFileBrowser` 49, `WidgetSelection` 50 …), which it wraps, and
 * so before `WidgetArgumentName` (100) too.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  { priority: 44, score: (props) => kindPickerScore(props.input) },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetKindPicker widgetParent">
    <KindChip v-if="chip && !chipAfterName" v-bind="chip" />
    <NodeWidget v-if="chipAfterName || !replacesValue" :input="innerInput" />
  </div>
</template>

<style scoped>
.WidgetKindPicker {
  display: inline-flex;
  align-items: center;
}
</style>
