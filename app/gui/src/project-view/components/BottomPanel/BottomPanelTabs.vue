<script setup lang="ts">
/** @file The bottom dock's tab strip: Code and Logs, with the count of unseen errors on Logs. */
import { useText } from '$/providers/text'
import { nextTick, useId, useTemplateRef } from 'vue'
import { DOCK_TABS, type DockTab } from './dockTab'

const tab = defineModel<DockTab>('tab', { required: true })
const { logsBadge = 0, idBase = useId() } = defineProps<{
  /** ERROR and stderr lines the Logs tab has not shown yet. */
  logsBadge?: number
  /** Prefix of the element ids that link each tab to its panel (`<idBase>-tab-code`, `<idBase>-panel-code`). */
  idBase?: string
}>()
const { getText } = useText()

const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')

/** Arrow keys (and Home/End) move between the tabs, selecting as they go. */
function onKeydown(event: KeyboardEvent) {
  const current = DOCK_TABS.indexOf(tab.value)
  let next: number
  switch (event.key) {
    case 'ArrowRight':
      next = (current + 1) % DOCK_TABS.length
      break
    case 'ArrowLeft':
      next = (current + DOCK_TABS.length - 1) % DOCK_TABS.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = DOCK_TABS.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  tab.value = DOCK_TABS[next]!
  void nextTick(() => buttons.value?.[next]?.focus())
}
</script>

<template>
  <div
    class="BottomPanelTabs"
    role="tablist"
    :aria-label="getText('bottomDockTabs')"
    @keydown="onKeydown"
  >
    <button
      :id="`${idBase}-tab-code`"
      ref="buttons"
      type="button"
      role="tab"
      class="tab"
      :aria-controls="`${idBase}-panel-code`"
      :aria-selected="tab === 'code'"
      :tabindex="tab === 'code' ? 0 : -1"
      data-testid="dock-tab-code"
      @click="tab = 'code'"
    >
      {{ getText('bottomDockCodeTab') }}
    </button>
    <button
      :id="`${idBase}-tab-logs`"
      ref="buttons"
      type="button"
      role="tab"
      class="tab"
      :aria-controls="`${idBase}-panel-logs`"
      :aria-selected="tab === 'logs'"
      :tabindex="tab === 'logs' ? 0 : -1"
      data-testid="dock-tab-logs"
      @click="tab = 'logs'"
    >
      {{ getText('bottomDockLogsTab') }}
      <span
        v-if="logsBadge > 0 && tab !== 'logs'"
        class="badge"
        data-testid="logs-badge"
        :aria-label="
          logsBadge === 1 ?
            getText('engineLogsUnseenError')
          : getText('engineLogsUnseenErrors', logsBadge)
        "
        >{{ logsBadge > 99 ? '99+' : logsBadge }}</span
      >
    </button>
  </div>
</template>

<style scoped>
.BottomPanelTabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 28px;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 8px 8px 0 0;
  background-color: rgba(255, 255, 255, 0.5);
  color: var(--color-text);
  font-size: 13px;
}

.tab[aria-selected='true'] {
  background-color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background-color: var(--color-error);
  color: var(--color-text-inversed);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
</style>
