/**
 * @file The React side of the drive's state (`$/providers/driveStore`): a provider creating one
 * store per mounted drive, and hooks reading it.
 *
 * To be deleted in #91, with the React drive: the Vue drive provides the store itself
 * (`provideDriveStore`).
 */
import { useStore, type ReadonlyStoreApi, type UseStoreOptions } from '#/hooks/storeHooks'
import {
  createDriveStore,
  type DriveState,
  type DriveStore,
  type SelectedAssetInfo,
} from '$/providers/driveStore'
import type { AssetId } from 'enso-common/src/services/Backend'
import * as React from 'react'
import invariant from 'tiny-invariant'

/** A drive store, and the same store in the shape `useStore` subscribes to. */
interface DriveContextValue {
  readonly store: DriveStore
  readonly storeApi: ReadonlyStoreApi<DriveState>
}

const DriveContext = React.createContext<DriveContextValue | null>(null)

/** Props for a {@link DriveProvider}. */
export interface DriveProviderProps extends React.PropsWithChildren {}

/** A React provider of a new drive store, for the drive below it. */
export default function DriveProvider(props: DriveProviderProps) {
  const { children } = props

  const [value] = React.useState((): DriveContextValue => {
    const store = createDriveStore()
    const initialState = store.state
    return {
      store,
      // `useStore` re-renders through this; it is not a zustand store.
      storeApi: {
        getState: () => store.state,
        getInitialState: () => initialState,
        subscribe: (listener) => store.subscribe(listener),
      },
    }
  })

  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

/** The context's value, which only a {@link DriveProvider} provides. */
function useDriveContext() {
  const value = React.useContext(DriveContext)

  invariant(value, 'Drive store can only be used inside an `DriveProvider`.')

  return value
}

/** The drive store. Reading it does not re-render; use {@link useDriveState} for that. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDriveStore() {
  return useDriveContext().store
}

/** A slice of the drive's state, re-rendering when it changes (by `options.areEqual`). */
// eslint-disable-next-line react-refresh/only-export-components
export function useDriveState<Slice>(
  selector: (state: DriveState) => Slice,
  options?: UseStoreOptions<Slice>,
) {
  return useStore(useDriveContext().storeApi, selector, options)
}

/** A function to set the ID of the asset to rename. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetAssetToRename() {
  return useDriveStore().setAssetToRename
}

/** Whether the current Asset Table selection is downloadble. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCanDownload() {
  return useDriveState((state) => state.canDownload)
}

/** A function to set whether the current Asset Table selection is downloadble. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetCanDownload() {
  return useDriveStore().setCanDownload
}

/** The paste data for the Asset Table. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePasteData() {
  return useDriveState((state) => state.pasteData)
}

/** A function to set the paste data for the Asset Table. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetPasteData() {
  return useDriveStore().setPasteData
}

/** The selected assets in the Asset Table. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSelectedAssets(): readonly SelectedAssetInfo[] {
  return useDriveState((state) => state.selectedAssets)
}

/** A function to set the selected assets in the Asset Table. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetSelectedAssets() {
  return useDriveStore().setSelectedAssets
}

/** A function to set the visually selected keys in the Asset Table. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetVisuallySelectedKeys() {
  return useDriveStore().setVisuallySelectedKeys
}

/** A function to set which {@link AssetId} is the one currently being dragged over. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSetDragTargetAssetId(): (assetId: AssetId | null) => void {
  return useDriveStore().setDragTargetAssetId
}
