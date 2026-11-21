<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import { regexPattern } from '@/components/GraphEditor/widgets/WidgetRegex/regexExpression'
import AutoSizedInput from '@/components/widgets/AutoSizedInput.vue'
import { Ast } from '@/util/ast'
import { computed, ref } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { module } = useCurrentProject()

const pattern = computed(() => regexPattern(astValue(props.input)))
const typed = ref('')

/** An empty commit writes nothing; otherwise one edit writes `regex '<text>'`, the text escaped. */
function commit() {
  const text = typed.value
  if (text === '') return
  module.value.edit((edit) => {
    const literal = Ast.TextLiteral.new(text, edit)
    const value = Ast.App.new(
      edit,
      Ast.Ident.new(edit, 'regex' as Ast.Identifier),
      undefined,
      literal,
    )
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value },
      directInteraction: true,
    })
  })
}
</script>

<script lang="ts">
/** The input's value when it is an expression. */
function astValue(input: WidgetInput): Ast.Expression | undefined {
  return input.value instanceof Ast.Ast ? (input.value as Ast.Expression) : undefined
}

/** The score of a `Regex_Input` argument holding `regex '…'` (or nothing); plain text is left to `WidgetText`. */
export function regexScore(input: WidgetInput): Score {
  if (input.dynamicConfig?.kind !== 'Regex_Input') return Score.Mismatch
  return input.value == null || regexPattern(astValue(input)) != null ?
      Score.Perfect
    : Score.Mismatch
}

/**
 * The input of a regex argument: `regex '…'` shows only its pattern, which `WidgetText` edits in place;
 * an unset argument is an empty input that writes `regex '<text>'`.
 *
 * Priority 48: after the kind picker (44) and `WidgetAnyToTarget` (45), before `WidgetFileBrowser` (49)
 * and `WidgetFunction` (200), so the application is drawn as the pattern and not as a call.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  { priority: 48, score: (props) => regexScore(props.input) },
  import.meta.hot,
)
</script>

<template>
  <NodeWidget v-if="pattern" class="WidgetRegex" :input="WidgetInput.FromAst(pattern)" />
  <AutoSizedInput
    v-else
    v-model="typed"
    class="WidgetRegex widgetRounded widgetPill"
    placeholder=".*"
    @blur="commit"
  />
</template>

<style scoped>
.WidgetRegex,
.WidgetRegex :deep(.cm-content) {
  font-family: var(--font-mono);
}
</style>
