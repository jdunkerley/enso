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
import { useRoute, useRouter } from 'vue-router'

const { getText } = useText()
const router = useRouter()
const route = useRoute()

function openSetting() {
  void router.push({
    name: 'settings',
    query: {
      ...route.query,
      [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(SettingsTabType.local),
    },
  })
}
</script>

<template>
  <Result
    class="MapboxTokenMissing"
    status="info"
    centered
    :title="getText('mapboxTokenMissing')"
    :subtitle="getText('mapboxTokenMissingDescription')"
  >
    <Button variant="outline" @press="openSetting">{{ getText('openMapboxTokenSetting') }}</Button>
  </Result>
</template>
