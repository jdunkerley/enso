import { useContainerData as useContainerDataVue, type ContainerData } from '$/providers/container'
import {
  useDriveLocation as useDriveStoreVue,
  type DriveLocationStore,
  type NavigationTransition,
} from '$/providers/drive'
import { useInReactFunction, useVueRef, useVueValue } from '$/providers/react/common'
import {
  useRightPanelData as useRightPanelDataVue,
  type RightPanelData,
} from '$/providers/rightPanel'
import { reactComponent } from '$/utils/react'
import type { Backend, DirectoryId } from 'enso-common/src/services/Backend'
import * as react from 'react'
import { toRef } from 'vue'
import type { Category } from '../category'

const RightPanelDataContext = react.createContext<RightPanelData | null>(null)
export const useRightPanelData = useInReactFunction(RightPanelDataContext)

const ContainerDataContext = react.createContext<ContainerData | null>(null)
export const useContainerData = useInReactFunction(ContainerDataContext)

export const DriveLocationStoreContext = react.createContext<{
  currentCategory: [Category, (newCategory: Category) => void]
  currentDirectory: [DirectoryId | null, (newDir: DirectoryId | null) => void]
  associatedBackend: Backend
  setNavigationTransition: (transition: NavigationTransition | undefined) => void
  setIsNavigating: (isNavigating: boolean) => void
  setDefaultCategory: () => void
} | null>(null)
export const useDriveLocation = useInReactFunction(DriveLocationStoreContext)

export const ContainerProviderForReact = reactComponent(
  ({
    container,
    rightPanel,
    driveStore,
    children,
  }: react.PropsWithChildren<{
    container: ContainerData
    rightPanel: RightPanelData
    driveStore: DriveLocationStore
  }>) => {
    const reactDriveStore = {
      currentCategory: useVueRef(
        react.useCallback(() => toRef(driveStore, 'currentCategory'), [driveStore]),
      ),
      currentDirectory: useVueRef(
        react.useCallback(() => toRef(driveStore, 'currentDirectory'), [driveStore]),
      ),
      associatedBackend: useVueValue(
        react.useCallback(() => driveStore.associatedBackend, [driveStore]),
      ),
      setNavigationTransition: driveStore.setNavigationTransition,
      setIsNavigating: react.useCallback(
        (isNavigating: boolean) => {
          driveStore.isNavigating = isNavigating
        },
        [driveStore],
      ),
      setDefaultCategory: driveStore.setDefaultCategory,
    }
    return (
      <ContainerDataContext.Provider value={container}>
        <RightPanelDataContext.Provider value={rightPanel}>
          <DriveLocationStoreContext.Provider value={reactDriveStore}>
            {children}
          </DriveLocationStoreContext.Provider>
        </RightPanelDataContext.Provider>
      </ContainerDataContext.Provider>
    )
  },
  {
    useInjectPropsFromWrapper: () => {
      const result = {
        container: useContainerDataVue(),
        rightPanel: useRightPanelDataVue(),
        driveStore: useDriveStoreVue(),
      }
      // Avoid annoying warning about __veauryInjectedProps__ property by returning a function.
      return () => result
    },
  },
) as any

/**
 * A hook to read currently focused asset for right panel, e.g. the currently selected asset
 * in Drive View.
 */
export function useRightPanelFocusedAsset() {
  const rightPanel = useRightPanelData()
  return useVueValue(react.useCallback(() => rightPanel.focusedAsset, [rightPanel]))
}

/** A hook reading current category set for right panel context. */
export function useRightPanelContextCategory() {
  const rightPanel = useRightPanelData()
  return useVueValue(react.useCallback(() => rightPanel.context?.category, [rightPanel]))
}

/** A hook reading current category displayed in drive. */
export function useDriveCurrentCategory() {
  const drive = useDriveLocation()
  return drive.currentCategory
}

/** A hook reading backend associated with current category in drive. */
export function useDriveCurrentBackend() {
  const drive = useDriveLocation()
  return drive.associatedBackend
}

/** A hook reading current directory id displayed in drive. */
export function useDriveCurrentDirectory() {
  const drive = useDriveLocation()
  return drive.currentDirectory
}

/**
 * Run the drive's changes of location in a React transition, so the drive keeps showing the old
 * location while the new one suspends, and report the transition as the drive store's
 * `isNavigating` (which the category buttons show as a spinner). For the React drive, until #91.
 */
export function useDriveNavigationTransition() {
  const { setNavigationTransition, setIsNavigating } = useDriveLocation()
  const [isPending, startTransition] = react.useTransition()
  react.useEffect(() => {
    setNavigationTransition(startTransition)
    return () => {
      setNavigationTransition(undefined)
    }
  }, [setNavigationTransition, startTransition])
  // Set once React has committed the pending state, as the dashboard passed it to Vue before.
  react.useEffect(() => {
    setIsNavigating(isPending)
  }, [isPending, setIsNavigating])
  react.useEffect(
    () => () => {
      setIsNavigating(false)
    },
    [setIsNavigating],
  )
}
