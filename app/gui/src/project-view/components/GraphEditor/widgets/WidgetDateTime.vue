<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import DateTimeMenu from '@/components/GraphEditor/widgets/WidgetDateTime/DateTimeMenu.vue'
import {
  dateTimeExpressionCode,
  keptDateTimeArguments,
  parseDateTimeExpression,
  withKeptArguments,
  type DateTimeChoice,
} from '@/components/GraphEditor/widgets/WidgetDateTime/dateTimeExpression'
import {
  parenthesisedApplication,
  unparenthesisedCode,
} from '@/components/GraphEditor/widgets/WidgetPicker/parentheses'
import PickerShell from '@/components/GraphEditor/widgets/WidgetPicker/PickerShell.vue'
import {
  isWholeNodeCall,
  type CallShapes,
} from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { hasDropdown } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module } = useCurrentProject()

const dateTimeImport = computed(() =>
  requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create(
      'Standard.Base' as QualifiedName,
      'Data.Time.Date_Time.Date_Time' as QualifiedName,
    ),
  ),
)

const code = computed(() => unparenthesisedCode(props.input))
const choice = computed(() => parseDateTimeExpression(code.value))
/** What an edit keeps, also when year … minute are computed and `choice` is undefined. */
const keptArguments = computed(() => keptDateTimeArguments(code.value))

/** One choice is one edit, so one undo step; an edit keeps the value's second, finer parts and zone. */
function choose(picked: DateTimeChoice, done: () => void) {
  const kept = withKeptArguments(picked, choice.value ?? keptArguments.value)
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, dateTimeImport.value)
    const code = dateTimeExpressionCode(kept)
    const value =
      kept.kind === 'dateTime' ?
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
const DATE_TIME_CALLS: CallShapes = { bare: ['Date_Time.now'], applied: ['Date_Time.new'] }

function isDateTimeTyped(input: WidgetInput): boolean {
  return input.dynamicConfig?.kind === 'Date_Time_Input'
}

/** A node that is only a date-time: `Date_Time.now`, or `Date_Time.new` with whatever arguments. */
function isWholeDateTimeNode(input: WidgetInput): boolean {
  return isWholeNodeCall(input, DATE_TIME_CALLS)
}

/**
 * The date and time-of-day widgets' counterpart for an argument or item configured `Date_Time_Input`, or a
 * whole node that is a date-time (no second dropdown where `WidgetSelection` gives one): its own
 * widgets show the code (`Date_Time.now`, or `Date_Time.new` with its ports), and an arrow under it
 * opens a menu of `Date_Time.now`, a calendar and a time field. Priority 53, after the time-of-day
 * widget (52).
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 53,
    score: (props) =>
      (
        !hasDropdown(props.input) &&
        (isDateTimeTyped(props.input) || isWholeDateTimeNode(props.input))
      ) ?
        Score.Perfect
      : Score.Mismatch,
  },
  import.meta.hot,
)
</script>

<template>
  <PickerShell class="WidgetDateTime" :widget="props">
    <template #menu="{ close, done, setAccept }">
      <DateTimeMenu
        :choice="choice"
        :registerAccept="setAccept"
        @choose="choose($event, done)"
        @close="close"
      />
    </template>
  </PickerShell>
</template>
