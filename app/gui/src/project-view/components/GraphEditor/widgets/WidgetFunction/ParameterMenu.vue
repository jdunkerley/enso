<script setup lang="ts">
/**
 * @file The `…` after a call: a menu of the parameters the call is not showing. Picking one asks
 * for it to be inserted. The button keeps pointer presses to itself, so that pressing it neither
 * drags the node nor selects it. The open menu is an interaction of its own, so that Escape, a
 * click elsewhere (on the node too) and another menu opening all close it.
 */
import { WidgetEditHandler } from '$/providers/openedProjects/widgetRegistry/editHandler'
import type { HiddenParameter } from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { activityDropdownStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { usePopoverRoot } from '@/providers/popoverRoot'
import type { PortId } from '@/providers/portInfo'
import { targetIsOutside } from '@/util/autoBlur'
import { ref, useTemplateRef } from 'vue'

const props = defineProps<{
  /** The call's port: the menu's interaction is keyed on it. */
  port: PortId
  parameters: HiddenParameter[]
  /** The node shows its details, which include these parameters: the button hides (unless open). */
  collapsed: boolean
}>()
const emit = defineEmits<{ pick: [HiddenParameter] }>()

const popoverRoot = usePopoverRoot()
const buttonElement = useTemplateRef<HTMLElement>('buttonElement')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const open = ref(false)

const { floatingStyles } = activityDropdownStyles(buttonElement, menuElement, popoverRoot)

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
    v-show="!collapsed || open"
    ref="buttonElement"
    class="parameterMenuButton widgetSingleLine widgetApplyPadding clickable"
    type="button"
    aria-label="More parameters"
    :aria-expanded="open"
    @pointerdown.stop
    @click.stop="toggle"
  >
    …
  </button>
  <Teleport v-if="open" :to="popoverRoot">
    <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
      <PickerMenuFrame ariaLabel="More parameters" @close="interaction.cancel()">
        <button
          v-for="parameter in parameters"
          :key="parameter.name"
          type="button"
          class="item parameterItem"
          @click="pick(parameter)"
        >
          <span class="name">{{ parameter.name }}</span>
          <span v-if="parameter.type" class="type">{{ parameter.type }}</span>
        </button>
      </PickerMenuFrame>
    </div>
  </Teleport>
</template>

<style scoped>
.parameterMenuButton {
  padding: 0 6px;
  border-radius: var(--radius-full);
  background-color: var(--color-widget);
  color: inherit;
  line-height: 1;
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}

.parameterItem {
  justify-content: space-between;
  gap: 16px;
}

.type {
  opacity: 0.6;
}
</style>
