<script setup lang="ts">
/** @file The bottom dock: a resizable panel with a Code tab and a Logs tab. */
import ActionButton from '@/components/ActionButton.vue'
import BottomPanelTabs from '@/components/BottomPanel/BottomPanelTabs.vue'
import { useCodeTabFocus, type DockTab } from '@/components/BottomPanel/dockTab'
import { useResizeHandles } from '@/components/resizeHandles'
import ResizeHandles from '@/components/ResizeHandles.vue'
import WithFullscreenMode from '@/components/WithFullscreenMode.vue'
import { useResizeObserver } from '@/composables/events'
import { registerHandlers } from '@/providers/action'
import { useText } from '$/providers/text'
import { useLocalStorage } from '@vueuse/core'
import { computed, ref, useId, watch } from 'vue'

defineOptions({
  inheritAttrs: false,
})

const { logsBadge = 0 } = defineProps<{
  /** ERROR and stderr lines the Logs tab has not shown yet. */
  logsBadge?: number
}>()
defineSlots<{ code(): unknown; logs(): unknown }>()

const idBase = useId()

const MIN_DOCK_SIZE_PX = 20

const rootElement = ref<HTMLElement>()

const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<DockTab>('tab', { required: true })

// `GraphEditor.vue` provides it, so that the Code shortcut can ask too; a dock on its own has its own.
const codeTabFocus = useCodeTabFocus(() => [] as const)
const { getText } = useText()

// The header's close button.
registerHandlers({
  'panel.close': {
    available: true,
    action: () => (show.value = false),
  },
})

/** Picking the Code tab while Logs shows hands the keyboard to the code editor. */
function onPicked(picked: DockTab) {
  if (picked === 'code') codeTabFocus.request()
}

const savedSize = useLocalStorage<{ height: number | null }>('code-editor-size', { height: null })

const resizeHandles = useResizeHandles({
  size: useResizeObserver(rootElement),
})
resizeHandles.onResizeHeight((value) => (savedSize.value = { height: value }))

function clampSize(size: number) {
  return Math.max(size, MIN_DOCK_SIZE_PX)
}

const fullscreen = ref(false)

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
  <!-- While the dock is closed: a button per tab, which opens it there. -->
  <div v-if="!show" class="collapsedButtons" data-testid="bottomDockButtons">
    <ActionButton action="graph.toggleCodeEditor" />
    <div class="logsButton">
      <ActionButton action="graph.toggleLogs" />
      <span
        v-if="logsBadge > 0"
        class="errorDot"
        role="img"
        data-testid="logs-error-dot"
        :aria-label="
          logsBadge === 1 ?
            getText('engineLogsUnseenError')
          : getText('engineLogsUnseenErrors', logsBadge)
        "
      />
    </div>
  </div>
  <Transition>
    <div
      v-if="show"
      ref="rootElement"
      class="BottomPanel dock"
      :style="style"
      data-testid="bottomDock"
      v-bind="$attrs"
    >
      <WithFullscreenMode v-model="fullscreen">
        <div class="dockLayout">
          <div class="dockHeader">
            <BottomPanelTabs
              v-model:tab="tab"
              class="tabs"
              :logsBadge="logsBadge"
              :idBase="idBase"
              @picked="onPicked"
            />
            <div class="headerActions">
              <ActionButton action="panel.fullscreen" />
              <ActionButton action="panel.close" />
            </div>
          </div>
          <div class="dockBody">
            <!-- Both stay mounted: switching tabs keeps the editor's cursor and the log's scroll. -->
            <div
              v-show="tab === 'code'"
              :id="`${idBase}-panel-code`"
              class="dockPanel"
              role="tabpanel"
              :aria-labelledby="`${idBase}-tab-code`"
            >
              <slot name="code" />
            </div>
            <div
              v-show="tab === 'logs'"
              :id="`${idBase}-panel-logs`"
              class="dockPanel"
              role="tabpanel"
              :aria-labelledby="`${idBase}-tab-logs`"
            >
              <slot name="logs" />
            </div>
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

.dockHeader {
  flex: none;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 8px;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  padding-right: 4px;
}

.dockPanel {
  width: 100%;
  height: 100%;
}

.dockBody {
  flex: 1;
  min-height: 0;
}

/* In the graph's left gutter, where the single dock button was. */
.collapsedButtons {
  position: absolute;
  z-index: 1;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.logsButton {
  position: relative;
  display: flex;
}

.errorDot {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-error);
  pointer-events: none;
}
</style>
