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
import DateMenu from '@/components/GraphEditor/widgets/WidgetDate/DateMenu.vue'
import {
  DATE_TYPE,
  dateExpressionCode,
  dateLabel,
  parseDateExpression,
  type DateChoice,
} from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module } = useCurrentProject()

const dateImport = computed(() =>
  requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create('Standard.Base' as QualifiedName, 'Data.Time.Date.Date' as QualifiedName),
  ),
)

const choice = computed(() => parseDateExpression(WidgetInput.valueRepr(props.input)))
const label = computed(() => (choice.value ? dateLabel(choice.value) : 'Pick a date'))

/** One choice is one edit, so one undo step: the import and the new code go in together. */
function choose(picked: DateChoice, done: () => void) {
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, dateImport.value)
    const value = codeToWrite(picked, props.input.value)
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
/** The code a choice writes: `Date.new 2020 1 15` is an application, so it may need parentheses. */
function codeToWrite(choice: DateChoice, current: WidgetInput['value']): string {
  const code = dateExpressionCode(choice)
  return choice.kind === 'date' ? parenthesisedApplication(code, current) : code
}

function isDateTyped(input: WidgetInput): boolean {
  return input.expectedType === DATE_TYPE || input[ArgumentInfoKey]?.info?.reprType === DATE_TYPE
}

/**
 * Priority 140: after `WidgetArgumentName` (100), which then draws the name, the required-argument
 * arrow and the missing-value style around the chip as it does for any placeholder, and before
 * `WidgetFunction` (200), which would otherwise take `Date.today` and `Date.new 2020 1 15` as calls
 * and draw `Date.new` with three number fields. It is also before the text and number widgets
 * (1001) that a Date-typed placeholder would otherwise get. `WidgetSelection` (50) and
 * `WidgetFileBrowser` (49) come first, so an argument with its own dropdown keeps it.
 *
 * The score is `Perfect` for the four shapes and for an unset Date-typed argument, and `Mismatch`
 * for everything else: a variable, a connected port or another expression is left to the widgets
 * that show it today.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 140,
    score: (props) => {
      const value = props.input.value
      if (value instanceof Ast.Ast)
        return isPickableShape(value, parseDateExpression) ? Score.Perfect : Score.Mismatch
      return isDateTyped(props.input) || parseDateExpression(value) != null ?
          Score.Perfect
        : Score.Mismatch
    },
  },
  import.meta.hot,
)
</script>

<template>
  <ChipMenuShell class="WidgetDate" :widget="props" :label="label" :placeholder="choice == null">
    <template #menu="{ close, done }">
      <DateMenu :choice="choice" @choose="choose($event, done)" @close="close" />
    </template>
  </ChipMenuShell>
</template>
