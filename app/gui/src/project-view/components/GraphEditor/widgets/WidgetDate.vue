<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import { ArgumentNameShownKey } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import DateMenu from '@/components/GraphEditor/widgets/WidgetDate/DateMenu.vue'
import {
  DATE_TYPE,
  dateExpressionCode,
  dateLabel,
  parseDateExpression,
  type DateChoice,
} from '@/components/GraphEditor/widgets/WidgetDate/dateExpression'
import { activityDropdownStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { unrefElement } from '@/composables/events'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { useTopLevelArgument } from '@/providers/topLevelArgument'
import { injectWidgetTree } from '@/providers/widgetTree'
import { Ast } from '@/util/ast'
import { targetIsOutside } from '@/util/autoBlur'
import { ArgumentInfoKey } from '@/util/callTree'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed, useTemplateRef } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { suggestionDb, module } = useCurrentProject()

const tree = injectWidgetTree()
const popoverRoot = usePopoverRoot()
const topLevelArgument = useTopLevelArgument(true)

const widgetRoot = useTemplateRef<HTMLElement>('widgetRoot')
const chip = useTemplateRef<HTMLElement>('chip')
const menuElement = useTemplateRef<HTMLElement>('menuElement')

const dateImport = computed(() =>
  requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create('Standard.Base' as QualifiedName, 'Data.Time.Date.Date' as QualifiedName),
  ),
)

const choice = computed(() => parseDateExpression(WidgetInput.valueRepr(props.input)))
const label = computed(() => (choice.value ? dateLabel(choice.value) : 'Pick a date'))

const argumentName = computed(() => {
  if (ArgumentNameShownKey in props.input) return
  return props.input[ArgumentInfoKey]?.info?.name
})

const floatReference = computed(
  () =>
    topLevelArgument?.enclosingTopLevelArgument(widgetRoot.value, tree.rootElement) ??
    widgetRoot.value,
)
const { floatingStyles } = activityDropdownStyles(floatReference, menuElement, popoverRoot)

const interaction = WidgetEditHandler.New(props, {
  pointerdown: (e) => {
    if (
      targetIsOutside(e, unrefElement(menuElement)) &&
      targetIsOutside(e, unrefElement(widgetRoot)) &&
      targetIsOutside(e, document.getElementById('floatingLayer'))
    )
      interaction.value.end()
  },
})

function toggleMenu() {
  if (interaction.value.isActive()) interaction.value.cancel()
  else interaction.value.start()
}

function closeMenu() {
  interaction.value.cancel()
  chip.value?.focus()
}

/** One choice is one edit, so one undo step: the import and the new code go in together. */
function choose(picked: DateChoice) {
  module.value.edit((edit) => {
    module.value.addMissingImports(edit, dateImport.value)
    const value = codeToWrite(picked, props.input.value)
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value },
      directInteraction: true,
    })
  })
  interaction.value.end()
  chip.value?.focus()
}
</script>

<script lang="ts">
/**
 * The code a choice writes. `Date.new 2020 1 15` is an application, so where it becomes an argument
 * it needs its parentheses: an unset argument, or a value that is itself an argument or an operand.
 * (As a string the new code is parsed in place; an application inserted unparenthesised there is
 * split into one group per argument.) Inside parentheses already, or on its own, it is bare.
 */
function codeToWrite(choice: DateChoice, current: WidgetInput['value']): string {
  const code = dateExpressionCode(choice)
  if (choice.kind !== 'date') return code
  const parent = current instanceof Ast.Ast ? current.parent() : undefined
  const needsParens =
    !(current instanceof Ast.Ast) || parent instanceof Ast.App || parent instanceof Ast.OprApp
  return needsParens ? `(${code})` : code
}

/**
 * Whether the expression is one of the four shapes the chip shows, and nothing is built on it.
 * `Date.today.add_days 3` and `Date.today + x` have a shape's code inside them, but their `Date.today`
 * is the target of a call, not a value to pick: the chip would replace the target.
 */
function isDateShape(ast: Ast.Ast): boolean {
  if (!(ast instanceof Ast.App || ast instanceof Ast.PropertyAccess)) return false
  if (parseDateExpression(ast.code()) == null) return false
  const parent = ast.parent()
  if (parent instanceof Ast.PropertyAccess) return parent.lhs?.id !== ast.id
  if (parent instanceof Ast.App) return parent.function.id !== ast.id
  if (parent instanceof Ast.OprApp) return parent.lhs?.id !== ast.id
  return true
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
      if (value instanceof Ast.Ast) return isDateShape(value) ? Score.Perfect : Score.Mismatch
      return isDateTyped(props.input) || parseDateExpression(value) != null ?
          Score.Perfect
        : Score.Mismatch
    },
  },
  import.meta.hot,
)
</script>

<template>
  <div ref="widgetRoot" class="WidgetDate widgetSingleLine">
    <span v-if="argumentName" class="name widgetApplyPadding" v-text="argumentName" />
    <button
      ref="chip"
      type="button"
      class="chip widgetRounded widgetPill clickable"
      :class="{ placeholder: choice == null }"
      aria-haspopup="dialog"
      :aria-expanded="interaction.isActive()"
      @pointerdown.stop.prevent
      @click.stop="toggleMenu"
      @keydown.enter.stop
    >
      <span class="widgetApplyPadding" v-text="label" />
    </button>
    <Teleport v-if="interaction.isActive()" :to="popoverRoot">
      <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
        <DateMenu :choice="choice" @choose="choose" @close="closeMenu" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.WidgetDate {
  display: inline-flex;
  align-items: center;
}

.name {
  opacity: 0.5;
  margin-right: var(--widget-token-pad-unit);
}

.chip {
  height: var(--node-port-height);
  white-space: nowrap;
  background: var(--color-widget);

  &.placeholder {
    opacity: 0.6;
  }

  &:hover,
  &[aria-expanded='true'] {
    background: var(--color-widget-focus);
  }
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}
</style>
