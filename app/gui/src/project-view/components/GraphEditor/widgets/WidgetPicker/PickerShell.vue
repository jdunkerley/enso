<script setup lang="ts">
/**
 * @file What the date and time-of-day widgets have in common: the argument's own widgets (its code,
 * with ports), a selection arrow under it, and a menu that opens under it as a popover floating
 * beside the node. The menu replaces the whole value. It is the `menu` slot, given `done` (end the
 * interaction after a choice), `close` (cancel it, as Escape does) and `setAccept` (a menu with an
 * edit in progress hands over the function that writes it: a click outside the menu calls it before
 * the interaction ends, so a click away keeps what was typed). The widget keeps the edit: what a
 * choice writes is its business.
 *
 * When the widget is a whole node, a click is the node's too (it selects it, and with a modifier
 * edits it): the widget takes it only on a node that is already selected. A first click on the node
 * selects it, the next opens the menu.
 *
 * The menu is open only when the widget asked for it (a click on it, or on the arrow): a field
 * inside the argument (the year of `Date.new 2020 1 15`) being edited makes the interaction active,
 * too, but is not a reason to show the menu.
 */
import { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { WidgetTypeId } from '$/providers/openedProjects/widgetRegistry'
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import SelectionArrow from '@/components/GraphEditor/widgets/WidgetSelection/SelectionArrow.vue'
import { pickerMenuStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { unrefElement } from '@/composables/events'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { provideSelectionArrow } from '@/providers/selectionArrow'
import { useTopLevelArgument } from '@/providers/topLevelArgument'
import { injectWidgetTree } from '@/providers/widgetTree'
import { Ast } from '@/util/ast'
import { targetIsOutside } from '@/util/autoBlur'
import { isNodeRoot } from '@/components/GraphEditor/widgets/WidgetPicker/wholeNode'
import { computed, ref, toRef, useTemplateRef } from 'vue'

const props = defineProps<{
  /** The widget's own props: the input, and its type id (the interaction is keyed on both). */
  widget: { widgetTypeId: WidgetTypeId; input: WidgetInput }
}>()

const tree = injectWidgetTree()
const popoverRoot = usePopoverRoot()
const topLevelArgument = useTopLevelArgument(true)

const widgetRoot = useTemplateRef<HTMLElement>('widgetRoot')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const isHovered = ref(false)
const menuOpen = ref(false)

const floatReference = computed(
  () =>
    topLevelArgument?.enclosingTopLevelArgument(widgetRoot.value, tree.rootElement) ??
    widgetRoot.value,
)
const { floatingStyles } = pickerMenuStyles(floatReference, menuElement)

const selectionArrow = provideSelectionArrow({
  node: () => props.widget.input.value,
  show: toRef(tree, 'showDetails'),
  isHovered,
})

/** What the menu writes when the click that ends the interaction is outside it, if it has an edit. */
let accept: (() => void) | undefined
const setAccept = (handler: () => void) => (accept = handler)

const interaction = WidgetEditHandler.New(props.widget, {
  start: () => (accept = undefined),
  end: () => (menuOpen.value = false),
  cancel: () => (menuOpen.value = false),
  pointerdown: (e) => {
    if (
      targetIsOutside(e, unrefElement(menuElement)) &&
      targetIsOutside(e, unrefElement(widgetRoot)) &&
      targetIsOutside(e, document.getElementById('floatingLayer'))
    ) {
      if (menuOpen.value) accept?.()
      if (interaction.value.isActive()) interaction.value.end()
    }
  },
})

/** The argument's own widgets, bound to the interaction so that editing a field is part of it. */
const innerInput = computed<WidgetInput>(() => ({
  ...props.widget.input,
  editHandler: interaction.value,
}))

function toggleMenu() {
  if (menuOpen.value) interaction.value.cancel()
  else {
    interaction.value.start()
    menuOpen.value = true
  }
}

const isWholeNode = computed(() => {
  const value = props.widget.input.value
  return value instanceof Ast.Ast && isNodeRoot(value)
})

function onClick(event: MouseEvent) {
  if (isWholeNode.value) {
    const modified = event.ctrlKey || event.metaKey || event.shiftKey
    const node = widgetRoot.value?.closest('.GraphNode')
    if (modified || !node?.classList.contains('selected')) return
  }
  event.stopPropagation()
  toggleMenu()
}

const close = () => interaction.value.cancel()
const done = () => interaction.value.end()
</script>

<template>
  <div
    ref="widgetRoot"
    class="PickerShell widgetParent clickable"
    @pointerdown.prevent
    @click="onClick"
    @keydown.enter.stop
    @pointerover="isHovered = true"
    @pointerout="isHovered = false"
  >
    <NodeWidget :input="innerInput" />
    <SelectionArrow v-if="selectionArrow" v-bind="selectionArrow" />
    <Teleport v-if="menuOpen" :to="popoverRoot">
      <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
        <slot name="menu" :close="close" :done="done" :setAccept="setAccept" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.PickerShell {
  position: relative;
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}
</style>
