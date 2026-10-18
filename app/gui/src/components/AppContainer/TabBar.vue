<script setup lang="ts">
import { useLocalVersioning } from '$/providers/localVersioning'
import { panelKey, useContainerData, type Tab } from '$/providers/container'
import { useOpenedProjects, type Project } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import GrowingSpinner from '@/components/shared/GrowingSpinner.vue'
import type { SpinnerPhase } from '@/components/shared/LoadingSpinner.vue'
import type { Icon } from '@/util/iconMetadata/iconName'
import type { ProjectId } from 'enso-common/src/services/Backend'
import { computed, toRefs } from 'vue'
import SelectableTab from './SelectableTab.vue'

const { isCurrentTab, currentTab, tabList, closeTab } = toRefs(useContainerData())
const openedProjects = useOpenedProjects()
const localVersioning = useLocalVersioning()
const { getText } = useText()

/** Whether a versioned local project has changed since its last version (unknown: not changed). */
function isChanged(id: ProjectId) {
  const status = localVersioning.statusOf(id)
  return status?.enabled === true && status.changed
}

type TabViewInfo = Tab & {
  dataTestId?: string
  icon: Icon | undefined
  label: string
  loadingPhase?: SpinnerPhase | undefined
  changed?: boolean
}

const tabsViewInfos = computed(() =>
  tabList.value.flatMap((tab): TabViewInfo[] => {
    switch (tab.type) {
      case 'project': {
        const project = openedProjects.get(tab.id)
        if (!project) return []
        const showSpinner =
          project.nextTask?.process === 'opening' || project.nextTask?.process === 'restoring'
        return [
          {
            ...tab,
            dataTestId: 'project-view-tab-button',
            icon: projectIcon(project),
            changed: isChanged(tab.id),
            label:
              project.state.status === 'initialized' ?
                project.state.name.value
              : project.state.info.title,
            loadingPhase: showSpinner ? 'loading-fast' : undefined,
          },
        ]
      }
      case 'projectLog': {
        return [
          {
            ...tab,
            icon: 'log',
            label: `Session Log for ${tab.title}`,
          },
        ]
      }
      case 'settings': {
        return [
          {
            ...tab,
            icon: 'settings',
            label: 'Settings',
          },
        ]
      }
    }
  }),
)

function projectIcon(project: Project): Icon | undefined {
  if (project.error != null) {
    return 'error'
  }
  if (project.state.status === 'closed-by-backend') {
    return 'warning'
  }
  if (project.nextTask?.process === 'opening' || project.nextTask?.process === 'restoring') {
    return undefined
  }
  return 'graph_editor'
}
</script>

<template>
  <div class="TabBar">
    <div class="tabs" role="tablist">
      <!-- The tab's `aria-label` (its tooltip, else its label) replaces the name its content would
        give it, so a changed tab says so there and the ● is hidden from assistive technology. -->
      <SelectableTab
        v-for="tab in tabsViewInfos"
        :key="panelKey(tab)"
        :data-testid="tab.dataTestId"
        :selected="isCurrentTab(tab)"
        :icon="tab.icon"
        :label="tab.label"
        :tooltip="tab.changed ? `${tab.label} (${getText('changedSinceLastVersion')})` : undefined"
        @close="closeTab(tab)"
        @update:selected="$event && (currentTab = tab)"
      >
        <span
          v-if="tab.changed"
          class="changed"
          aria-hidden="true"
          data-testid="tab-changed-indicator"
          >●</span
        >
        <GrowingSpinner v-if="tab.loadingPhase != null" :phase="tab.loadingPhase" :size="16" />
      </SelectableTab>
    </div>
  </div>
</template>

<style scoped>
.TabBar {
  overflow: auto hidden;
  padding-left: 24px;
  scrollbar-width: thin;
  scrollbar-color: rgb(180 180 180) var(--color-dashboard-background);
}
.changed {
  font-size: 8px;
  line-height: 1;
}
.tabs {
  display: flex;
  flex-direction: row;
}
</style>
