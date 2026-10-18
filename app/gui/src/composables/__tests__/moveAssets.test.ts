/** @file Moving and copying assets between the local drive's folders, from Vue. */
import { useMoveAssets } from '$/composables/moveAssets'
import type { Category } from '$/providers/category'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import {
  AssetType,
  DirectoryId,
  Path,
  type AssetId,
  type Backend,
} from 'enso-common/src/services/Backend'
import { newDirectoryId } from 'enso-common/src/services/LocalBackend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const { local, LOCAL_ROOT } = vi.hoisted(() => ({
  local: {
    copyAsset: vi.fn<Backend['copyAsset']>(),
    updateAsset: vi.fn<Backend['updateAsset']>(),
  },
  LOCAL_ROOT: 'directory-local-root' as DirectoryId,
}))

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  const backends = mockBackends({ localBackend: local })
  return { useBackends: () => backends }
})
vi.mock('$/providers/category', async (importOriginal) => {
  const original = await importOriginal<typeof import('$/providers/category')>()
  const { newDirectoryId } = await import('enso-common/src/services/LocalBackend')
  return {
    ...original,
    useCategories: () => ({
      categoryDirectoryId: (category: Category) =>
        category.type === 'local' ? LOCAL_ROOT
        : category.type === 'localDirectory' ? newDirectoryId(category.path)
        : null,
    }),
  }
})

const LOCAL_DIR: Category = { type: 'localDirectory', path: Path('/a') }
const LOCAL_DIR_ID = newDirectoryId(Path('/a'))

/** An asset in a directory. */
function asset(id: string): TransferrableAsset {
  return {
    id: id as AssetId,
    title: id,
    type: AssetType.file,
    parentId: DirectoryId('directory-parent'),
    parentsPath: 'directory-local-root',
    virtualParentsPath: '',
  }
}

beforeEach(() => {
  for (const mock of Object.values(local)) mock.mockReset()
  local.copyAsset.mockResolvedValue({} as never)
  local.updateAsset.mockResolvedValue(undefined)
})

/** Mount a probe component, and return the composable's function. */
async function setup() {
  let move!: ReturnType<typeof useMoveAssets>
  const Probe = defineComponent({
    setup() {
      move = useMoveAssets()
      return () => h('div')
    },
  })
  await mountWithProviders(Probe)
  return move
}

describe('useMoveAssets', () => {
  test('moving into a local folder updates each asset’s parent on the local backend', async () => {
    const move = await setup()
    await move({ type: 'local' }, LOCAL_DIR, [asset('file-a')], null, 'move')
    expect(local.updateAsset).toHaveBeenCalledWith(
      'file-a',
      expect.objectContaining({ parentDirectoryId: LOCAL_DIR_ID }),
      '(unknown)',
    )
  })

  test('copy asks the local backend to copy', async () => {
    const move = await setup()
    await move({ type: 'local' }, LOCAL_DIR, [asset('file-a')], null, 'copy')
    expect(local.copyAsset).toHaveBeenCalledWith('file-a', LOCAL_DIR_ID)
  })

  test('a drop into Recent does nothing', async () => {
    const move = await setup()
    await move({ type: 'local' }, { type: 'localRecent' }, [asset('file-a')])
    expect(local.updateAsset).not.toHaveBeenCalled()
  })
})
