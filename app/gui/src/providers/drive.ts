import LocalStorage from '$/utils/LocalStorage'
import { proxyRefs } from '$/utils/reactivity'
import { createContextStore } from '@/providers'
import { isDirectoryId, type DirectoryId } from 'enso-common/src/services/Backend'
import { computed, ref, watch } from 'vue'
import * as z from 'zod'
import { useAuth } from './auth'
import { useBackends } from './backends'
import {
  CATEGORY_BACKEND,
  categoryEq,
  categoryFromKey,
  categoryKey,
  useCategories,
  type Category,
} from './category'

const DRIVE_DISPLAY_SCHEMA = z
  .object({
    currentDirectoryId: z
      .custom<DirectoryId>((value) =>
        typeof value === 'string' && isDirectoryId(value) ? value : false,
      )
      .nullable(),
    currentCategory: z.string(),
  })
  .nullable()
declare module '$/utils/LocalStorage' {
  interface LocalStorageData {
    readonly driveDisplay: z.infer<typeof DRIVE_DISPLAY_SCHEMA>
  }
}
LocalStorage.registerKey('driveDisplay', { schema: DRIVE_DISPLAY_SCHEMA, isUserSpecific: true })

export type DriveLocationStore = ReturnType<typeof useDriveLocation>

/** A function running a change of the drive's location; see `setNavigationTransition`. */
export type NavigationTransition = (navigate: () => void) => void

/**
 * The drive's location: its category and directory, saved per user in `localStorage`, and whether
 * the drive is still loading a location it was sent to (`isNavigating`).
 */
export const [provideDriveLocation, useDriveLocation] = createContextStore('drive', () => {
  const backends = useBackends()
  const categories = useCategories()
  const auth = useAuth()
  const localStorage = LocalStorage.getInstance()
  const storedDriveDisplay = computed(() => localStorage.get('driveDisplay'))
  /**
   * Whether the drive is still loading the location it was last sent to. The drive that renders
   * the location sets it.
   */
  const isNavigating = ref(false)
  let navigationTransition: NavigationTransition | undefined

  /** Run a change of location in the drive's transition, if it has one. */
  function navigate(change: () => void) {
    if (navigationTransition != null) navigationTransition(change)
    else change()
  }

  /**
   * Set how a change of location runs: the React drive passes React's `startTransition`, so it
   * keeps showing the old location while the new one loads. `undefined` runs changes at once.
   */
  function setNavigationTransition(transition: NavigationTransition | undefined) {
    navigationTransition = transition
  }

  // In degraded-auth mode the user must land on cloud so the "Enso Cloud is unavailable"
  // stub (rendered by the cloud-category view) is visible after sign-in. Otherwise the
  // existing local-first default would silently hide the failure. When auth is disabled
  // entirely there is no cloud to fail, so the local-first default applies.
  const defaultCategory = computed<Category>(() => {
    if (auth.session?.isCloudDataUnavailable && !auth.session.isAuthDisabled)
      return { type: 'cloud' }
    return backends.localBackend != null ? { type: 'local' } : { type: 'cloud' }
  })

  const currentCategory = computed({
    get: () => categoryFromKey(storedDriveDisplay.value?.currentCategory) ?? defaultCategory.value,
    set: (category) =>
      navigate(() =>
        localStorage.set('driveDisplay', {
          currentCategory: categoryKey(category),
          currentDirectoryId: null,
        }),
      ),
  })

  const currentDirectory = computed({
    get: () => storedDriveDisplay.value?.currentDirectoryId ?? null,
    set: (dir) =>
      navigate(() =>
        localStorage.set('driveDisplay', {
          currentCategory: categoryKey(currentCategory.value),
          currentDirectoryId: dir,
        }),
      ),
  })

  const associatedBackend = computed(() =>
    backends.backendForType(CATEGORY_BACKEND[currentCategory.value.type]),
  )

  function setDefaultCategory() {
    localStorage.set('driveDisplay', null)
  }

  watch(
    () => [...categories.localCategoriesList, ...categories.cloudCategoriesList],
    (newList) => {
      if (!newList.find((category) => categoryEq(category, currentCategory.value))) {
        setDefaultCategory()
      }
    },
  )

  return proxyRefs({
    currentCategory,
    currentDirectory,
    associatedBackend,
    isNavigating,
    setNavigationTransition,
    setDefaultCategory,
  })
})
