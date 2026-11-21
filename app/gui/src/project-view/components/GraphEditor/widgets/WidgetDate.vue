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
import DateMenu from '@/components/GraphEditor/widgets/WidgetDate/DateMenu.vue'
import {
  dateExpressionCode,
  parseDateExpression,
  type DateChoice,
} from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
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

const choice = computed(() => parseDateExpression(unparenthesisedCode(props.input)))

/** One choice is one edit, so one undo step: the import and the new code go in together. */
function choose(picked: DateChoice, done: () => void) {
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, dateImport.value)
    const value = codeToWrite(picked, props.input.value, props.input.portId)
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
function codeToWrite(
  choice: DateChoice,
  current: WidgetInput['value'],
  portId: WidgetInput['portId'],
): string {
  const code = dateExpressionCode(choice)
  return choice.kind === 'date' ? parenthesisedApplication(code, current, portId) : code
}

function isDateTyped(input: WidgetInput): boolean {
  return input.dynamicConfig?.kind === 'Date_Input'
}

/** A node that is only a date: `Date.today`, `Date.new` with whatever arguments, and so on. */
function isWholeDateNode(input: WidgetInput): boolean {
  return isWholeNodeCall(input, {
    bare: ['Date.today', 'Date.yesterday', 'Date.tomorrow'],
    applied: ['Date.new'],
  })
}

/**
 * A dropdown around an argument or item configured `Date_Input`, or a whole node that is a date (`Date.today`,
 * `Date.new 2020 1 15`, even with a connected argument): its own widgets show the code (`Date.today`,
 * or `Date.new` with `year`, `month` and `day` ports), and an arrow under it opens a menu that
 * replaces the whole value. Any other untyped `Date.new ...` is drawn as any other expression.
 *
 * Priority 51, just after `WidgetSelection` (50) and `WidgetFileBrowser` (49): an argument with its
 * own dropdown keeps it (and does not get a second one: it scores `Mismatch`), and the widgets that
 * follow (argument name, function) draw the argument as they do under any dropdown.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 51,
    score: (props) =>
      !hasDropdown(props.input) && (isDateTyped(props.input) || isWholeDateNode(props.input)) ?
        Score.Perfect
      : Score.Mismatch,
  },
  import.meta.hot,
)
</script>

<template>
  <PickerShell class="WidgetDate" :widget="props">
    <template #menu="{ close, done, setAccept }">
      <DateMenu
        :choice="choice"
        :registerAccept="setAccept"
        @choose="choose($event, done)"
        @close="close"
      />
    </template>
  </PickerShell>
</template>
