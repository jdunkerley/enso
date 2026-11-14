<script setup lang="ts">
/**
 * @file The map visualization's empty state: maps need the user's own Mapbox access token, set in
 * Settings → Local → Maps (`$/providers/mapboxToken`).
 */
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import Result from '$/components/Result/Result.vue'
import SettingsTabType from '$/configurations/settingsTabs'
import { useText } from '$/providers/text'
import router from '$/router'

const { getText } = useText()

/**
 * Open Settings on the Local tab. The app's router instance is used directly: a visualization
 * renders inside a custom element, a separate Vue app that the router plugin is not installed in,
 * so `useRouter()` there returns `undefined`. The router's guard opens the Settings tab.
 */
function openSetting() {
  void router.push({
    name: 'settings',
    query: {
      ...router.currentRoute.value.query,
      [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(SettingsTabType.local),
    },
  })
}
</script>

<template>
  <div class="MapboxTokenMissing">
    <Result
      status="info"
      centered
      :title="getText('mapboxTokenMissing')"
      :subtitle="getText('mapboxTokenMissingDescription')"
    >
      <Button variant="outline" @press="openSetting">{{
        getText('openMapboxTokenSetting')
      }}</Button>
    </Result>
  </div>
</template>

<style scoped>
.MapboxTokenMissing {
  height: 100%;
  /* Clears the visualization toolbar, which overlays the top of the map (`setToolbarOverlay`):
   * its 4px margin plus a section of about 40px. */
  padding-top: 48px;
}
</style>
