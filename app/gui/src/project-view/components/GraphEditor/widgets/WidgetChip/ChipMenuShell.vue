<script setup lang="ts">
/**
 * @file What the date and time-of-day widgets have in common: the argument name, a chip showing the
 * value's label, and a menu that opens under it, as a popover floating beside the node, while the
 * widget is the active interaction. The menu is the `menu` slot; it is given `done` (end the
 * interaction after a choice), `close` (cancel it, as Escape does) and `setAccept` (a menu with an
 * edit in progress hands over the function that writes it: a click outside the menu calls it before
 * the interaction ends, so a click away keeps what was typed, as it does in other widgets). The widget keeps the edit:
 * what a choice writes is its business. The root's attributes (a class naming the widget) fall through.
 */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import type { WidgetTypeId } from '$/providers/openedProjects/widgetRegistry'
import { ArgumentNameShownKey } from '@/components/GraphEditor/widgets/WidgetArgumentName.vue'
import { activityDropdownStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { unrefElement } from '@/composables/events'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { useTopLevelArgument } from '@/providers/topLevelArgument'
import { injectWidgetTree } from '@/providers/widgetTree'
import { targetIsOutside } from '@/util/autoBlur'
import { ArgumentInfoKey } from '@/util/callTree'
import { computed, useTemplateRef } from 'vue'

const props = defineProps<{
  /** The widget's own props: the input, and its type id (the interaction is keyed on both). */
  widget: { widgetTypeId: WidgetTypeId; input: WidgetInput }
  /** The chip's text. */
  label: string
  /** Whether the chip is drawn dimmed: it stands for no value yet, or for an argument's default. */
  placeholder: boolean
  /** An unset argument's default that the chip cannot show as a label, drawn dimmed after it. */
  hint?: string | undefined
}>()

const tree = injectWidgetTree()
const popoverRoot = usePopoverRoot()
const topLevelArgument = useTopLevelArgument(true)

const widgetRoot = useTemplateRef<HTMLElement>('widgetRoot')
const chip = useTemplateRef<HTMLElement>('chip')
const menuElement = useTemplateRef<HTMLElement>('menuElement')

const argumentName = computed(() => {
  if (ArgumentNameShownKey in props.widget.input) return
  return props.widget.input[ArgumentInfoKey]?.info?.name
})

/** The argument's name, for the chip's accessible name (the visible name may be drawn outside it). */
const accessibleName = computed(() => {
  const name = props.widget.input[ArgumentInfoKey]?.info?.name
  return name ? `${name}: ${props.label}` : props.label
})

const floatReference = computed(
  () =>
    topLevelArgument?.enclosingTopLevelArgument(widgetRoot.value, tree.rootElement) ??
    widgetRoot.value,
)
const { floatingStyles } = activityDropdownStyles(floatReference, menuElement, popoverRoot)

/** What the menu writes when the click that ends the interaction is outside it, if it has an edit. */
let accept: (() => void) | undefined
const setAccept = (handler: () => void) => (accept = handler)

const interaction = WidgetEditHandler.New(props.widget, {
  pointerdown: (e) => {
    if (
      targetIsOutside(e, unrefElement(menuElement)) &&
      targetIsOutside(e, unrefElement(widgetRoot)) &&
      targetIsOutside(e, document.getElementById('floatingLayer'))
    ) {
      accept?.()
      if (interaction.value.isActive()) interaction.value.end()
    }
  },
})

function toggleMenu() {
  if (interaction.value.isActive()) interaction.value.cancel()
  else interaction.value.start()
}

/** Cancel the interaction, and put the keyboard back on the chip. */
function close() {
  interaction.value.cancel()
  chip.value?.focus()
}

/** End the interaction after a choice, and put the keyboard back on the chip. */
function done() {
  interaction.value.end()
  chip.value?.focus()
}
</script>

<template>
  <div ref="widgetRoot" class="ChipMenuShell widgetSingleLine">
    <span v-if="argumentName" class="name widgetApplyPadding" v-text="argumentName" />
    <button
      ref="chip"
      type="button"
      class="chip widgetRounded widgetPill clickable"
      :class="{ placeholder }"
      aria-haspopup="dialog"
      :aria-label="accessibleName"
      :aria-expanded="interaction.isActive()"
      @pointerdown.stop.prevent
      @click.stop="toggleMenu"
      @keydown.enter.stop
    >
      <span class="widgetApplyPadding" v-text="label" />
      <span v-if="hint" class="hint widgetApplyPadding" v-text="hint" />
    </button>
    <Teleport v-if="interaction.isActive()" :to="popoverRoot">
      <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
        <slot name="menu" :close="close" :done="done" :setAccept="setAccept" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ChipMenuShell {
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

  .hint {
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
