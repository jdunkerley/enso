/** @file The drive's state (#90): selection, clipboard, rename target and the rest. */
import { createDriveStore, type DriveState } from '$/providers/driveStore'
import { EMPTY_SET } from '$/utils/data/set'
import {
  AssetType,
  BackendType,
  type AssetId,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { computed, isProxy } from 'vue'

const PARENT_ID = 'directory-parent' as DirectoryId
const FOLDER = {
  id: 'directory-a' as AssetId,
  type: AssetType.directory,
  title: 'A',
  parentId: PARENT_ID,
  labels: [],
} as const
const PROJECT = {
  id: 'project-b' as AssetId,
  type: AssetType.project,
  title: 'B',
  parentId: PARENT_ID,
  labels: [],
} as const

describe('createDriveStore', () => {
  test('starts empty', () => {
    const store = createDriveStore()
    expect(store.state).toEqual<DriveState>({
      assetToRename: null,
      contextMenuData: null,
      canDownload: false,
      pasteData: null,
      selectedIds: EMPTY_SET,
      selectedAssets: [],
      visuallySelectedKeys: null,
      dragTargetAssetId: null,
    })
  })

  test('each store has its own state', () => {
    const first = createDriveStore()
    const second = createDriveStore()
    first.setAssetToRename(FOLDER.id)
    expect(second.assetToRename).toBeNull()
  })

  describe('selection', () => {
    test('selecting assets sets the selected ids, in step', () => {
      const store = createDriveStore()
      store.setSelectedAssets([FOLDER, PROJECT])
      expect(store.selectedAssets).toEqual([FOLDER, PROJECT])
      expect([...store.selectedIds]).toEqual([FOLDER.id, PROJECT.id])
      store.setSelectedAssets([])
      expect(store.selectedIds).toBe(EMPTY_SET)
    })

    test('selecting the same array again changes nothing', () => {
      const store = createDriveStore()
      const selection = [FOLDER]
      store.setSelectedAssets(selection)
      const listener = vi.fn()
      store.subscribe(listener)
      store.setSelectedAssets(selection)
      expect(listener).not.toHaveBeenCalled()
    })

    test('removing the selection clears the ids, the assets and a drawn selection', () => {
      const store = createDriveStore()
      store.setSelectedAssets([FOLDER])
      store.setVisuallySelectedKeys(new Set([PROJECT.id]))
      store.removeSelection()
      expect(store.selectedIds.size).toBe(0)
      expect(store.selectedAssets).toEqual([])
      expect(store.visuallySelectedKeys).toBeNull()
    })

    test('sets keep their identity: the state is not wrapped in proxies', () => {
      const store = createDriveStore()
      const ids = new Set([FOLDER.id])
      store.setSelectedIds(ids)
      expect(store.selectedIds).toBe(ids)
      expect(isProxy(store.selectedIds)).toBe(false)
    })
  })

  describe('clipboard', () => {
    test('cut assets are kept until replaced or cleared', () => {
      const store = createDriveStore()
      const pasteData = {
        type: 'move',
        data: {
          backendType: BackendType.local,
          category: { type: 'local' },
          assets: [{ id: FOLDER.id, title: FOLDER.title, parentsPath: '', virtualParentsPath: '' }],
        },
      } as const
      store.setPasteData(pasteData)
      expect(store.pasteData).toBe(pasteData)
      store.setPasteData(null)
      expect(store.pasteData).toBeNull()
    })
  })

  describe('drafts', () => {
    test('the asset to rename, the context menu and the drag target', () => {
      const store = createDriveStore()
      store.setAssetToRename(FOLDER.id)
      expect(store.assetToRename).toBe(FOLDER.id)
      const contextMenuData = { triggerRef: { current: null }, initialContextMenuPosition: null }
      store.setContextMenuData(contextMenuData)
      expect(store.contextMenuData).toBe(contextMenuData)
      store.setDragTargetAssetId(PROJECT.id)
      expect(store.dragTargetAssetId).toBe(PROJECT.id)
      store.setCanDownload(true)
      expect(store.canDownload).toBe(true)
    })

    test('setting a field to the value it has notifies no one', () => {
      const store = createDriveStore()
      store.setAssetToRename(FOLDER.id)
      const listener = vi.fn()
      store.subscribe(listener)
      store.setAssetToRename(FOLDER.id)
      store.setCanDownload(false)
      store.setDragTargetAssetId(null)
      store.setPasteData(null)
      store.setContextMenuData(null)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    test('a listener sees several fields change at once, synchronously, with the old state', () => {
      const store = createDriveStore()
      const calls: [DriveState, DriveState][] = []
      store.subscribe((state, previous) => calls.push([state, previous]))
      const before = store.state
      store.update({ selectedIds: new Set([FOLDER.id]), visuallySelectedKeys: new Set() })
      expect(calls).toHaveLength(1)
      const [[state, previous]] = calls as [[DriveState, DriveState]]
      expect(previous).toBe(before)
      expect([...state.selectedIds]).toEqual([FOLDER.id])
      expect(state.visuallySelectedKeys?.size).toBe(0)
    })

    test('every update notifies, as the React subscribers expect', () => {
      const store = createDriveStore()
      const listener = vi.fn()
      store.subscribe(listener)
      store.update({})
      store.setSelectedIds(store.selectedIds)
      expect(listener).toHaveBeenCalledTimes(2)
    })

    test('unsubscribing stops the notifications', () => {
      const store = createDriveStore()
      const listener = vi.fn()
      const unsubscribe = store.subscribe(listener)
      unsubscribe()
      store.setAssetToRename(FOLDER.id)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  test('Vue tracks the fields', () => {
    const store = createDriveStore()
    const count = computed(() => store.selectedIds.size)
    expect(count.value).toBe(0)
    store.setSelectedAssets([FOLDER, PROJECT])
    expect(count.value).toBe(2)
  })
})
