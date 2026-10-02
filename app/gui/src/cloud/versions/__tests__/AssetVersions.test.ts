/**
 * @file The right panel's Versions tab (#89): what it shows for each selection, and its actions,
 * driven by the keyboard where react-aria gave the React tab keyboard access.
 */
import type { Category } from '$/providers/category'
import { useModals } from '$/providers/modals'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  DirectoryId,
  EmailAddress,
  ProjectId,
  S3ObjectVersionId,
  type AnyAsset,
  type AssetVersions as AssetVersionsResponse,
  type S3ObjectVersion,
} from 'enso-common/src/services/Backend'
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
}))
vi.mock('$/providers/backends', () => ({ useBackends: () => ({ remoteBackend: backend }) }))
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

const category = ref<Category>({ type: 'cloud' })
const asset = ref<AnyAsset>()
const rightPanel = reactive({
  context: {
    get category() {
      return category.value
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
  category.value = { type: 'cloud' }
  asset.value = project
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

async function renderTab() {
  const mounted = await mountWithProviders(AssetVersions, { stores: { rightPanel } })
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

describe('placeholders', () => {
  test('outside the cloud, local assets have no versions', async () => {
    category.value = { type: 'local' }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Local assets do not have versions.')
    expect(backend.listAssetVersions).not.toHaveBeenCalled()
  })

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
    expect(document.activeElement).toBe(input)
    expect(backend.listAssetVersionTags).toHaveBeenCalledTimes(2)
    // Case-insensitive, as react-aria's filter was.
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
