/** @file Provider for feature flags, used to enable or disable certain features in the application. */
import { unsafeWriteValue } from '#/utilities/write'
import { useZustandStoreRef } from '$/utils/zustand'
import { Plan } from 'enso-common/src/services/Backend'
import { unsafeEntries } from 'enso-common/src/utilities/data/object'
import { IS_DEV_MODE, isOnElectron, isOnLinux } from 'enso-common/src/utilities/detect'
import { z } from 'zod'
import { createStore } from 'zustand'
import { persist } from 'zustand/middleware'

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
   * Use Monaspace Neon for `--font-mono` (the code editor, docs code, tables and visualizations),
   * with a 13px code editor. On by default; kept for one release as a kill switch that restores
   * DejaVu Sans Mono and the 12px editor. #113 removes it.
   */
  enableMonaspaceCodeFont: z.boolean(),
  /**
   * Use Monaspace Neon for `--font-code`: node expressions and bindings, component browser entries
   * and the AI pending node (#112). On by default; kept for one release as a kill switch that
   * restores M PLUS 1. Monospace text is wider, so a previously tidy graph can overlap until Tidy up
   * re-spaces it. #113 removes it.
   */
  monoNodes: z.boolean(),
})

const FEATURE_FLAGS_STATE_SCHEMA = z.object({ featureFlags: FEATURE_FLAGS_SCHEMA.partial() })

/** Feature flags. */
export type FeatureFlags = z.infer<typeof FEATURE_FLAGS_SCHEMA>

/** Feature flags store. */
export interface FeatureFlagsStore {
  readonly featureFlags: FeatureFlags
  readonly setFeatureFlag: <Key extends keyof FeatureFlags>(
    key: Key,
    value: FeatureFlags[Key],
  ) => void
  readonly setFeatureFlags: (flags: Partial<FeatureFlags>) => void
}

export const flagsStore = createStore<FeatureFlagsStore>()(
  persist(
    (set) => ({
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
        enableMonaspaceCodeFont: true,
        monoNodes: true,
      },
      setFeatureFlag: (key, value) => {
        set(({ featureFlags }) => ({ featureFlags: { ...featureFlags, [key]: value } }))
      },
      setFeatureFlags: (flags) => {
        set(({ featureFlags }) => ({ featureFlags: { ...featureFlags, ...flags } }))
      },
    }),
    {
      name: 'enso-feature-flags',
      version: 3,
      migrate: migrateFeatureFlags,
      merge: (persistedState, newState) => {
        /** Mutates the state with provided feature flags. */
        function unsafeMutateFeatureFlags(flags: {
          [K in keyof FeatureFlags]?: FeatureFlags[K] | undefined
        }) {
          const newFeatureFlags = { ...newState.featureFlags }
          for (const [k, v] of unsafeEntries(flags)) {
            if (v !== undefined) {
              unsafeWriteValue(newFeatureFlags, k, v)
            }
          }
          unsafeWriteValue(newState, 'featureFlags', newFeatureFlags)
        }

        const parsedPersistedState = FEATURE_FLAGS_STATE_SCHEMA.safeParse(persistedState)

        if (parsedPersistedState.success === true) {
          unsafeMutateFeatureFlags(parsedPersistedState.data.featureFlags)
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
            unsafeMutateFeatureFlags(withOmittedUndefined)
          }
        }

        return newState
      },
    },
  ),
)

/**
 * Flags whose default changed from `false` to `true`, with the store version that changed it.
 *
 * The store persists every flag whenever any one changes (`ReactRoot` sets `enableLocalBackend` on
 * each start), so a stored `false` from before the change usually records the old default rather
 * than a choice. Migrating past that version drops it once, so that the new default applies; a
 * stored `true` is kept, and a `false` set after the migration is kept too.
 */
const DEFAULTS_TURNED_ON: readonly { flag: keyof FeatureFlags; version: number }[] = [
  { flag: 'enableMonaspaceCodeFont', version: 2 },
  { flag: 'monoNodes', version: 3 },
]

/** Upgrade persisted feature flags from an older `version`: see {@link DEFAULTS_TURNED_ON}. */
export function migrateFeatureFlags(persistedState: unknown, version: number): unknown {
  const parsed = FEATURE_FLAGS_STATE_SCHEMA.safeParse(persistedState)
  if (!parsed.success) return persistedState
  const featureFlags = { ...parsed.data.featureFlags }
  let changed = false
  for (const { flag, version: changedIn } of DEFAULTS_TURNED_ON) {
    if (version < changedIn && featureFlags[flag] === false) {
      delete featureFlags[flag]
      changed = true
    }
  }
  return changed ? { ...parsed.data, featureFlags } : persistedState
}

/** Composable for getting a specific feature flag. */
export function useFeatureFlag<Key extends keyof FeatureFlags>(key: Key) {
  return useZustandStoreRef(flagsStore, (store) => store.featureFlags[key])
}

/** Get a single feature flag. Similar to `useFeatureFlag` but without using Vue reactivity. */
export function getFeatureFlag<Key extends keyof FeatureFlags>(key: Key) {
  return flagsStore.getState().featureFlags[key]
}

/** Set a subset of feature flags. */
export function setFeatureFlags(flags: Partial<FeatureFlags>) {
  return flagsStore.getState().setFeatureFlags(flags)
}

/** Set a single feature flag. */
export function setFeatureFlag<Key extends keyof FeatureFlags>(key: Key, value: FeatureFlags[Key]) {
  return flagsStore.getState().setFeatureFlag(key, value)
}

// Define global API for managing feature flags
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'featureFlags', {
    value: flagsStore.getState().featureFlags,
    configurable: false,
    writable: false,
  })

  Object.defineProperty(window, 'setFeatureFlags', {
    value: flagsStore.getState().setFeatureFlags,
    configurable: false,
    writable: false,
  })
}
