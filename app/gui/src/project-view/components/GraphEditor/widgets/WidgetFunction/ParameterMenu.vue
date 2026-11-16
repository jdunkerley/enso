<script setup lang="ts">
/**
 * @file The `…` after a call: a menu of the parameters the call is not showing. Picking one asks
 * for it to be inserted. The button keeps pointer presses to itself, so that pressing it neither
 * drags the node nor selects it.
 */
import type { HiddenParameter } from '@/components/GraphEditor/widgets/WidgetFunction/hiddenParameters'
import PickerMenuFrame from '@/components/GraphEditor/widgets/WidgetPicker/PickerMenuFrame.vue'
import { activityDropdownStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { targetIsOutside } from '@/util/autoBlur'
import { useEventListener } from '@vueuse/core'
import { ref, useTemplateRef } from 'vue'

defineProps<{ parameters: HiddenParameter[] }>()
const emit = defineEmits<{ pick: [HiddenParameter] }>()

const popoverRoot = usePopoverRoot()
const buttonElement = useTemplateRef<HTMLElement>('buttonElement')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const open = ref(false)

const { floatingStyles } = activityDropdownStyles(buttonElement, menuElement, popoverRoot)

useEventListener(window, 'pointerdown', (event: PointerEvent) => {
  if (open.value && targetIsOutside(event, menuElement.value)) open.value = false
})
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (open.value && event.key === 'Escape') {
    event.stopPropagation()
    open.value = false
  }
})

function pick(parameter: HiddenParameter) {
  open.value = false
  emit('pick', parameter)
}
</script>

<template>
  <button
    ref="buttonElement"
    class="parameterMenuButton clickable"
    type="button"
    aria-label="More parameters"
    :aria-expanded="open"
    @pointerdown.stop
    @click.stop="open = !open"
  >
    …
  </button>
  <Teleport v-if="open" :to="popoverRoot">
    <div ref="menuElement" class="menuElement widgetOutOfLayout" :style="floatingStyles">
      <PickerMenuFrame ariaLabel="More parameters" @close="open = false">
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
  display: inline-flex;
  align-items: center;
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
