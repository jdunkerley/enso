<script setup lang="ts">
/** @file The bottom dock: a resizable panel with a Code tab and a Logs tab. */
import ActionButton from '@/components/ActionButton.vue'
import BottomPanelTabs from '@/components/BottomPanel/BottomPanelTabs.vue'
import type { DockTab } from '@/components/BottomPanel/dockTab'
import { useResizeHandles } from '@/components/resizeHandles'
import ResizeHandles from '@/components/ResizeHandles.vue'
import WithFullscreenMode from '@/components/WithFullscreenMode.vue'
import { useResizeObserver } from '@/composables/events'
import { useLocalStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

defineOptions({
  inheritAttrs: false,
})

const { logsBadge = 0 } = defineProps<{
  /** ERROR and stderr lines the Logs tab has not shown yet. */
  logsBadge?: number
}>()
defineSlots<{ code(): unknown; logs(): unknown }>()

const MIN_DOCK_SIZE_PX = 20

const rootElement = ref<HTMLElement>()

const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<DockTab>('tab', { required: true })

const savedSize = useLocalStorage<{ height: number | null }>('code-editor-size', { height: null })

const resizeHandles = useResizeHandles({
  size: useResizeObserver(rootElement),
})
resizeHandles.onResizeHeight((value) => (savedSize.value = { height: value }))

function clampSize(size: number) {
  return Math.max(size, MIN_DOCK_SIZE_PX)
}

const fullscreen = ref(false)
const fullscreenAnimating = ref(false)

watch(show, (show) => {
  if (!show) fullscreen.value = false
})

const style = computed(() =>
  savedSize.value?.height != null ?
    { '--panel-size': `${clampSize(savedSize.value.height)}px` }
  : undefined,
)
</script>

<template>
  <ActionButton
    action="graph.toggleCodeEditor"
    class="gutterButton bottomOfGutter"
    :class="{ aboveFullscreen: fullscreen || fullscreenAnimating }"
  />
  <Transition>
    <div
      v-if="show"
      ref="rootElement"
      class="BottomPanel dock"
      :style="style"
      data-testid="bottomDock"
      v-bind="$attrs"
    >
      <WithFullscreenMode v-model="fullscreen" @update:animating="fullscreenAnimating = $event">
        <ActionButton
          action="panel.fullscreen"
          class="gutterButton topOfGutter"
          :class="{ aboveFullscreen: fullscreen || fullscreenAnimating }"
        />
        <div class="dockLayout">
          <BottomPanelTabs v-model:tab="tab" class="tabs" :logsBadge="logsBadge" />
          <div class="dockBody">
            <slot v-if="tab === 'code'" name="code" />
            <slot v-else name="logs" />
          </div>
        </div>
      </WithFullscreenMode>
      <ResizeHandles top v-on="resizeHandles.events" />
    </div>
  </Transition>
</template>

<style scoped>
.BottomPanel {
  --panel-size: var(--code-editor-default-height);
  position: relative;
  height: var(--panel-size);
  /*
   * Limit the size of the panel. Because size is persisted, allowing the panel to fill the screen
   * may be confusing, especially if the user sets the size on one screen and then reopens the code
   * editor on a screen with a lower resolution.
   */
  max-height: 85svh;
  margin-right: 1px;
  /*
   * Ensure that the content height doesn't exceed the panel's height while animating, which can
   * cause the native scrollbar to appear momentarily, "shaking" the viewport.
   */
  contain: layout;
}
.v-enter-active,
.v-leave-active {
  transition: height 0.1s ease;
}
.v-enter-from,
.v-leave-to {
  height: 0;
}

.dockLayout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.tabs {
  flex: none;
  /* Clear of the fullscreen button in the gutter. */
  padding-left: 44px;
}

.dockBody {
  flex: 1;
  min-height: 0;
}

.gutterButton {
  position: absolute;
  z-index: 1;
  left: 12px;
  &.aboveFullscreen {
    z-index: 2;
  }
}

.bottomOfGutter {
  bottom: 12px;
}

.topOfGutter {
  top: 12px;
}
</style>
