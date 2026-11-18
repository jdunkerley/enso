<script setup lang="ts">
/**
 * @file The node's one add-argument control, right of the node: a menu of the parameters that the
 * calls in the node are not showing, a group per call. Picking one inserts it into its call. The
 * button keeps pointer presses to itself, so that pressing it neither drags the node nor selects
 * it. The open menu is an interaction of its own, so that Escape, a click elsewhere (on the node
 * too) and another menu opening all close it.
 */
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import {
  orderedParameterGroups,
  type HiddenParameter,
  type HiddenParameterGroup,
} from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { pickerMenuStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { usePopoverRoot } from '@/providers/popoverRoot'
import type { PortId } from '@/providers/portInfo'
import { injectWidgetTree } from '@/providers/widgetTree'
import { targetIsOutside } from '@/util/autoBlur'
import { computed, ref, useTemplateRef } from 'vue'

const props = defineProps<{
  /** The node's root port: the menu's interaction is keyed on it. */
  port: PortId
}>()

const tree = injectWidgetTree()
const groups = computed(() => orderedParameterGroups(tree.hiddenParameterGroups.values()))

const popoverRoot = usePopoverRoot()
const buttonElement = useTemplateRef<HTMLElement>('buttonElement')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const open = ref(false)

const { floatingStyles } = pickerMenuStyles(buttonElement, menuElement)

const interaction = WidgetEditHandler.NewNested(
  () => props.port,
  () => undefined,
  {
    end: () => (open.value = false),
    cancel: () => (open.value = false),
    pointerdown: (e) => {
      if (targetIsOutside(e, menuElement.value) && targetIsOutside(e, buttonElement.value))
        interaction.value.end()
    },
  },
)

function toggle() {
  if (open.value) interaction.value.cancel()
  else {
    interaction.value.start()
    open.value = true
  }
}

function pick(group: HiddenParameterGroup, parameter: HiddenParameter) {
  interaction.value.end()
  group.insert(parameter)
}
</script>

<template>
  <div v-if="groups.length" class="AddArgumentControl widgetOutOfLayout">
    <button
      ref="buttonElement"
      class="addArgumentButton clickable"
      type="button"
      aria-label="Add argument"
      :aria-expanded="open"
      @pointerdown.stop
      @click.stop="toggle"
    >
      <span class="plus" aria-hidden="true">+</span>argument
    </button>
    <Teleport v-if="open" :to="popoverRoot">
      <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
        <PickerMenuFrame ariaLabel="Add argument" @close="interaction.cancel()">
          <template v-for="(group, index) in groups" :key="group.order">
            <hr v-if="index > 0" class="divider" />
            <div v-if="groups.length > 1" class="groupHeading" v-text="group.callName" />
            <button
              v-for="parameter in group.parameters"
              :key="parameter.name"
              type="button"
              class="item parameterItem"
              @click="pick(group, parameter)"
            >
              <span class="name">{{ parameter.name }}</span>
              <span v-if="parameter.type" class="type">{{ parameter.type }}</span>
            </button>
          </template>
        </PickerMenuFrame>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Outside the node, right of it, on the first line: it does not change the node's size. */
.AddArgumentControl {
  position: absolute;
  left: 100%;
  /* The node's content padding. */
  top: 4px;
  height: var(--node-port-height);
  margin-left: 8px;
  display: flex;
  align-items: center;
}

.addArgumentButton {
  display: flex;
  align-items: center;
  gap: 4px;
  height: calc(var(--node-port-height) - 2px);
  padding: 0 10px;
  border: 1.5px dashed var(--color-node-primary);
  border-radius: var(--radius-full);
  background-color: var(--color-app-bg);
  backdrop-filter: var(--blur-app-bg);
  color: var(--color-node-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;

  &:hover,
  &[aria-expanded='true'] {
    border-style: solid;
  }
}

.plus {
  font-size: 15px;
  line-height: 1;
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
  --picker-menu-width: 240px;
}

.groupHeading {
  padding: 4px 8px 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.6;
}

.parameterItem {
  justify-content: space-between;
  gap: 16px;
}

.type {
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
