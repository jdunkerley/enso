<script setup lang="ts">
/**
 * @file The ＋ after a call's arguments, shown while the node is selected: a menu of the parameters
 * the call is not showing. Picking one asks for it to be inserted. The button keeps pointer presses to itself, so that pressing it neither
 * drags the node nor selects it. The open menu is an interaction of its own, so that Escape, a
 * click elsewhere (on the node too) and another menu opening all close it.
 */
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import type { HiddenParameter } from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { pickerMenuStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { usePopoverRoot } from '@/providers/popoverRoot'
import type { PortId } from '@/providers/portInfo'
import { targetIsOutside } from '@/util/autoBlur'
import { ref, useTemplateRef } from 'vue'

const props = defineProps<{
  /** The call's port: the menu's interaction is keyed on it. */
  port: PortId
  parameters: HiddenParameter[]
  /** The call is inside another call's argument: a smaller ＋, inside the call's group. */
  nested: boolean
}>()
const emit = defineEmits<{ pick: [HiddenParameter] }>()

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

function pick(parameter: HiddenParameter) {
  interaction.value.end()
  emit('pick', parameter)
}
</script>

<template>
  <button
    ref="buttonElement"
    class="parameterMenuButton clickable"
    :class="{ nested }"
    type="button"
    aria-label="Add argument"
    :aria-expanded="open"
    @pointerdown.stop
    @click.stop="toggle"
  >
    <span aria-hidden="true">+</span>
  </button>
  <Teleport v-if="open" :to="popoverRoot">
    <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
      <PickerMenuFrame ariaLabel="Add argument" @close="interaction.cancel()">
        <button
          v-for="parameter in parameters"
          :key="parameter.name"
          type="button"
          class="item parameterItem"
          :title="parameter.type"
          @click="pick(parameter)"
        >
          <span class="name">{{ parameter.name }}</span>
        </button>
      </PickerMenuFrame>
    </div>
  </Teleport>
</template>

<style scoped>
.parameterMenuButton {
  flex: none;
  display: grid;
  place-items: center;
  /* The node's row can be taller than a port (a value chip with padding): stay in its middle. */
  align-self: center;
  /* Its own gap, not the token padding: after a bare function name that padding can be zero. */
  margin-left: var(--widget-token-pad-unit);
  width: 20px;
  height: 20px;
  border-radius: var(--radius-full);
  background-color: rgb(255 255 255 / 0.92);
  color: var(--color-node-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;

  &.nested {
    width: 16px;
    height: 16px;
    font-size: 12px;
  }

  &:hover,
  &[aria-expanded='true'] {
    background-color: white;
  }
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}

.parameterItem {
  justify-content: space-between;
  gap: 16px;
}
</style>
