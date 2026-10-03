/**
 * @file The React adapters over the drive's Vue-side state (#90): the drive store's provider and
 * hooks, and the transition the React drive runs its changes of location in.
 */
import DriveProvider, {
  useDriveState,
  useDriveStore,
  useSelectedAssets,
} from '#/providers/DriveProvider'
import type { DriveStore } from '$/providers/driveStore'
import {
  DriveLocationStoreContext,
  useDriveNavigationTransition,
} from '$/providers/react/container'
import { act, render, renderHook } from '@testing-library/react'
import { AssetType, type AssetId, type DirectoryId } from 'enso-common/src/services/Backend'
import { Suspense, useState, type ContextType, type PropsWithChildren } from 'react'
import { describe, expect, test, vi } from 'vitest'

const FOLDER = {
  id: 'directory-a' as AssetId,
  type: AssetType.directory,
  title: 'A',
  parentId: 'directory-parent' as DirectoryId,
  labels: [],
} as const

describe('DriveProvider', () => {
  test('hooks re-render with the slice they select, and only when it changes', () => {
    let renders = 0
    const { result } = renderHook(
      () => {
        renders += 1
        return {
          store: useDriveStore(),
          isRenaming: useDriveState((state) => state.assetToRename === FOLDER.id),
          selectedAssets: useSelectedAssets(),
        }
      },
      { wrapper: DriveProvider },
    )
    expect(result.current.isRenaming).toBe(false)
    const rendersBefore = renders
    act(() => {
      result.current.store.setDragTargetAssetId(FOLDER.id)
    })
    expect(renders).toBe(rendersBefore)
    act(() => {
      result.current.store.setAssetToRename(FOLDER.id)
    })
    expect(result.current.isRenaming).toBe(true)
    act(() => {
      result.current.store.setSelectedAssets([FOLDER])
    })
    expect(result.current.selectedAssets).toEqual([FOLDER])
  })

  test('each provider has its own store, kept across re-renders', () => {
    const stores: DriveStore[] = []
    function Probe() {
      stores.push(useDriveStore())
      return null
    }
    const { rerender } = render(
      <>
        <DriveProvider>
          <Probe />
        </DriveProvider>
        <DriveProvider>
          <Probe />
        </DriveProvider>
      </>,
    )
    expect(stores[0]).not.toBe(stores[1])
    const [first] = stores
    rerender(
      <>
        <DriveProvider>
          <Probe />
        </DriveProvider>
        <DriveProvider>
          <Probe />
        </DriveProvider>
      </>,
    )
    expect(stores[2]).toBe(first)
  })

  test('outside a provider, the hooks fail loudly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useDriveStore())).toThrow(/DriveProvider/)
  })
})

type DriveLocation = NonNullable<ContextType<typeof DriveLocationStoreContext>>

/** A drive location whose transition and navigation state are recorded. */
function makeDriveLocation() {
  let transition: ((change: () => void) => void) | undefined
  const isNavigating: boolean[] = []
  const location: DriveLocation = {
    currentCategory: [{ type: 'local' }, () => {}],
    currentDirectory: [null, () => {}],
    // Not read by the hook under test.
    associatedBackend: null as unknown as DriveLocation['associatedBackend'],
    setNavigationTransition: (newTransition) => {
      transition = newTransition
    },
    setIsNavigating: (value) => {
      isNavigating.push(value)
    },
    setDefaultCategory: () => {},
  }
  return { location, isNavigating, getTransition: () => transition }
}

describe('useDriveNavigationTransition', () => {
  test('installs a transition while mounted, and reports that nothing navigates', () => {
    const { location, isNavigating, getTransition } = makeDriveLocation()
    const { unmount } = renderHook(() => useDriveNavigationTransition(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <DriveLocationStoreContext.Provider value={location}>
          {children}
        </DriveLocationStoreContext.Provider>
      ),
    })
    expect(getTransition()).toBeTypeOf('function')
    expect(isNavigating.at(-1)).toBe(false)
    unmount()
    expect(getTransition()).toBeUndefined()
    expect(isNavigating.at(-1)).toBe(false)
  })

  test('a change that suspends keeps the old content, and is reported as navigating', async () => {
    const { location, isNavigating, getTransition } = makeDriveLocation()
    let resolve = () => {}
    const pending = new Promise<void>((r) => {
      resolve = r
    })
    let loaded = false
    let setDirectory: (directory: string) => void = () => {}

    function Listing(props: { readonly directory: string }) {
      if (props.directory !== 'root' && !loaded) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw pending
      }
      return <span>{props.directory}</span>
    }
    function Drive() {
      useDriveNavigationTransition()
      const [directory, setDirectoryState] = useState('root')
      setDirectory = setDirectoryState
      return (
        <Suspense fallback={<span>loading</span>}>
          <Listing directory={directory} />
        </Suspense>
      )
    }

    const view = render(
      <DriveLocationStoreContext.Provider value={location}>
        <Drive />
      </DriveLocationStoreContext.Provider>,
    )
    expect(view.getByText('root')).toBeTruthy()
    act(() => {
      getTransition()?.(() => {
        setDirectory('child')
      })
    })
    expect(view.queryByText('loading')).toBeNull()
    expect(view.getByText('root')).toBeTruthy()
    expect(isNavigating.at(-1)).toBe(true)
    await act(async () => {
      loaded = true
      resolve()
      await pending
    })
    expect(view.getByText('child')).toBeTruthy()
    expect(isNavigating.at(-1)).toBe(false)
  })
})
