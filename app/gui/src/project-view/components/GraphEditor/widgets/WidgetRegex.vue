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

const call = computed(() => astValue(props.input))
const pattern = computed(() => regexPattern(call.value))
/** The call's head as written (`regex`, `Regex.compile`, a qualified name); a pattern is only found in an application. */
const head = computed(() => (call.value instanceof Ast.App ? call.value.function : undefined))
const typed = ref('')

/** An empty commit writes nothing; otherwise one edit writes `regex '<text>'`, the text escaped. */
function commit() {
  const text = typed.value
  if (text === '') return
  typed.value = ''
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
 * The input of a regex argument: `regex '…'` shows the call as written, with the pattern edited in place by `WidgetText`;
 * an unset argument is an empty input that writes `regex '<text>'`.
 *
 * Priority 102: after `WidgetArgumentName` (100), which draws the argument's name in front of it (this
 * widget draws the call from its parts, so the name would be lost above it), and before
 * `WidgetFunction` (200), so the application is drawn by this widget and not as a generic call.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  { priority: 102, score: (props) => regexScore(props.input) },
  import.meta.hot,
)
</script>

<template>
  <div v-if="pattern && head" class="WidgetRegex widgetRounded">
    <NodeWidget :input="WidgetInput.FromAst(head)" />
    <NodeWidget :input="WidgetInput.FromAst(pattern)" />
  </div>
  <AutoSizedInput
    v-else
    v-model="typed"
    class="WidgetRegex widgetRounded widgetPill"
    placeholder=".*"
    @blur="commit"
  />
</template>

<style scoped>
/* Outlined as a call inside an argument is (`WidgetFunction`'s `.nestedCall`), so the head and the
   pattern read as one value: the outline takes no space, and the head keeps a rounding's padding. */
div.WidgetRegex {
  display: inline-flex;
  align-items: center;
  gap: var(--widget-token-pad-unit);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent);
  border-radius: var(--node-port-border-radius);
}

.WidgetRegex,
.WidgetRegex :deep(.cm-content) {
  font-family: var(--font-mono);
}
</style>
