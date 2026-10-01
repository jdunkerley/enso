<script setup lang="ts">
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import { panelKey, tabFromRoute, useContainerData } from '$/providers/container'
import { computed, onUnmounted, ref, toRefs, useTemplateRef, watch } from 'vue'

const { isCurrentTab, currentTab, focusedPanel, setFocusedPanel } = toRefs(useContainerData())

const root = useTemplateRef('root')

const focusedInBrowser = ref(false)

watch(focusedInBrowser, (isFocused) => {
  if (isFocused) setFocusedPanel.value(currentTab.value)
})

watch(currentTab, (currentTab) => {
  setFocusedPanel.value(currentTab)
  if (!focusedInBrowser.value && currentTab != null) {
    root.value?.focus()
  }
})

const cssClass = computed(() => ({
  focusedPanel: isCurrentTab.value(focusedPanel.value),
}))

onUnmounted(() => {
  if (isCurrentTab.value(focusedPanel.value)) {
    setFocusedPanel.value(null)
  }
})
</script>

<template>
  <div
    ref="root"
    class="MiddlePanel"
    :class="cssClass"
    tabindex="-1"
    @focusin="focusedInBrowser = true"
    @focusout="focusedInBrowser = false"
  >
    <!-- Each tab in its own boundary, kept alive with it. A tab that fails to render shows the
    error display; the other tabs and the rest of the app go on working. (A `null` key, with no
    current tab, keys the cache by component, as before; Vue types a component's key as
    non-null.) -->
    <RouterView v-slot="{ Component, route }">
      <KeepAlive>
        <ErrorBoundary
          v-if="Component"
          :key="(currentTab && panelKey(currentTab)) as PropertyKey"
          onlyRenderErrors
        >
          <component :is="Component" :tab="tabFromRoute(route)" />
        </ErrorBoundary>
      </KeepAlive>
    </RouterView>
  </div>
</template>
