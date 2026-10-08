/**
 * @file The local directories: the root directory of local projects, and the download directory.
 *
 * One store holds both, persisted under `enso-local-directory`, and everything reads and writes
 * them through it: the settings page's Local tab, the drive's Local category (Vue, through
 * {@link useLocalPaths}), and the local backend (through {@link localPathsStore}).
 * There used to be two stores persisting the same entry, each loading it once at start-up, so a
 * change in Settings reached the Local category only after a reload (#182).
 */
import LocalStorage from '$/utils/LocalStorage'
import { createPersistedStore } from '$/utils/persistedStore'
import { proxyRefs } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import { Path } from 'enso-common/src/services/Backend'
import { computed, inject } from 'vue'
import { z } from 'zod'

declare module '$/utils/LocalStorage' {
  /** */
  interface LocalStorageData {
    /** @deprecated Read only to migrate it: use {@link localPathsStore}. */
    readonly localRootDirectory: string
  }
}
LocalStorage.registerKey('localRootDirectory', { schema: z.string() })

/** State for {@link localPathsStore}. */
export interface LocalPathsStoreState {
  readonly localRootDirectory: Path | null
  readonly downloadDirectory: Path | null
}

/**
 * The saved local directories; `null` means the default. A root directory saved under the legacy
 * `localRootDirectory` key is the initial value, which a value saved by this store overrides.
 */
export const localPathsStore = createPersistedStore<LocalPathsStoreState>(
  () => ({
    localRootDirectory: (() => {
      const oldPath = LocalStorage.getInstance().get('localRootDirectory')
      return oldPath != null ? Path(oldPath) : null
    })(),
    downloadDirectory: null,
  }),
  { name: 'enso-local-directory', version: 1 },
)

/** Update the saved local root directory; `null` restores the default. */
export function setLocalRootDirectory(localRootDirectory: Path | null) {
  localPathsStore.setState({ localRootDirectory })
}

/** Update the saved download directory; `null` restores the default. */
export function setDownloadDirectory(downloadDirectory: Path | null) {
  localPathsStore.setState({ downloadDirectory })
}

export type LocalPathsStore = ReturnType<typeof createLocalPathsStore>

function createLocalPathsStore() {
  const defaultDownloadPath = inject<Path>('defaultDownloadPath')

  const localRootDirectory = computed(() => localPathsStore.state.value.localRootDirectory)
  const storedDownloadDirectory = computed(() => localPathsStore.state.value.downloadDirectory)

  const downloadDirectory = computed(() => storedDownloadDirectory.value ?? defaultDownloadPath)

  return proxyRefs({
    localRootDirectory,
    downloadDirectory,
    setLocalRootDirectory,
    setDownloadDirectory,
  })
}

export const useLocalPaths = createGlobalState(createLocalPathsStore)
