<script setup lang="ts">
/**
 * @file The active developer overrides, at the bottom left of the window: one line each, with a
 * button resetting it. Nothing shows while nothing is overridden (#172).
 */
import Button from '$/components/Button/Button.vue'
import { POPOVER_STYLES } from '$/components/Dialog/variants'
import Text from '$/components/Text/Text.vue'
import { useDevtoolsStore } from '$/providers/devTools'
import {
  DEFAULT_ASSETS_TABLE_REFRESH_INTERVAL_MS,
  DEFAULT_FILE_CHUNK_UPLOAD_POOL_SIZE,
  DEFAULT_GET_LOG_EVENTS_PAGE_SIZE,
  DEFAULT_LIST_DIRECTORY_PAGE_SIZE,
  flagsStore,
  setFeatureFlag,
} from '$/providers/featureFlags'
import { useText } from '$/providers/text'
import { computed } from 'vue'

/** An active override: what it is, and how to undo it. */
interface Override {
  readonly id: string
  readonly text: string
  readonly reset: () => void
}

const { getText } = useText()
const devtools = useDevtoolsStore()
const flags = computed(() => flagsStore.state.value.featureFlags)

const overrides = computed(() => {
  const {
    developerPlanOverride,
    showDeveloperIds,
    enableMultitabs,
    enableAssetsTableBackgroundRefresh,
    assetsTableBackgroundRefreshInterval,
    enableCloudExecution,
    enableAdvancedProjectExecutionOptions,
    listDirectoryPageSize,
    getLogEventsPageSize,
    fileChunkUploadPoolSize,
    unsafeDarkTheme,
  } = flags.value
  const result: Override[] = []
  function add(id: string, isActive: boolean, text: () => string, reset: () => void) {
    if (isActive) result.push({ id, text: text(), reset })
  }
  add(
    'developerPlanOverride',
    developerPlanOverride != null,
    () => getText('planOverriddenToX', getText(developerPlanOverride!)),
    () => setFeatureFlag('developerPlanOverride', undefined),
  )
  add(
    'versionChecker',
    devtools.showVersionChecker === true,
    () => getText('versionCheckerEnabled'),
    () => (devtools.showVersionChecker = false),
  )
  add(
    'enableAssetsTableBackgroundRefresh',
    !enableAssetsTableBackgroundRefresh,
    () => getText('assetsTableBackgroundRefreshDisabled'),
    () => setFeatureFlag('enableAssetsTableBackgroundRefresh', true),
  )
  add(
    'assetsTableBackgroundRefreshInterval',
    assetsTableBackgroundRefreshInterval !== DEFAULT_ASSETS_TABLE_REFRESH_INTERVAL_MS,
    () =>
      getText(
        'assetsTableBackgroundRefreshIntervalOverriddenToXMs',
        assetsTableBackgroundRefreshInterval,
      ),
    () =>
      setFeatureFlag(
        'assetsTableBackgroundRefreshInterval',
        DEFAULT_ASSETS_TABLE_REFRESH_INTERVAL_MS,
      ),
  )
  add(
    'enableCloudExecution',
    !enableCloudExecution,
    () => getText('cloudExecutionDisabled'),
    () => setFeatureFlag('enableCloudExecution', true),
  )
  add(
    'showDeveloperIds',
    showDeveloperIds,
    () => getText('showingDeveloperIds'),
    () => setFeatureFlag('showDeveloperIds', false),
  )
  add(
    'enableMultitabs',
    enableMultitabs,
    () => getText('multitabsEnabled'),
    () => setFeatureFlag('enableMultitabs', false),
  )
  add(
    'enableAdvancedProjectExecutionOptions',
    enableAdvancedProjectExecutionOptions,
    () => getText('advancedProjectExecutionOptionsEnabled'),
    () => setFeatureFlag('enableAdvancedProjectExecutionOptions', false),
  )
  add(
    'listDirectoryPageSize',
    listDirectoryPageSize !== DEFAULT_LIST_DIRECTORY_PAGE_SIZE,
    () => getText('willFetchUpToXAssetsPerPage', listDirectoryPageSize),
    () => setFeatureFlag('listDirectoryPageSize', DEFAULT_LIST_DIRECTORY_PAGE_SIZE),
  )
  add(
    'getLogEventsPageSize',
    getLogEventsPageSize !== DEFAULT_GET_LOG_EVENTS_PAGE_SIZE,
    () => getText('willFetchUpToXLogEntriesPerPage', getLogEventsPageSize),
    () => setFeatureFlag('getLogEventsPageSize', DEFAULT_GET_LOG_EVENTS_PAGE_SIZE),
  )
  add(
    'fileChunkUploadPoolSize',
    fileChunkUploadPoolSize !== DEFAULT_FILE_CHUNK_UPLOAD_POOL_SIZE,
    () => getText('willUploadUpToXFileChunksAtOnce', fileChunkUploadPoolSize),
    () => setFeatureFlag('fileChunkUploadPoolSize', DEFAULT_FILE_CHUNK_UPLOAD_POOL_SIZE),
  )
  add(
    'unsafeDarkTheme',
    unsafeDarkTheme,
    () => getText('developerDarkThemeEnabled'),
    () => setFeatureFlag('unsafeDarkTheme', false),
  )
  return result
})

const styles = POPOVER_STYLES({ size: 'auto-xxsmall' })
</script>

<template>
  <div
    v-if="overrides.length > 0"
    :class="
      styles.base({
        className: [
          'absolute left-3',
          devtools.showEnsoDevtools ? 'bottom-[4.25rem]' : 'bottom-3',
        ].join(' '),
      })
    "
    data-testid="enso-dev-status"
  >
    <div :class="styles.dialog()">
      <div v-for="override in overrides" :key="override.id" class="flex items-center gap-2">
        <Button
          variant="icon"
          icon="close"
          :aria-label="getText('reset')"
          tooltipPlacement="right"
          @press="override.reset"
        />
        <Text>{{ override.text }}</Text>
      </div>
    </div>
  </div>
</template>
