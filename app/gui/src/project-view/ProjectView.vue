<script setup lang="ts">
import WithCurrentProject from '$/components/WithCurrentProject.vue'
import type { ProjectTab } from '$/providers/container'
import GraphEditor from '@/components/GraphEditor.vue'
import { provideVisibility } from '@/providers/visibility'
import { provideSettings } from '@/stores/settings'
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'

const props = defineProps<{ tab: ProjectTab }>()

const projectId = computed(() => props.tab.id)

provideSettings()
const visible = ref(false)
provideVisibility(visible)

onMounted(() => (visible.value = true))
onActivated(() => (visible.value = true))
onDeactivated(() => (visible.value = false))
</script>

<template>
  <div id="ProjectView" class="ProjectView">
    <WithCurrentProject :id="projectId">
      <!-- Key property is needed because of still many usages of deprecated useXStore 
       (see WithCurrentProject.vue). Once all those usages disappear, fully remouting GraphEditor
       will be no longer necessary -->
      <GraphEditor v-if="projectId" :key="projectId" />
    </WithCurrentProject>
  </div>
</template>

<style scoped>
.ProjectView {
  width: 100%;
  height: 100%;
  color: var(--color-text);
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 11.5px;
  line-height: 20px;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  pointer-events: all;
  cursor: default;
}

:deep(.icon) {
  width: 16px;
  height: 16px;
}

:deep(.draggable) {
  cursor: grab;
}
</style>
