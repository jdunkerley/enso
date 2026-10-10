/** @file Provider for feature flags, used to enable or disable certain features in the application. */
import { createPersistedStore } from '$/utils/persistedStore'
import { unsafeWriteValue } from '$/utils/write'
import { Plan } from 'enso-common/src/services/Backend'
import { unsafeEntries } from 'enso-common/src/utilities/data/object'
import { IS_DEV_MODE, isOnElectron, isOnLinux } from 'enso-common/src/utilities/detect'
import { computed } from 'vue'
import { z } from 'zod'

const MIN_ASSETS_TABLE_REFRESH_INTERVAL_MS = 100
export const DEFAULT_ASSETS_TABLE_REFRESH_INTERVAL_MS = 3_000
export const DEFAULT_GET_LOG_EVENTS_PAGE_SIZE = 100
export const DEFAULT_LIST_DIRECTORY_PAGE_SIZE = 100
export const DEFAULT_FILE_CHUNK_UPLOAD_POOL_SIZE = 5
export const DEFAULT_DATA_CATALOG_QUERY_DEBOUNCE_DELAY_MS = 500

export const FEATURE_FLAGS_SCHEMA = z.object({
  enableDeepLinks: z.boolean(),
  enableLocalBackend: z.boolean(),
  enableMultitabs: z.boolean(),
  enableAssetsTableBackgroundRefresh: z.boolean(),
  assetsTableBackgroundRefreshInterval: z.number().int().min(MIN_ASSETS_TABLE_REFRESH_INTERVAL_MS),
  enableCloudExecution: z.boolean(),
  enableAdvancedProjectExecutionOptions: z.boolean(),
  showDeveloperIds: z.boolean(),
  developerPlanOverride: z.nativeEnum(Plan).optional(),
  fileChunkUploadPoolSize: z.number().int().min(1),
  getLogEventsPageSize: z.number().int().min(1),
  listDirectoryPageSize: z.number().int().min(1),
  dataCatalogQueryDebounceDelay: z.number().int().min(0),
  unsafeDarkTheme: z.boolean(),
  apiKeyLimit: z.number().int().min(0),
  debugHoverAreas: z.boolean(),
  /**
   * Show the Reka UI spike menu next to the user bar (#76). Proves the Vue headless-UI stack
   * works; off by default, set via `window.overrideFeatureFlags` or local storage.
   * Remove with the spike once the Vue `DropdownMenu` primitive has a real mount site (#78).
   */
  enableHeadlessUiSpike: z.boolean(),
})

const FEATURE_FLAGS_STATE_SCHEMA = z.object({ featureFlags: FEATURE_FLAGS_SCHEMA.partial() })

/** Feature flags. */
export type FeatureFlags = z.infer<typeof FEATURE_FLAGS_SCHEMA>

/** The persisted state of {@link flagsStore}. */
export interface FeatureFlagsState {
  readonly featureFlags: FeatureFlags
}

/** Mutates `state` with the provided feature flags, skipping the `undefined` ones. */
function unsafeMutateFeatureFlags(
  state: FeatureFlagsState,
  flags: { [K in keyof FeatureFlags]?: FeatureFlags[K] | undefined },
) {
  const newFeatureFlags = { ...state.featureFlags }
  for (const [k, v] of unsafeEntries(flags)) {
    if (v !== undefined) {
      unsafeWriteValue(newFeatureFlags, k, v)
    }
  }
  unsafeWriteValue(state, 'featureFlags', newFeatureFlags)
}

/**
 * Flags that no longer exist, with the store version that removed them. Earlier versions migrated
 * them: version 2 turned `enableMonaspaceCodeFont` on by default (#110), version 3 `monoNodes`
 * (#112); version 4 removed both, making Monaspace Neon unconditional (#113).
 *
 * `merge` already ignores unknown keys (the schema strips them), so a stale entry would do no harm;
 * migrating strips it from storage too, so that the stored flags match the schema.
 */
const REMOVED_FLAGS: readonly { flag: string; version: number }[] = [
  { flag: 'enableMonaspaceCodeFont', version: 4 },
  { flag: 'monoNodes', version: 4 },
]

/** Upgrade persisted feature flags from an older `version`: see {@link REMOVED_FLAGS}. */
export function migrateFeatureFlags(persistedState: unknown, version: number): unknown {
  if (typeof persistedState !== 'object' || persistedState == null) return persistedState
  if (!('featureFlags' in persistedState)) return persistedState
  const storedFlags = persistedState.featureFlags
  if (typeof storedFlags !== 'object' || storedFlags == null) return persistedState
  const featureFlags: Record<string, unknown> = { ...storedFlags }
  let changed = false
  for (const { flag, version: removedIn } of REMOVED_FLAGS) {
    if (version < removedIn && flag in featureFlags) {
      delete featureFlags[flag]
      changed = true
    }
  }
  return changed ? { ...persistedState, featureFlags } : persistedState
}

/**
 * The feature flags: the defaults, overridden by the saved flags, overridden in turn by
 * `window.overrideFeatureFlags` (which the integration tests' mocks set).
 */
export const flagsStore = createPersistedStore<FeatureFlagsState>(
  () => ({
    featureFlags: {
      enableDeepLinks: !IS_DEV_MODE && !isOnLinux() && isOnElectron(),
      enableLocalBackend: false,
      enableMultitabs: false,
      enableAssetsTableBackgroundRefresh: true,
      assetsTableBackgroundRefreshInterval: DEFAULT_ASSETS_TABLE_REFRESH_INTERVAL_MS,
      enableCloudExecution: IS_DEV_MODE || isOnElectron(),
      enableAdvancedProjectExecutionOptions: false,
      showDeveloperIds: false,
      developerPlanOverride: undefined,
      fileChunkUploadPoolSize: DEFAULT_FILE_CHUNK_UPLOAD_POOL_SIZE,
      getLogEventsPageSize: DEFAULT_GET_LOG_EVENTS_PAGE_SIZE,
      listDirectoryPageSize: DEFAULT_LIST_DIRECTORY_PAGE_SIZE,
      dataCatalogQueryDebounceDelay: DEFAULT_DATA_CATALOG_QUERY_DEBOUNCE_DELAY_MS,
      unsafeDarkTheme: false,
      apiKeyLimit: 5,
      debugHoverAreas: false,
      enableHeadlessUiSpike: false,
    },
  }),
  {
    name: 'enso-feature-flags',
    version: 4,
    migrate: migrateFeatureFlags,
    merge: (persistedState, currentState) => {
      const newState = { ...currentState }
      const parsedPersistedState = FEATURE_FLAGS_STATE_SCHEMA.safeParse(persistedState)

      if (parsedPersistedState.success === true) {
        unsafeMutateFeatureFlags(newState, parsedPersistedState.data.featureFlags)
      }

      if (typeof window !== 'undefined') {
        const predefinedFeatureFlags = FEATURE_FLAGS_SCHEMA.partial().safeParse(
          window.overrideFeatureFlags,
        )

        if (predefinedFeatureFlags.success) {
          const withOmittedUndefined = Object.fromEntries(
            Object.entries(predefinedFeatureFlags.data).filter(([, value]) => value != null),
          )
          // This is safe, because zod omits unset values.
          unsafeMutateFeatureFlags(newState, withOmittedUndefined)
        }
      }

      return newState
    },
  },
)

/** Composable for getting a specific feature flag. */
export function useFeatureFlag<Key extends keyof FeatureFlags>(key: Key) {
  return computed(() => flagsStore.state.value.featureFlags[key])
}

/** Get a single feature flag. Similar to `useFeatureFlag` but without using Vue reactivity. */
export function getFeatureFlag<Key extends keyof FeatureFlags>(key: Key) {
  return flagsStore.getState().featureFlags[key]
}

/** Set a subset of feature flags. */
export function setFeatureFlags(flags: Partial<FeatureFlags>) {
  flagsStore.setState({ featureFlags: { ...flagsStore.getState().featureFlags, ...flags } })
}

/** Set a single feature flag. */
export function setFeatureFlag<Key extends keyof FeatureFlags>(key: Key, value: FeatureFlags[Key]) {
  const flags: Partial<FeatureFlags> = {}
  flags[key] = value
  setFeatureFlags(flags)
}

// Define global API for managing feature flags
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'featureFlags', {
    value: flagsStore.getState().featureFlags,
    configurable: false,
    writable: false,
  })

  Object.defineProperty(window, 'setFeatureFlags', {
    value: setFeatureFlags,
    configurable: false,
    writable: false,
  })
}
