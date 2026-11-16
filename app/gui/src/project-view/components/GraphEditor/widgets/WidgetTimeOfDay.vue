<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import {
  parenthesisedApplication,
  unparenthesisedCode,
} from '@/components/GraphEditor/widgets/WidgetPicker/parentheses'
import PickerShell from '@/components/GraphEditor/widgets/WidgetPicker/PickerShell.vue'
import { isWholeNodeCall } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { hasDropdown } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import TimeOfDayMenu from '@/components/GraphEditor/widgets/WidgetTimeOfDay/TimeOfDayMenu.vue'
import {
  TIME_OF_DAY_TYPE,
  parseTimeExpression,
  timeExpressionCode,
  type TimeChoice,
} from '@/components/GraphEditor/widgets/WidgetTimeOfDay/timeExpression'
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

const choice = computed(() => parseTimeExpression(unparenthesisedCode(props.input)))

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

/** A node that is only a time: `Time_Of_Day.now`, `Time_Of_Day.new` with whatever arguments. */
function isWholeTimeNode(input: WidgetInput): boolean {
  return isWholeNodeCall(input, { bare: ['Time_Of_Day.now'], applied: ['Time_Of_Day.new'] })
}

/**
 * The date widget's counterpart for a `Time_Of_Day`-typed argument or item, or a whole node that is
 * a time (it takes no second dropdown where `WidgetSelection` already gives one): its own widgets show
 * the code (`Time_Of_Day.now`, or `Time_Of_Day.new` with `hour`, `minute` ports), and an arrow
 * under it opens a menu that replaces the whole value. Priority 52, after the date widget (51).
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 52,
    score: (props) =>
      !hasDropdown(props.input) && (isTimeTyped(props.input) || isWholeTimeNode(props.input)) ?
        Score.Perfect
      : Score.Mismatch,
  },
  import.meta.hot,
)
</script>

<template>
  <PickerShell class="WidgetTimeOfDay" :widget="props">
    <template #menu="{ close, done, setAccept }">
      <TimeOfDayMenu
        :choice="choice"
        :registerAccept="setAccept"
        @choose="choose($event, done)"
        @close="close"
      />
    </template>
  </PickerShell>
</template>
