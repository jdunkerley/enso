/**
 * @file The right panel's Versions tab (#89): what it shows for each selection, and its actions,
 * driven by the keyboard wherever the tab offers keyboard access.
 */
import type { Category } from '$/providers/category'
import { useModals } from '$/providers/modals'
import { createQueryClient, type QueryClient } from '$/utils/queryClient'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  DirectoryId,
  EmailAddress,
  Path,
  ProjectId,
  S3ObjectVersionId,
  type AnyAsset,
  type AssetVersions as AssetVersionsResponse,
  type S3ObjectVersion,
} from 'enso-common/src/services/Backend'
import { newDirectoryId, newProjectId } from 'enso-common/src/services/LocalBackend'
import { ResultError } from 'enso-common/src/utilities/data/result'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, ref } from 'vue'
import AssetVersions from '../AssetVersions.vue'
import VersionDialog from '../VersionDialog.vue'

// `useBackends` and `useContainerData` are global stores (see `mountWithProviders`), so they are
// replaced by module mocks; the right panel's store is a context store, given to the mount.
const backend = vi.hoisted(() => ({
  type: 'remote',
  listAssetVersions: vi.fn(),
  listAssetVersionTags: vi.fn(),
  restoreAsset: vi.fn(),
  copyAsset: vi.fn(),
  updateAsset: vi.fn(),
  getMainFileContent: vi.fn(),
  getAssetDetails: vi.fn(),
}))
const localBackend = vi.hoisted(() => ({
  type: 'local',
  versioningStatus: vi.fn(),
  listAssetVersions: vi.fn(),
  listAssetVersionTags: vi.fn(),
  restoreAsset: vi.fn(),
  copyAsset: vi.fn(),
  updateAsset: vi.fn(),
  getMainFileContent: vi.fn(),
  getAssetDetails: vi.fn(),
}))
const backends = vi.hoisted(() => ({ localAvailable: true }))
vi.mock('$/providers/backends', () => ({
  useBackends: () => ({
    remoteBackend: backend,
    localBackend: backends.localAvailable ? localBackend : null,
  }),
}))
const openedProjects = vi.hoisted(() => ({
  get: vi.fn(),
  closeProject: vi.fn(),
  waitForProcess: vi.fn(async () => {}),
}))
vi.mock('$/providers/openedProjects', () => ({ useOpenedProjects: () => openedProjects }))
const openProjectLocally = vi.fn()
vi.mock('$/providers/container', () => ({ useContainerData: () => ({ openProjectLocally }) }))

const PROJECT_ID = ProjectId('project-1')
const PARENT_ID = DirectoryId('directory-parent')
const project = {
  type: AssetType.project,
  id: PROJECT_ID,
  title: 'My Project',
  parentId: PARENT_ID,
} as unknown as AnyAsset

const LOCAL_PROJECT = {
  type: AssetType.project,
  id: newProjectId(Path('/root/P')),
  title: 'P',
  parentId: newDirectoryId(Path('/root')),
} as unknown as AnyAsset

function localStatus(extra: object = {}) {
  return {
    git: true,
    repoRoot: '/root',
    enabled: true,
    optedOut: false,
    changed: false,
    blocked: null,
    lastVersion: null,
    ...extra,
  }
}

const category = ref<Category>()
const asset = ref<AnyAsset>()
const openedProject = ref<{ id: ProjectId; title: string; mode: 'local' | 'cloud' | 'hybrid' }>()
const rightPanel = reactive({
  context: {
    get category() {
      return category.value
    },
    get openedProject() {
      return openedProject.value
    },
  },
  focusedAsset: asset,
})

function version(n: number, extra: Partial<S3ObjectVersion> = {}): S3ObjectVersion {
  return {
    versionId: S3ObjectVersionId(`version-${n}`),
    lastModified: `2026-10-0${n}T10:00:00Z` as S3ObjectVersion['lastModified'],
    isLatest: false,
    key: `key-${n}`,
    ...extra,
  }
}

/** Newest first, as the backend lists them. */
let versions: S3ObjectVersion[]

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  backends.localAvailable = true
  category.value = { type: 'cloud' }
  asset.value = project
  openedProject.value = undefined
  versions = [
    version(3, {
      isLatest: true,
      tags: ['release'],
      user: { name: 'Ada', email: EmailAddress('ada@example.com') },
    }),
    version(2, { comment: 'Fixed the join' }),
    version(1),
  ]
  backend.listAssetVersions.mockImplementation(() =>
    Promise.resolve({ versions } satisfies AssetVersionsResponse),
  )
  backend.listAssetVersionTags.mockResolvedValue(['release', 'nightly', 'Night build'])
  backend.restoreAsset.mockResolvedValue(undefined)
  backend.copyAsset.mockResolvedValue({ asset: { ...project, id: ProjectId('project-copy') } })
  backend.updateAsset.mockResolvedValue(undefined)
  backend.getMainFileContent.mockImplementation((_id: unknown, versionId: unknown) =>
    Promise.resolve(`main = "${String(versionId)}"`),
  )
  openProjectLocally.mockReset()
  openedProjects.get.mockReset().mockReturnValue(undefined)
  // jsdom lays nothing out: give the version's header room for its tags, so that they show
  // one by one instead of collapsing into "N tags".
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains('gap-2') && this.classList.contains('min-w-0') ? 1000 : 40
    return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0 } as DOMRect
  })
})
// What jsdom lacks: floating-ui watches its anchors with an `IntersectionObserver`, and CodeMirror
// measures text through ranges.
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
const emptyRects = Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= () => emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
afterEach(() => {
  vi.unstubAllGlobals()
  portalRoot.remove()
  vi.restoreAllMocks()
  useModals().closeAll()
})

async function renderTab(queryClient?: QueryClient) {
  const mounted = await mountWithProviders(AssetVersions, {
    stores: { rightPanel },
    ...(queryClient != null ? { queryClient } : {}),
  })
  await flushPromises()
  return mounted
}

const text = () => document.body.textContent ?? ''

/** The buttons showing the given `icons.svg` icon. */
function buttonsWithIcon(icon: string) {
  return [...document.querySelectorAll<HTMLElement>('button')].filter(
    (button) => button.querySelector(`use[data-icon="${icon}"]`) != null,
  )
}

/** Open a version's actions menu from the keyboard. */
async function openMenu(index: number) {
  const user = userEvent.setup()
  const triggers = document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')
  triggers[index]!.focus()
  await user.keyboard('{Enter}')
  await flushPromises()
  return user
}

/** Move to the item with the given text in the innermost open menu, and choose it. */
async function choose(user: ReturnType<typeof userEvent.setup>, label: string) {
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1)!
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  const index = items.findIndex((item) => item.textContent?.includes(label))
  expect(index, `menu item "${label}"`).toBeGreaterThanOrEqual(0)
  for (let i = 0; i < index; i++) await user.keyboard('{ArrowDown}')
  expect(document.activeElement?.textContent).toContain(label)
  await user.keyboard('{Enter}')
  await flushPromises()
}

describe('placeholders', () => {
  test('with nothing selected, it asks for an asset', async () => {
    asset.value = undefined
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Select a single asset to view its versions.')
  })

  test('a folder has no versions', async () => {
    asset.value = { ...project, type: AssetType.directory } as unknown as AnyAsset
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain(
      'Versions are available for projects, files and datalinks only.',
    )
    expect(backend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('an asset without versions says so', async () => {
    versions = []
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('No versions found')
  })
})

describe('in a local category', () => {
  /** Newest first. */
  let localVersions: S3ObjectVersion[]

  beforeEach(() => {
    category.value = { type: 'local' }
    asset.value = LOCAL_PROJECT
    localVersions = [version(2, { isLatest: true, comment: 'Saved' }), version(1)]
    localBackend.versioningStatus.mockReset().mockResolvedValue(localStatus())
    localBackend.listAssetVersions
      .mockReset()
      .mockImplementation(() => Promise.resolve({ versions: localVersions }))
    localBackend.listAssetVersionTags.mockReset().mockResolvedValue([])
    localBackend.restoreAsset.mockReset().mockResolvedValue(undefined)
    localBackend.copyAsset.mockReset()
    localBackend.updateAsset.mockReset().mockResolvedValue(undefined)
    localBackend.getMainFileContent.mockReset().mockResolvedValue('main = 1')
    openedProjects.closeProject.mockReset()
    openedProjects.waitForProcess.mockReset().mockResolvedValue(undefined)
  })

  test('lists a project’s versions from the local backend', async () => {
    const { wrapper } = await renderTab()
    expect(localBackend.versioningStatus).toHaveBeenCalledWith('/root/P')
    expect(localBackend.listAssetVersions).toHaveBeenCalledWith(LOCAL_PROJECT.id)
    expect(backend.listAssetVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toMatch(/Version 2.*Version 1/)
    expect(wrapper.text()).toContain('Saved')
  })

  test('without a local backend, says the drive is not available', async () => {
    backends.localAvailable = false
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('The local drive is not available.')
  })

  test('a status that cannot be read shows the error, not the loader', async () => {
    localBackend.versioningStatus.mockRejectedValue(new Error('git exploded'))
    const { wrapper } = await renderTab()
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Versions could not be read: git exploded'),
    )
    expect(localBackend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('a folder: only projects have versions', async () => {
    asset.value = { ...LOCAL_PROJECT, type: AssetType.directory } as unknown as AnyAsset
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('In the local drive, only projects have versions.')
    expect(localBackend.versioningStatus).not.toHaveBeenCalled()
  })

  test.each([
    [
      { git: false, repoRoot: null, enabled: false },
      'Install git to keep versions of local projects.',
    ],
    [
      { repoRoot: null, enabled: false },
      'This project is not in a git repository, so it has no versions.',
    ],
    [{ enabled: false }, "Versions are not kept in this project's git repository."],
    [{ enabled: false, optedOut: true }, "Versions are not kept in this project's git repository."],
  ])('status %j says why there is no list', async (extra, message) => {
    localBackend.versioningStatus.mockResolvedValue(localStatus(extra))
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain(message)
    expect(localBackend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('no tags: no "Add tag" button, no suggestions; "Latest" still shows', async () => {
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Latest')
    // In the cloud, each version has an "add" button for a tag (see the tags tests).
    expect(buttonsWithIcon('add')).toHaveLength(0)
    expect(localBackend.listAssetVersionTags).not.toHaveBeenCalled()
  })

  test('a comment is added from the comment button, and saved with Enter', async () => {
    await renderTab()
    const user = userEvent.setup()
    const addComment = document.querySelector<HTMLElement>('button[aria-label="Add comment"]')!
    await user.click(addComment)
    const textArea = document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(document.activeElement).toBe(textArea)
    await user.keyboard('The first draft{Enter}')
    await flushPromises()
    expect(localBackend.updateAsset).toHaveBeenCalledWith(
      LOCAL_PROJECT.id,
      { versionId: localVersions[1]!.versionId, comment: 'The first draft' },
      'P',
    )
    expect(text()).toContain('The first draft')
  })

  test('restoring an open project closes it, restores, and opens it again', async () => {
    const order: string[] = []
    const opened = { state: { status: 'initialized' }, nextTask: undefined, error: undefined }
    openedProjects.get.mockReturnValue(opened)
    openedProjects.closeProject.mockImplementation(() => order.push('close'))
    openedProjects.waitForProcess.mockImplementation(async () => {
      order.push('closed')
    })
    localBackend.restoreAsset.mockImplementation(async () => {
      order.push('restore')
    })
    openProjectLocally.mockImplementation(() => order.push('open'))
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() => expect(order).toEqual(['close', 'closed', 'restore', 'open']))
    expect(openedProjects.closeProject).toHaveBeenCalledWith(LOCAL_PROJECT.id, undefined, { offer: false })
    expect(localBackend.restoreAsset).toHaveBeenCalledWith(
      LOCAL_PROJECT.id,
      localVersions[1]!.versionId,
    )
    // In the background: the drive, where Restore was chosen, stays in front.
    expect(openProjectLocally).toHaveBeenCalledWith(LOCAL_PROJECT, 'local', false)
  })

  test('if the close fails, nothing is restored and the error is shown', async () => {
    const opened = {
      state: { status: 'initialized' },
      nextTask: undefined,
      error: undefined as Error | undefined,
    }
    openedProjects.get.mockReturnValue(opened)
    openedProjects.waitForProcess.mockImplementation(async () => {
      opened.error = new Error('engine did not stop')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('engine did not stop')),
    )
    expect(localBackend.restoreAsset).not.toHaveBeenCalled()
    expect(openProjectLocally).not.toHaveBeenCalled()
  })

  test('a close that fails with a `ResultError` shows its message', async () => {
    const opened = {
      state: { status: 'initialized' },
      nextTask: undefined,
      error: undefined as ResultError | undefined,
    }
    openedProjects.get.mockReturnValue(opened)
    openedProjects.waitForProcess.mockImplementation(async () => {
      opened.error = new ResultError('no local backend')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/: no local backend$/)),
    )
    expect(localBackend.restoreAsset).not.toHaveBeenCalled()
  })

  test('if the restore fails after the close, the project is opened again', async () => {
    openedProjects.get.mockReturnValue({
      state: { status: 'initialized' },
      nextTask: undefined,
      error: undefined,
    })
    localBackend.restoreAsset.mockRejectedValue(new Error('the project is running'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('the project is running')),
    )
    expect(openProjectLocally).toHaveBeenCalledWith(LOCAL_PROJECT, 'local', false)
  })

  test('a project that is still opening is closed and opened again', async () => {
    const order: string[] = []
    openedProjects.get.mockReturnValue({
      state: { status: 'not-opened' },
      nextTask: { process: 'opening' },
      error: undefined,
    })
    openedProjects.closeProject.mockImplementation(() => order.push('close'))
    localBackend.restoreAsset.mockImplementation(async () => {
      order.push('restore')
    })
    openProjectLocally.mockImplementation(() => order.push('open'))
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() => expect(order).toEqual(['close', 'restore', 'open']))
  })

  test('a closed project is restored without opening it', async () => {
    openedProjects.get.mockReturnValue({
      state: { status: 'not-opened' },
      nextTask: undefined,
      error: undefined,
    })
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() => expect(localBackend.restoreAsset).toHaveBeenCalled())
    expect(openedProjects.closeProject).not.toHaveBeenCalled()
    expect(openProjectLocally).not.toHaveBeenCalled()
  })

  test('a project never opened in this app is restored without opening it', async () => {
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() => expect(localBackend.restoreAsset).toHaveBeenCalled())
    expect(openedProjects.closeProject).not.toHaveBeenCalled()
    expect(openProjectLocally).not.toHaveBeenCalled()
  })

  test('restoring refreshes the project’s versioning status', async () => {
    // The app's query client, which applies a mutation's invalidations.
    await renderTab(await createQueryClient())
    expect(localBackend.versioningStatus).toHaveBeenCalledTimes(1)
    const user = await openMenu(1)
    await choose(user, 'Restore')
    await vi.waitFor(() => expect(localBackend.versioningStatus).toHaveBeenCalledTimes(2))
  })

  test('"Duplicate and open" opens the local copy with the local backend', async () => {
    const copyId = newProjectId(Path('/root/P_1'))
    localBackend.copyAsset.mockResolvedValue({ asset: { ...LOCAL_PROJECT, id: copyId } })
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Duplicate and open')
    expect(localBackend.copyAsset).toHaveBeenCalledWith(
      LOCAL_PROJECT.id,
      newDirectoryId(Path('/root')),
      localVersions[1]!.versionId,
    )
    expect(openProjectLocally).toHaveBeenCalledWith(
      expect.objectContaining({ id: copyId }),
      'local',
    )
  })
})

describe('in a project tab', () => {
  // The project view's context: no category, the project's id as the item, and the opened project.
  beforeEach(() => {
    category.value = undefined
    asset.value = undefined
    localBackend.versioningStatus.mockReset().mockResolvedValue(localStatus())
    localBackend.getAssetDetails.mockReset().mockResolvedValue(LOCAL_PROJECT)
    localBackend.listAssetVersions.mockReset().mockResolvedValue({
      versions: [version(2, { isLatest: true, comment: 'Saved' }), version(1)],
    })
    localBackend.listAssetVersionTags.mockReset().mockResolvedValue([])
    localBackend.restoreAsset.mockReset().mockResolvedValue(undefined)
    backend.getAssetDetails.mockReset().mockResolvedValue(project)
    openedProjects.closeProject.mockReset()
    openedProjects.waitForProcess.mockReset().mockResolvedValue(undefined)
  })

  test('a local project: lists its versions from the local backend', async () => {
    openedProject.value = { id: LOCAL_PROJECT.id as ProjectId, title: 'P', mode: 'local' }
    const { wrapper } = await renderTab()
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/Version 2.*Version 1/))
    expect(localBackend.getAssetDetails).toHaveBeenCalledWith(LOCAL_PROJECT.id, undefined)
    expect(localBackend.versioningStatus).toHaveBeenCalledWith('/root/P')
    expect(localBackend.listAssetVersions).toHaveBeenCalledWith(LOCAL_PROJECT.id)
    expect(backend.listAssetVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Select a single asset')
  })

  test('a local project whose versions are not kept says so', async () => {
    openedProject.value = { id: LOCAL_PROJECT.id as ProjectId, title: 'P', mode: 'local' }
    localBackend.versioningStatus.mockResolvedValue(localStatus({ enabled: false }))
    const { wrapper } = await renderTab()
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain("Versions are not kept in this project's git repository."),
    )
    expect(localBackend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('a local project without a local backend says the drive is not available', async () => {
    backends.localAvailable = false
    openedProject.value = { id: LOCAL_PROJECT.id as ProjectId, title: 'P', mode: 'local' }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('The local drive is not available.')
  })

  test('a cloud project: lists its versions from the cloud', async () => {
    openedProject.value = { id: PROJECT_ID, title: 'My Project', mode: 'cloud' }
    const { wrapper } = await renderTab()
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/Version 3.*Version 2.*Version 1/))
    expect(backend.getAssetDetails).toHaveBeenCalledWith(PROJECT_ID, undefined)
    expect(backend.listAssetVersions).toHaveBeenCalledWith(PROJECT_ID)
    expect(localBackend.getAssetDetails).not.toHaveBeenCalled()
    expect(localBackend.versioningStatus).not.toHaveBeenCalled()
  })

  test('a hybrid project: lists the cloud project’s versions', async () => {
    openedProject.value = { id: PROJECT_ID, title: 'My Project', mode: 'hybrid' }
    const { wrapper } = await renderTab()
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/Version 3/))
    expect(backend.listAssetVersions).toHaveBeenCalledWith(PROJECT_ID)
    expect(localBackend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('a project whose details cannot be read shows the error', async () => {
    openedProject.value = { id: PROJECT_ID, title: 'My Project', mode: 'cloud' }
    backend.getAssetDetails.mockRejectedValue(new Error('no such project'))
    const { wrapper } = await renderTab()
    await vi.waitFor(() => expect(wrapper.text()).toContain('no such project'), { timeout: 5000 })
    expect(backend.listAssetVersions).not.toHaveBeenCalled()
  })

  test('restoring finishes, and the project opens again, even if the list unmounts', async () => {
    openedProject.value = { id: LOCAL_PROJECT.id as ProjectId, title: 'P', mode: 'local' }
    const opened = { state: { status: 'initialized' }, nextTask: undefined, error: undefined }
    openedProjects.get.mockReturnValue(opened)
    let closed!: () => void
    openedProjects.waitForProcess.mockImplementation(
      () => new Promise<void>((resolve) => (closed = resolve)),
    )
    const { wrapper, unmount } = await renderTab()
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/Version 2/))
    const user = await openMenu(1)
    await choose(user, 'Restore')
    expect(openedProjects.closeProject).toHaveBeenCalledWith(LOCAL_PROJECT.id)
    // The project's tab closes its graph, and with it the panel, while the project closes.
    unmount()
    closed()
    await vi.waitFor(() =>
      expect(openProjectLocally).toHaveBeenCalledWith(LOCAL_PROJECT, 'local', false),
    )
    expect(localBackend.restoreAsset).toHaveBeenCalledWith(
      LOCAL_PROJECT.id,
      S3ObjectVersionId('version-1'),
    )
  })
})

describe('the list', () => {
  test('shows each version, newest first, with its tags, comment and author', async () => {
    const { wrapper } = await renderTab()
    expect(backend.listAssetVersions).toHaveBeenCalledWith(PROJECT_ID)
    expect(wrapper.text()).toMatch(/Version 3.*Version 2.*Version 1/)
    expect(wrapper.text()).toContain('Latest')
    expect(wrapper.text()).toContain('release')
    expect(wrapper.text()).toContain('Fixed the join')
    expect(wrapper.text()).toContain('Ada')
  })

  test('a version of another asset has no "See changes"', async () => {
    asset.value = { ...project, type: AssetType.file } as unknown as AnyAsset
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Version 3')
    expect(wrapper.text()).not.toContain('See changes')
    expect(wrapper.text()).toContain('Actions')
  })
})

describe('actions', () => {
  test('the latest version cannot be restored', async () => {
    await renderTab()
    await openMenu(0)
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    )
    expect(items).toEqual(['Duplicate', 'Duplicate and open', 'Compare with...'])
  })

  test('an older version is restored from its menu', async () => {
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Restore')
    expect(backend.restoreAsset).toHaveBeenCalledWith(PROJECT_ID, versions[1]!.versionId)
  })

  test('"Duplicate and open" duplicates the version and opens the copy', async () => {
    await renderTab()
    const user = await openMenu(1)
    await choose(user, 'Duplicate and open')
    expect(backend.copyAsset).toHaveBeenCalledWith(PROJECT_ID, PARENT_ID, versions[1]!.versionId)
    expect(openProjectLocally).toHaveBeenCalledWith(
      expect.objectContaining({ id: ProjectId('project-copy') }),
      'remote',
    )
  })

  test('"Compare with" opens the comparison on the modal stack', async () => {
    await renderTab()
    const user = await openMenu(0)
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const submenu = items.findIndex((item) => item.textContent?.includes('Compare with'))
    for (let i = 0; i < submenu; i++) await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowRight}')
    await flushPromises()
    await choose(user, 'Version 1')
    const [entry] = useModals().stack.value
    expect(entry?.component).toBe(VersionDialog)
    expect(entry?.props).toMatchObject({ open: true, compareVersion: { title: 'Version 1' } })
  })
})

describe('"See changes"', () => {
  test('opens a full-screen diff of Main.enso against the previous version', async () => {
    await renderTab()
    const user = userEvent.setup()
    const seeChanges = [...document.querySelectorAll<HTMLElement>('button')].find((button) =>
      button.textContent?.includes('See changes'),
    )!
    await user.click(seeChanges)
    await vi.waitFor(() => expect(document.querySelector('.cm-mergeView')).not.toBeNull())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Compare Version 3 with Version 2')
    expect(dialog.querySelector('.cm-merge-a')?.textContent).toContain('version-2')
    expect(dialog.querySelector('.cm-merge-b')?.textContent).toContain('version-3')
    expect(backend.getMainFileContent).toHaveBeenCalledWith(PROJECT_ID, versions[0]!.versionId)
    expect(backend.getMainFileContent).toHaveBeenCalledWith(PROJECT_ID, versions[1]!.versionId)
    // The latest version cannot be restored; it can be duplicated.
    const actions = [...dialog.querySelectorAll('button')].map((button) =>
      button.textContent?.trim(),
    )
    expect(actions).not.toContain('Restore')
    expect(actions).toContain('Duplicate')
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(seeChanges)
  })
})

describe('comments', () => {
  test('a comment is added from the comment button, and saved with Enter', async () => {
    await renderTab()
    const user = userEvent.setup()
    const addComment = document.querySelector<HTMLElement>('button[aria-label="Add comment"]')!
    await user.click(addComment)
    const textArea = document.querySelector<HTMLTextAreaElement>('textarea')!
    expect(document.activeElement).toBe(textArea)
    await user.keyboard('First release{Enter}')
    await flushPromises()
    expect(backend.updateAsset).toHaveBeenCalledWith(
      PROJECT_ID,
      { versionId: versions[0]!.versionId, comment: 'First release' },
      'My Project',
    )
    expect(text()).toContain('First release')
  })

  test('Escape cancels an edit', async () => {
    await renderTab()
    const user = userEvent.setup()
    await user.click(document.querySelector<HTMLElement>('button[aria-label="Edit comment"]')!)
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Fixed the join')
    await user.keyboard('{Control>}a{/Control}Changed{Escape}')
    await flushPromises()
    expect(document.querySelector('textarea')).toBeNull()
    expect(backend.updateAsset).not.toHaveBeenCalled()
    expect(text()).toContain('Fixed the join')
  })
})

describe('tags', () => {
  test('a tag is added from the popover, which suggests the other tags', async () => {
    await renderTab()
    const user = userEvent.setup()
    const addTag = buttonsWithIcon('add')[1]!
    await user.click(addTag)
    await flushPromises()
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Add tag"]')!
    // Focused after a short delay, once the popover's own focus handling has settled.
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    expect(backend.listAssetVersionTags).toHaveBeenCalledTimes(2)
    // The filter is case-insensitive.
    await user.keyboard('NIGHT')
    const suggestions = [...document.querySelectorAll<HTMLElement>('form button')].map((button) =>
      button.textContent?.trim(),
    )
    expect(suggestions).toEqual(['nightly', 'Night build'])
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(backend.updateAsset).toHaveBeenCalledWith(
      PROJECT_ID,
      { versionId: versions[1]!.versionId, tag: 'NIGHT', remove: false },
      PROJECT_ID,
    )
  })

  test('tags that do not fit beside the title collapse into one', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40, 20),
    )
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('2 tags')
    expect(buttonsWithIcon('close')).toHaveLength(0)
  })

  test('a tag is removed with its close button; "Latest" has none', async () => {
    await renderTab()
    const user = userEvent.setup()
    const removeButtons = buttonsWithIcon('close')
    expect(removeButtons).toHaveLength(1)
    await user.click(removeButtons[0]!)
    await flushPromises()
    expect(backend.updateAsset).toHaveBeenCalledWith(
      PROJECT_ID,
      { versionId: versions[0]!.versionId, tag: 'release', remove: true },
      PROJECT_ID,
    )
  })
})
