/**
 * @file The location the drive shows, and how it moves to another one.
 *
 * The drive location (`$/providers/drive`) changes the moment a category button, a breadcrumb or a
 * row asks it to. The React drive rendered every change of location in a React transition: the old
 * directory (its bar, its rows, its `data-category`) stayed on screen until the new directory's
 * details (and, for the trash, its listing) had loaded, while `isNavigating` showed the category
 * button's spinner and the button that asked showed its own (#90, ruling 5). The specs rely on that
 * through `data-category`.
 *
 * {@link provideDriveView} gives the Vue drive the same: `shown` is the location whose data is
 * there, `target` the one asked for. Everything below the drive reads `shown`. A control that
 * navigates passes itself as the `source`, and shows a spinner while {@link DriveView.isNavigatingFrom}
 * is true for it, as each React control's own `useTransition` did.
 */
import { useAuth } from '$/providers/auth'
import { categoryKey, useCategories, type Category } from '$/providers/category'
import { useDriveLocation } from '$/providers/drive'
import { useLocalPaths } from '$/providers/localDirectories'
import { listDirectoryQueryOptions } from '$/utils/driveQueries'
import { createContextStore } from '@/providers'
import { useQuery } from '@tanstack/vue-query'
import {
  AssetDoesNotExistError,
  BackendType,
  NetworkError as OtherNetworkError,
  isUnauthorizedError,
  type AnyAsset,
  type Backend,
  type DirectoryId,
  type Path,
} from 'enso-common/src/services/Backend'
import { NetworkError } from 'enso-common/src/utilities/errors'
import invariant from 'tiny-invariant'
import { computed, onScopeDispose, shallowRef, watch, watchEffect } from 'vue'

/** A location of the drive: its category, the category's backend, and the directory in it. */
export interface DriveViewLocation {
  readonly category: Category
  readonly backend: Backend
  /** The directory chosen in the category, or `null` for the category's own root. */
  readonly directoryId: DirectoryId | null
  /** The category's root directory, or the user's. */
  readonly rootDirectoryId: DirectoryId
  /** The directory to list: `directoryId`, else the category's root (`null` for Recent). */
  readonly queryDirectoryId: DirectoryId | null
  /** The directory shown: `queryDirectoryId`, else {@link rootDirectoryId}. */
  readonly currentDirectoryId: DirectoryId
}

/** The details of a directory, as the drive bar reads them. */
export interface DirectoryDetails {
  readonly asset: AnyAsset
  readonly parentsPath: string
  readonly virtualParentsPath: string
  readonly parentId: DirectoryId
}

/** Whether two locations show the same directory of the same category. */
function sameLocation(a: DriveViewLocation, b: DriveViewLocation) {
  return (
    categoryKey(a.category) === categoryKey(b.category) &&
    a.backend === b.backend &&
    a.currentDirectoryId === b.currentDirectoryId &&
    a.queryDirectoryId === b.queryDirectoryId
  )
}

/** Query options for the details of a directory, as React's `DriveBarNavigation` had them. */
export function directoryDetailsQueryOptions(
  location: DriveViewLocation,
  rootPath: Path | null | undefined,
  onMissing: () => void,
  isStillCurrent: () => boolean,
) {
  const { backend, currentDirectoryId } = location
  return {
    queryKey: [backend.type, 'getAssetDetails', { id: currentDirectoryId }],
    queryFn: () =>
      backend.getAssetDetails(
        currentDirectoryId,
        backend.type === BackendType.local ? (rootPath ?? undefined) : undefined,
      ),
    meta: { persist: false },
    retry: (count: number, error: Error) => {
      if (isUnauthorizedError(error)) return false
      if (
        error instanceof AssetDoesNotExistError ||
        error instanceof NetworkError ||
        error instanceof OtherNetworkError
      ) {
        if (isStillCurrent()) onMissing()
        return false
      }
      return count < 3
    },
  }
}

/** Select {@link DirectoryDetails} from the details of a directory, as React did. */
export function selectDirectoryDetails(data: AnyAsset | null): DirectoryDetails | null {
  if (data == null) return null
  return {
    asset: data,
    parentsPath: data.parentsPath === '' ? data.id : data.parentsPath + '/' + data.id,
    virtualParentsPath:
      data.virtualParentsPath.length === 0 ?
        data.title
      : data.virtualParentsPath + '/' + data.title,
    parentId: data.parentId,
  }
}

/** See the file comment. */
export const [provideDriveView, useDriveView] = createContextStore('driveView', () => {
  const drive = useDriveLocation()
  const categories = useCategories()
  const auth = useAuth()
  const localPaths = useLocalPaths()

  /** The location asked for. */
  const target = computed((): DriveViewLocation => {
    const user = auth.session?.user
    invariant(user != null, 'The drive is only shown to a signed-in user.')
    const category = drive.currentCategory
    const categoryHomeDir = categories.categoryDirectoryId(category)
    const rootDirectoryId = categoryHomeDir ?? user.rootDirectoryId
    const directoryId = drive.currentDirectory
    const queryDirectoryId = directoryId ?? categoryHomeDir
    return {
      category,
      backend: drive.associatedBackend,
      directoryId,
      rootDirectoryId,
      queryDirectoryId,
      currentDirectoryId: queryDirectoryId ?? rootDirectoryId,
    }
  })

  const rootPath = computed(
    () => categories.categoryRootPath(target.value.category) ?? localPaths.localRootDirectory,
  )

  const details = useQuery(
    computed(() => {
      const location = target.value
      return {
        ...directoryDetailsQueryOptions(
          location,
          rootPath.value,
          () => drive.setDefaultCategory(),
          () => location.currentDirectoryId === target.value.currentDirectoryId,
        ),
      }
    }),
  )

  const trashListing = useQuery(
    computed(() => {
      const category = { type: 'trash' } as const
      return {
        ...listDirectoryQueryOptions({
          backend: target.value.backend,
          category,
          parentId: categories.categoryDirectoryId(category),
          refetchInterval: null,
          labels: null,
          sortDirection: null,
          sortExpression: null,
        }),
        enabled: target.value.category.type === 'trash',
      }
    }),
  )

  /** Whether the data the target needs is there, so that it can be shown. */
  const isTargetReady = computed(
    () =>
      details.data.value !== undefined &&
      (target.value.category.type !== 'trash' || trashListing.data.value !== undefined),
  )

  /** The location shown: the last one whose data was there. `null` until the first is. */
  const shown = shallowRef<DriveViewLocation | null>(null)
  /** The details of the shown location's directory. */
  const shownDetails = shallowRef<DirectoryDetails | null>(null)
  watchEffect(() => {
    if (isTargetReady.value) {
      const next = target.value
      if (shown.value == null || !sameLocation(shown.value, next)) shown.value = next
      shownDetails.value = selectDirectoryDetails(details.data.value ?? null)
    }
  })

  /** The error the target's data failed with, if it did. */
  const error = computed(() => details.error.value ?? trashListing.error.value ?? null)

  const isNavigating = computed(
    () => shown.value != null && !sameLocation(shown.value, target.value),
  )
  watch(
    isNavigating,
    (value) => {
      drive.isNavigating = value
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    drive.isNavigating = false
  })

  /** What started the pending navigation; see {@link navigate}. */
  const navigationSource = shallowRef<unknown>(null)

  /**
   * Change the location, remembering who asked, so that {@link isNavigatingFrom} can show that
   * control's spinner until the new location is shown.
   */
  function navigate(source: unknown, change: () => void) {
    navigationSource.value = source
    change()
  }

  /** Whether a navigation started by `source` is still pending. */
  function isNavigatingFrom(source: unknown) {
    return isNavigating.value && navigationSource.value === source
  }

  return {
    target,
    shown,
    /** The shown location, once there is one; only read it below a shown drive. */
    get location(): DriveViewLocation {
      invariant(shown.value != null, 'No location is shown yet.')
      return shown.value
    },
    error,
    isNavigating,
    navigate,
    isNavigatingFrom,
    /** Refetch the target's data, after an error. */
    retry: () => {
      void details.refetch()
      if (target.value.category.type === 'trash') void trashListing.refetch()
    },
    shownDetails,
  }
})

/** The drive's shown location; see {@link provideDriveView}. */
export type DriveView = ReturnType<typeof useDriveView>
