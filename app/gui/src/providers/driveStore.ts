/**
 * @file The drive's state: the selection, the clipboard (cut or copied assets), the asset being
 * renamed, the context menu and the drag target. Framework-free (it began as the React drive's);
 * the Vue drive, `#/layouts/DriveView.vue`, provides it with {@link provideDriveStore}.
 */
import type { Category } from '$/providers/category'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { EMPTY_SET } from '$/utils/data/set'
import type { PasteData } from '$/utils/pasteData'
import { createContextStore } from '@/providers'
import type { AnyAsset, AssetId, BackendType } from 'enso-common/src/services/Backend'
import { shallowRef, watch } from 'vue'

/** Attached data for a paste payload. */
export interface DrivePastePayload {
  readonly backendType: BackendType
  readonly category: Category
  readonly assets: readonly TransferrableAsset[]
}

/** The subset of asset information required for selections. */
export type SelectedAssetInfo =
  AnyAsset extends infer T ?
    T extends T ?
      Pick<T, keyof T & ('id' | 'labels' | 'parentId' | 'title' | 'type')>
    : never
  : never

/** Data for a context menu. */
export interface ContextMenuData {
  /** The element the menu belongs to; a React ref, or anything else with the same shape. */
  readonly triggerRef: { current: HTMLElement | null }
  readonly initialContextMenuPosition: Pick<MouseEvent, 'pageX' | 'pageY'> | null
}

/** A snapshot of the drive's state. Every change replaces it with a new object. */
export interface DriveState {
  readonly assetToRename: AssetId | null
  readonly contextMenuData: ContextMenuData | null
  /** Whether the current selection can be downloaded. */
  readonly canDownload: boolean
  readonly pasteData: PasteData<DrivePastePayload> | null
  readonly selectedIds: ReadonlySet<AssetId>
  /** The selected assets, in the order they were selected. Kept in step with `selectedIds`. */
  readonly selectedAssets: readonly SelectedAssetInfo[]
  /** The selection being drawn by a drag, before it is committed to `selectedIds`. */
  readonly visuallySelectedKeys: ReadonlySet<AssetId> | null
  /** The asset currently dragged over. */
  readonly dragTargetAssetId: AssetId | null
}

const INITIAL_DRIVE_STATE: DriveState = {
  assetToRename: null,
  contextMenuData: null,
  canDownload: false,
  pasteData: null,
  selectedIds: EMPTY_SET,
  selectedAssets: [],
  visuallySelectedKeys: null,
  dragTargetAssetId: null,
}

/**
 * Create the drive's state, one per mounted drive.
 *
 * The state is a single immutable snapshot in a shallow ref: {@link DriveStore.update} replaces it,
 * so several fields change at once and {@link DriveStore.subscribe} listeners see them together.
 * Reading `state` (or a field getter) inside a Vue `computed` or `watch` tracks it. The values are
 * never wrapped in reactive proxies, so sets and assets keep their identity.
 */
export function createDriveStore() {
  const state = shallowRef<DriveState>(INITIAL_DRIVE_STATE)

  /** Replace the given fields, notifying subscribers once. */
  function update(patch: Partial<DriveState>) {
    state.value = { ...state.value, ...patch }
  }

  /** Set one field, unless it already has that value. */
  function setIfChanged<K extends keyof DriveState>(key: K, value: DriveState[K]) {
    if (state.value[key] !== value) update({ [key]: value })
  }

  return {
    /** The current snapshot. */
    get state() {
      return state.value
    },
    get assetToRename() {
      return state.value.assetToRename
    },
    get contextMenuData() {
      return state.value.contextMenuData
    },
    get canDownload() {
      return state.value.canDownload
    },
    get pasteData() {
      return state.value.pasteData
    },
    get selectedIds() {
      return state.value.selectedIds
    },
    get selectedAssets() {
      return state.value.selectedAssets
    },
    get visuallySelectedKeys() {
      return state.value.visuallySelectedKeys
    },
    get dragTargetAssetId() {
      return state.value.dragTargetAssetId
    },
    update,
    /**
     * Call `listener` synchronously after every {@link update}, with the new and the previous
     * snapshot.
     * @returns a function that unsubscribes.
     */
    subscribe: (listener: (state: DriveState, previousState: DriveState) => void) => {
      return watch(state, listener, { flush: 'sync' })
    },
    /** Clear the selection, including one being drawn. */
    removeSelection: () => {
      update({ selectedIds: new Set(), visuallySelectedKeys: null, selectedAssets: [] })
    },
    setAssetToRename: (assetToRename: AssetId | null) => {
      setIfChanged('assetToRename', assetToRename)
    },
    setContextMenuData: (contextMenuData: ContextMenuData | null) => {
      setIfChanged('contextMenuData', contextMenuData)
    },
    setCanDownload: (canDownload: boolean) => {
      setIfChanged('canDownload', canDownload)
    },
    setPasteData: (pasteData: PasteData<DrivePastePayload> | null) => {
      setIfChanged('pasteData', pasteData)
    },
    setSelectedIds: (selectedIds: ReadonlySet<AssetId>) => {
      update({ selectedIds })
    },
    /** Select the given assets; `selectedIds` follows. */
    setSelectedAssets: (selectedAssets: readonly SelectedAssetInfo[]) => {
      if (state.value.selectedAssets !== selectedAssets) {
        update({
          selectedAssets,
          selectedIds:
            selectedAssets.length === 0 ? EMPTY_SET : new Set(selectedAssets.map(({ id }) => id)),
        })
      }
    },
    setVisuallySelectedKeys: (visuallySelectedKeys: ReadonlySet<AssetId> | null) => {
      update({ visuallySelectedKeys })
    },
    setDragTargetAssetId: (dragTargetAssetId: AssetId | null) => {
      setIfChanged('dragTargetAssetId', dragTargetAssetId)
    },
  }
}

/** The drive's state; see {@link createDriveStore}. */
export type DriveStore = ReturnType<typeof createDriveStore>

/** The drive's state, provided by the drive for its descendants. */
export const [provideDriveStore, useDriveStore] = createContextStore('driveStore', createDriveStore)
