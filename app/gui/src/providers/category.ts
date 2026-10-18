import { createPersistedStore } from '$/utils/persistedStore'
import { proxyRefs } from '$/utils/reactivity'
import type { Opt } from '@/util/data/opt'
import type { Icon } from '@/util/iconMetadata/iconName'
import { createGlobalState } from '@vueuse/core'
import { BackendType, Path, type DirectoryId } from 'enso-common/src/services/Backend'
import { newDirectoryId } from 'enso-common/src/services/LocalBackend'
import { getFileName, normalizeSlashes } from 'enso-common/src/utilities/file'
import { computed } from 'vue'
import { useBackends } from './backends'
import { useLocalPaths } from './localDirectories'
import { useText } from './text'

export interface PredefinedCategory {
  type: 'local' | 'localRecent'
}

export interface LocalDirectory {
  type: 'localDirectory'
  path: Path
}

export type Category = PredefinedCategory | LocalDirectory
export type CategoryType = Category['type']

export const CATEGORY_BACKEND: Record<CategoryType, BackendType> = {
  local: BackendType.local,
  localRecent: BackendType.local,
  localDirectory: BackendType.local,
}
const LOCAL_DIRECTORY_KEY_PREFIX = 'local-'

/** A key string of panel. May be used as Set element or Map key. */
export function categoryKey(category: Category) {
  switch (category.type) {
    case 'local':
    case 'localRecent':
      return category.type
    case 'localDirectory':
      return `${LOCAL_DIRECTORY_KEY_PREFIX}${category.path}`
  }
}

/** Parse key string created by {@link categoryKey}. */
export function categoryFromKey(key: Opt<string>): Category | null {
  switch (key) {
    case 'local':
    case 'localRecent':
      return { type: key }
    default:
      if (key == null) return null
      else if (key.startsWith(LOCAL_DIRECTORY_KEY_PREFIX)) {
        return {
          type: 'localDirectory',
          path: Path(key.substring(LOCAL_DIRECTORY_KEY_PREFIX.length)),
        }
      } else return null
  }
}

/** Check categories equality. */
export function categoryEq(a: Opt<Category>, b: Opt<Category>) {
  return (a ? categoryKey(a) : '') === (b ? categoryKey(b) : '')
}

/** Whether the category is the Recent list. */
export function isRecentCategory(category: Category | CategoryType) {
  const type = typeof category === 'string' ? category : category.type
  return type === 'localRecent'
}

/** Get icon representing given category type. */
export function categoryIcon(category: CategoryType): Icon {
  switch (category) {
    case 'localRecent':
      return 'history'
    case 'local':
      return 'system'
    case 'localDirectory':
      return 'folder_small'
  }
}

interface LocalRootDirectoryStoreState {
  readonly localDirectories: readonly Path[]
}

const localDirectoryStore = createPersistedStore<LocalRootDirectoryStoreState>(
  () => ({ localDirectories: [] }),
  { name: 'enso-local-saved-directories', version: 1 },
)

/**
 * Store containing information of drive panel categories.
 *
 * Also allows adding and removing local directories.
 */
export type CategoriesStore = ReturnType<typeof createCategoriesStore>

function createCategoriesStore() {
  const { getText } = useText()
  const backends = useBackends()
  const localPaths = useLocalPaths()

  const rootPath = computed(
    () => localPaths.localRootDirectory ?? backends.localBackend?.rootPath(),
  )

  /**
   * The added folders, spelt as the local backend lists them: with forward slashes on Windows. The
   * file dialog returns backslashes there, and a folder added by an earlier version may have them.
   */
  const localDirectories = computed(() => [
    ...new Set(localDirectoryStore.state.value.localDirectories.map(normalizeSlashes)),
  ])

  const localDirectoryCategories = computed(() =>
    localDirectories.value.map((dir): LocalDirectory => ({ type: 'localDirectory', path: dir })),
  )

  const localCategoriesList = computed((): Category[] => [
    { type: 'local' },
    { type: 'localRecent' },
    ...localDirectoryCategories.value,
  ])

  function categoryLabel(category: Category) {
    switch (category.type) {
      case 'localRecent':
        return getText('recentCategory')
      case 'local':
        return getText('localCategory')
      case 'localDirectory':
        return getFileName(category.path)
    }
  }

  function categoryDirectoryId(category: Category): DirectoryId | null {
    switch (category.type) {
      case 'localRecent':
        return null
      case 'local': {
        return rootPath.value != null ? newDirectoryId(rootPath.value) : null
      }
      case 'localDirectory':
        return newDirectoryId(category.path)
    }
  }

  function getCategoryByDirectoryId(dirId: DirectoryId) {
    return localCategoriesList.value.find((category) => categoryDirectoryId(category) === dirId)
  }

  function categoryRootPath(category: Category): Path | null {
    switch (category.type) {
      case 'local':
        return rootPath.value ?? null
      case 'localDirectory':
        return category.path
      default:
        return null
    }
  }

  /**
   * Add a folder, unless it is there already. Returns its path as the category names it, which is
   * not the path given when that has backslashes on Windows: the local backend finds a folder only
   * by its forward-slash path, so a category with backslashes cannot be shown.
   */
  function addLocalDirectory(path: Path): Path {
    const normalized = normalizeSlashes(path)
    const state = localDirectoryStore.getState()
    if (!state.localDirectories.some((p) => normalizeSlashes(p) === normalized)) {
      localDirectoryStore.setState({ localDirectories: [...state.localDirectories, normalized] })
    }
    return normalized
  }

  function removeLocalDirectory(path: Path) {
    const normalized = normalizeSlashes(path)
    const state = localDirectoryStore.getState()
    const newList = state.localDirectories.filter((p) => normalizeSlashes(p) !== normalized)
    if (newList.length !== state.localDirectories.length) {
      localDirectoryStore.setState({ localDirectories: newList })
      return true
    }
    return false
  }

  return proxyRefs({
    localCategoriesList,
    categoryLabel,
    categoryDirectoryId,
    getCategoryByDirectoryId,
    categoryRootPath,
    addLocalDirectory,
    removeLocalDirectory,
  })
}

export const useCategories = createGlobalState(() => createCategoriesStore())

/**
 * The drop operation to use when transferring assets between categories.
 * @param from - The category to transfer from.
 * @param to - The category to transfer to.
 * @returns The drop operation to use.
 */
export function dropOperationBetweenCategories(
  from: Category,
  to: Category,
  parentId: DirectoryId | null = null,
): 'cancel' | 'move' {
  // Moving into the same category without a parentId is not allowed.
  if (categoryEq(from, to) && parentId == null) return 'cancel'
  if (isRecentCategory(to) || isRecentCategory(from)) return 'cancel'
  return 'move'
}

/** Whether an asset can be transferred between categories. */
export function canTransferBetweenCategories(
  from: Category,
  to: Category,
  parentId: DirectoryId | null = null,
) {
  return dropOperationBetweenCategories(from, to, parentId) !== 'cancel'
}
