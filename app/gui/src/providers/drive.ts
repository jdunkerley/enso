import LocalStorage from '$/utils/LocalStorage'
import { proxyRefs } from '$/utils/reactivity'
import { createContextStore } from '@/providers'
import { isDirectoryId, type DirectoryId } from 'enso-common/src/services/Backend'
import { computed, ref, watch } from 'vue'
import * as z from 'zod'
import { useBackends } from './backends'
import {
  CATEGORY_BACKEND,
  categoryEq,
  categoryFromKey,
  categoryKey,
  isCloudCategory,
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

/**
 * The drive's location: its category and directory, saved per user in `localStorage`, and whether
 * the drive is still loading a location it was sent to (`isNavigating`).
 */
export const [provideDriveLocation, useDriveLocation] = createContextStore('drive', () => {
  const backends = useBackends()
  const categories = useCategories()
  const localStorage = LocalStorage.getInstance()
  const storedDriveDisplay = computed(() => localStorage.get('driveDisplay'))
  /**
   * Whether the drive is still loading the location it was last sent to. The drive that renders
   * the location sets it (`useDriveView` in `#/layouts/Drive/driveView`, #91), and keeps showing
   * the old location meanwhile.
   */
  const isNavigating = ref(false)

  // The IDE is local-only: the drive starts on Local, and a cloud category saved by an earlier
  // version (or a team's) is not shown, since nothing lists it.
  const defaultCategory: Category = { type: 'local' }

  const currentCategory = computed({
    get: () => {
      const stored = categoryFromKey(storedDriveDisplay.value?.currentCategory)
      return stored != null && !isCloudCategory(stored) ? stored : defaultCategory
    },
    set: (category) =>
      localStorage.set('driveDisplay', {
        currentCategory: categoryKey(category),
        currentDirectoryId: null,
      }),
  })

  const currentDirectory = computed({
    get: () => storedDriveDisplay.value?.currentDirectoryId ?? null,
    set: (dir) =>
      localStorage.set('driveDisplay', {
        currentCategory: categoryKey(currentCategory.value),
        currentDirectoryId: dir,
      }),
  })

  const associatedBackend = computed(() =>
    backends.backendForType(CATEGORY_BACKEND[currentCategory.value.type]),
  )

  function setDefaultCategory() {
    localStorage.set('driveDisplay', null)
  }

  watch(
    () => categories.localCategoriesList,
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
    setDefaultCategory,
  })
})
