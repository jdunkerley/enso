<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import ChipMenuShell from '@/components/GraphEditor/widgets/WidgetChip/ChipMenuShell.vue'
import {
  isPickableShape,
  parenthesisedApplication,
} from '@/components/GraphEditor/widgets/WidgetChip/shape'
import TimeOfDayMenu from '@/components/GraphEditor/widgets/WidgetTimeOfDay/TimeOfDayMenu.vue'
import {
  TIME_OF_DAY_TYPE,
  parseTimeExpression,
  timeExpressionCode,
  timeLabel,
  type TimeChoice,
} from '@/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module } = useCurrentProject()

const timeImport = computed(() =>
  requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create(
      'Standard.Base' as QualifiedName,
      'Data.Time.Time_Of_Day.Time_Of_Day' as QualifiedName,
    ),
  ),
)

const choice = computed(() => parseTimeExpression(WidgetInput.valueRepr(props.input)))
const label = computed(() => (choice.value ? timeLabel(choice.value) : 'Pick a time'))
/** An unset argument is drawn dimmed, as other widgets draw a default; its label is the default's. */
const dimmed = computed(() => choice.value == null || WidgetInput.isPlaceholder(props.input))
/** A default that is not one of the shapes (`Nothing`) is shown beside `Pick a time`, as code. */
const hint = computed(() =>
  choice.value == null && WidgetInput.isPlaceholder(props.input) ?
    WidgetInput.valueRepr(props.input)
  : undefined,
)

/** One choice is one edit, so one undo step: the import and the new code go in together. */
function choose(picked: TimeChoice, done: () => void) {
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, timeImport.value)
    const code = timeExpressionCode(picked)
    const value =
      picked.kind === 'time' ?
        parenthesisedApplication(code, props.input.value, props.input.portId)
      : code
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value },
      directInteraction: true,
    })
  })
  done()
}
</script>

<script lang="ts">
function isTimeTyped(input: WidgetInput): boolean {
  return (
    input.expectedType === TIME_OF_DAY_TYPE ||
    input[ArgumentInfoKey]?.info?.reprType === TIME_OF_DAY_TYPE
  )
}

/**
 * Priority 140, for the reasons the date widget's has: after `WidgetArgumentName` (100), which draws
 * the name and the missing-value style around the chip, and before `WidgetFunction` (200), which
 * would otherwise take `Time_Of_Day.new 14 30` as a call with number fields, and before the text and
 * number widgets (1001). `WidgetSelection` (50) and `WidgetFileBrowser` (49) come first.
 *
 * The score is `Perfect` for the shapes (`Time_Of_Day.now`, `Time_Of_Day.new` with two or three
 * integer literals) and for an unset Time_Of_Day-typed argument, and `Mismatch` for everything else.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 140,
    score: (props) => {
      const value = props.input.value
      if (value instanceof Ast.Ast)
        return isPickableShape(value, parseTimeExpression) ? Score.Perfect : Score.Mismatch
      return isTimeTyped(props.input) || parseTimeExpression(value) != null ?
          Score.Perfect
        : Score.Mismatch
    },
  },
  import.meta.hot,
)
</script>

<template>
  <ChipMenuShell
    class="WidgetTimeOfDay"
    :widget="props"
    :label="label"
    :placeholder="dimmed"
    :hint="hint"
  >
    <template #menu="{ close, done, setAccept }">
      <TimeOfDayMenu
        :choice="choice"
        :registerAccept="setAccept"
        @choose="choose($event, done)"
        @close="close"
      />
    </template>
  </ChipMenuShell>
</template>
