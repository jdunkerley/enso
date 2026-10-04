/**
 * @file Moving and copying assets between drive categories from Vue (#192): what each pair of
 * categories does, and the "copy instead" question, answered in the dialog itself, for moves out
 * of a team's folder (to another team, to the user's folder, to the local drive) and restores into
 * another category.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useTransferBetweenCategories } from '$/composables/transferBetweenCategories'
import type { Category } from '$/providers/category'
import { useModals } from '$/providers/modals'
import { useToasts } from '$/providers/toasts'
import type { TransferrableAsset } from '$/utils/assetsDataTransfer'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  DirectoryId,
  type AssetId,
  type Backend,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const { remote, local, uploadFile, ROOT, TRASH, LOCAL_ROOT, TEAM_A, TEAM_B, TEAM_HOMES } =
  vi.hoisted(() => {
    // `vi.mock` factories run before this file's imports and constants, so they are made here.
    const id = (value: string) => value as DirectoryId
    return {
      remote: {
        copyAsset: vi.fn<Backend['copyAsset']>(),
        updateAsset: vi.fn<Backend['updateAsset']>(),
        deleteAsset: vi.fn<Backend['deleteAsset']>(),
        undoDeleteAsset: vi.fn<Backend['undoDeleteAsset']>(),
        download: vi.fn<Backend['download']>(),
      },
      local: {
        copyAsset: vi.fn<Backend['copyAsset']>(),
        updateAsset: vi.fn<Backend['updateAsset']>(),
      },
      uploadFile: vi.fn(),
      ROOT: id('directory-root'),
      TRASH: id('directory-trash'),
      LOCAL_ROOT: id('directory-local-root'),
      TEAM_A: { type: 'team', groupId: 'usergroup-a' } as Category,
      TEAM_B: { type: 'team', groupId: 'usergroup-b' } as Category,
      TEAM_HOMES: new Map([
        ['usergroup-a', id('directory-team-a')],
        ['usergroup-b', id('directory-team-b')],
      ]),
    }
  })

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  const backends = mockBackends({ remoteBackend: remote, localBackend: local })
  return { useBackends: () => backends }
})
vi.mock('$/providers/auth', () => ({
  useAuth: () => ({ session: { user: { rootDirectoryId: 'directory-root' } } }),
}))
vi.mock('$/providers/category', async (importOriginal) => {
  const original = await importOriginal<typeof import('$/providers/category')>()
  const directoryId = (category: Category): DirectoryId | null => {
    switch (category.type) {
      case 'cloud':
        return ROOT
      case 'trash':
        return TRASH
      case 'local':
        return LOCAL_ROOT
      case 'team':
        return TEAM_HOMES.get(category.groupId) ?? null
      default:
        return null
    }
  }
  const all: Category[] = [{ type: 'cloud' }, { type: 'trash' }, { type: 'local' }, TEAM_A, TEAM_B]
  return {
    ...original,
    useCategories: () => ({
      categoryDirectoryId: directoryId,
      getCategoryByDirectoryId: (id: DirectoryId) =>
        all.find((category) => directoryId(category) === id),
      categoryLabel: (category: Category) =>
        category.type === 'team' ? `Team ${category.groupId.slice(-1).toUpperCase()}`
        : category.type === 'cloud' ? 'Cloud'
        : category.type === 'local' ? 'Local'
        : 'Trash',
    }),
  }
})
vi.mock('$/providers/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$/providers/upload')>()),
  useUploadsToCloudStore: () => ({ uploadFile }),
}))
vi.mock('$/providers/httpClient', () => ({ useHttpClient: () => ({ get: vi.fn() }) }))

/** An asset in a directory; `parentsPath` places it in a category. */
function asset(id: string, parentsPath = 'directory-root'): TransferrableAsset {
  return {
    id: id as AssetId,
    title: id,
    type: AssetType.file,
    parentId: DirectoryId('directory-parent'),
    parentsPath,
    virtualParentsPath: '',
  }
}

let portalRoot: HTMLElement

beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  for (const mock of [...Object.values(remote), ...Object.values(local), uploadFile]) {
    mock.mockReset()
  }
  remote.copyAsset.mockResolvedValue({} as never)
  local.copyAsset.mockResolvedValue({} as never)
  remote.updateAsset.mockResolvedValue(undefined)
  local.updateAsset.mockResolvedValue(undefined)
})

afterEach(() => {
  useModals().closeAll()
  portalRoot.remove()
})

/** Mount the modal host, and return the composable's function. */
async function setup() {
  let transfer!: ReturnType<typeof useTransferBetweenCategories>
  const Probe = defineComponent({
    setup() {
      transfer = useTransferBetweenCategories()
      return () => h(ModalHost)
    },
  })
  await mountWithProviders(Probe)
  return transfer
}

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')

/** Wait for the "copy instead" question, check it, and answer it with the given button. */
async function answer(button: 'Copy instead' | 'Cancel', message: string, description: string) {
  await vi.waitFor(() => expect(dialog()).not.toBeNull())
  const shown = dialog()!
  expect(shown.querySelector('h2')!.textContent!.trim()).toBe('Action is unavailable')
  expect(shown.textContent).toContain(message)
  expect(shown.textContent).toContain(description)
  const target = [...shown.querySelectorAll('button')].find(
    (element) => element.textContent!.trim() === button,
  )!
  await userEvent.click(target)
}

const YOU_CAN_COPY =
  'You can copy these assets to another category while keeping the originals intact.'

describe('useTransferBetweenCategories', () => {
  test('moves assets within the cloud', async () => {
    const transfer = await setup()
    await transfer(
      { type: 'cloud' },
      { type: 'cloud' },
      [asset('file-1')],
      DirectoryId('directory-x'),
    )
    await vi.waitFor(() => expect(remote.updateAsset).toHaveBeenCalledOnce())
    expect(remote.updateAsset).toHaveBeenCalledWith(
      'file-1',
      { description: null, parentDirectoryId: 'directory-x', title: null, metadataId: null },
      '(unknown)',
    )
    expect(dialog()).toBeNull()
  })

  test('copies, rather than moves, when asked to copy', async () => {
    const transfer = await setup()
    await transfer({ type: 'cloud' }, { type: 'cloud' }, [asset('file-1')], ROOT, 'copy')
    await vi.waitFor(() => expect(remote.copyAsset).toHaveBeenCalledWith('file-1', ROOT))
    expect(remote.updateAsset).not.toHaveBeenCalled()
  })

  test('deletes assets dropped on the trash', async () => {
    const transfer = await setup()
    await transfer({ type: 'cloud' }, { type: 'trash' }, [asset('file-1'), asset('file-2')])
    expect(remote.deleteAsset.mock.calls).toEqual([
      ['file-1', { force: false }, '(unknown)'],
      ['file-2', { force: false }, '(unknown)'],
    ])
  })

  test("moving from one team's folder to another asks, and copies on confirmation", async () => {
    const transfer = await setup()
    const done = transfer(TEAM_A, TEAM_B, [asset('file-1')])
    await answer('Copy instead', 'Moving assets from Team A is unavailable', YOU_CAN_COPY)
    await done
    expect(remote.copyAsset).toHaveBeenCalledWith('file-1', 'directory-team-b')
    expect(remote.updateAsset).not.toHaveBeenCalled()
  })

  test.each([
    ['another team', TEAM_B],
    ["the user's folder", { type: 'cloud' } as Category],
  ])('cancelling the question moving to %s does nothing (#200)', async (_, to) => {
    const transfer = await setup()
    const done = transfer(TEAM_A, to, [asset('file-1')])
    await answer('Cancel', 'Moving assets from Team A is unavailable', YOU_CAN_COPY)
    await done
    await flushPromises()
    for (const mock of [...Object.values(remote), ...Object.values(local), uploadFile]) {
      expect(mock).not.toHaveBeenCalled()
    }
  })

  test("copying from one team's folder to another does not ask", async () => {
    const transfer = await setup()
    await transfer(TEAM_A, TEAM_B, [asset('file-1')], null, 'copy')
    expect(remote.copyAsset).toHaveBeenCalledWith('file-1', 'directory-team-b')
    expect(dialog()).toBeNull()
  })

  test("moving from a team's folder to the user's folder asks", async () => {
    const transfer = await setup()
    const done = transfer(TEAM_A, { type: 'cloud' }, [asset('file-1')])
    await answer('Copy instead', 'Moving assets from Team A is unavailable', YOU_CAN_COPY)
    await done
    expect(remote.copyAsset).toHaveBeenCalledWith('file-1', ROOT)
  })

  describe('from a team to the local drive (#14797)', () => {
    test('asks to copy instead, then downloads the assets, with a toast', async () => {
      remote.download.mockResolvedValue(undefined)
      const transfer = await setup()
      const done = transfer(TEAM_A, { type: 'local' }, [asset('project-1')])
      await answer('Copy instead', 'Moving assets from Team A is unavailable', YOU_CAN_COPY)
      await done
      expect(remote.download).toHaveBeenCalledWith('project-1', 'project-1', LOCAL_ROOT, undefined)
      await vi.waitFor(() =>
        expect(useToasts().toasts.value.map((toast) => toast.content)).toContain(
          'Successfully exported cloud project to your computer!',
        ),
      )
    })

    test('does nothing when the question is cancelled', async () => {
      const transfer = await setup()
      const done = transfer(TEAM_A, { type: 'local' }, [asset('project-1')])
      await answer('Cancel', 'Moving assets from Team A is unavailable', YOU_CAN_COPY)
      await done
      expect(remote.download).not.toHaveBeenCalled()
      expect(remote.copyAsset).not.toHaveBeenCalled()
    })

    test('does not ask when copying', async () => {
      remote.download.mockResolvedValue(undefined)
      const transfer = await setup()
      await transfer(TEAM_A, { type: 'local' }, [asset('project-1')], null, 'copy')
      expect(remote.download).toHaveBeenCalledOnce()
      expect(dialog()).toBeNull()
    })
  })

  test("downloads assets dropped from the user's folder on the local drive, without asking", async () => {
    remote.download.mockResolvedValue(undefined)
    const transfer = await setup()
    await transfer({ type: 'cloud' }, { type: 'local' }, [asset('project-1')])
    expect(remote.download).toHaveBeenCalledWith('project-1', 'project-1', LOCAL_ROOT, undefined)
    expect(dialog()).toBeNull()
  })

  test("restores from the trash; a team's assets restored elsewhere are copied, on confirmation", async () => {
    remote.undoDeleteAsset.mockResolvedValue(undefined)
    const transfer = await setup()
    const done = transfer({ type: 'trash' }, { type: 'cloud' }, [
      asset('file-mine', 'directory-root'),
      asset('file-team', 'directory-team-a'),
    ])
    await answer(
      'Copy instead',
      'You are trying to restore assets from Team A to Cloud. This is not allowed.',
      'You can copy these assets to Cloud while keeping the originals intact.',
    )
    await done
    expect(remote.undoDeleteAsset).toHaveBeenCalledWith('file-mine', ROOT)
    expect(remote.copyAsset).toHaveBeenCalledWith('file-team', ROOT)
  })

  test('moves assets within the local drive on the local backend', async () => {
    const transfer = await setup()
    await transfer(
      { type: 'local' },
      { type: 'local' },
      [asset('file-1')],
      DirectoryId('directory-y'),
    )
    await vi.waitFor(() => expect(local.updateAsset).toHaveBeenCalledOnce())
    expect(remote.updateAsset).not.toHaveBeenCalled()
  })

  test('does nothing for the Recent category, or within the trash', async () => {
    const transfer = await setup()
    await transfer({ type: 'cloud' }, { type: 'recent' }, [asset('file-1')])
    await transfer({ type: 'trash' }, { type: 'trash' }, [asset('file-1')])
    await flushPromises()
    for (const mock of Object.values(remote)) expect(mock).not.toHaveBeenCalled()
  })
})
