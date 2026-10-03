/**
 * @file The duplicate-name dialog (#92): what it shows for each conflict, the skip, replace and
 * rename choices, Skip All, Apply and Cancel, from the keyboard where react-aria gave the React
 * dialog keyboard access.
 */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import {
  AssetType,
  BackendType,
  DirectoryId,
  FileId,
  type AnyAsset,
  type Backend,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import DuplicateAssetsModal from '../DuplicateAssetsModal.vue'

const TARGET_ID = DirectoryId('directory-target')

function file(id: string, title: string, modifiedAt = '2026-10-01T10:00:00Z'): AnyAsset {
  return {
    type: AssetType.file,
    id: FileId(id),
    title,
    modifiedAt,
    createdAt: modifiedAt,
    parentId: TARGET_ID,
    permissions: null,
    projectState: null,
    extension: 'csv',
    parentsPath: '',
    virtualParentsPath: '',
    ensoPath: '',
  } as unknown as AnyAsset
}

/** The assets being added: in the query cache, where the drive put them. */
const NEW_DATA = file('file-new-data', 'data.csv', '2026-10-03T10:00:00Z')
const NEW_NOTES = file('file-new-notes', 'notes.csv', '2026-10-03T10:00:00Z')
/** The assets already in the directory. */
const EXISTING_DATA = file('file-data', 'data.csv')
const EXISTING_NOTES = file('file-notes', 'notes.csv')

let siblings: AnyAsset[]
const listDirectory = vi.fn<Backend['listDirectory']>()
const backend = { type: BackendType.remote, listDirectory } as unknown as Backend

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  siblings = [EXISTING_DATA, EXISTING_NOTES]
  listDirectory.mockReset()
  listDirectory.mockImplementation(async (query) => ({
    assets: query.filterBy === 'Trashed' ? [] : siblings,
    paginationToken: null,
  }))
})
afterEach(() => {
  portalRoot.remove()
})

function dialog() {
  const element = document.querySelector<HTMLElement>('[role="dialog"]')
  if (element == null) throw new Error('No dialog')
  return element
}

function button(name: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent?.trim() === name,
  )
  if (found == null) throw new Error(`No "${name}" button`)
  return found
}

// The new assets are found in the query cache, where the drive put them: each case seeds a client
// of its own before the dialog mounts.
describe('the duplicate-name dialog', () => {
  async function mountSeeded(
    conflicting: readonly AnyAsset[],
    extra: { canReplace?: boolean } = {},
  ) {
    const { createTestQueryClient } = await import('$/utils/testing/mountWithProviders')
    const queryClient = createTestQueryClient()
    // An infinite listing, as the drive table's.
    queryClient.setQueryData(['remote', 'listDirectory', 'source'], {
      pages: [{ assets: [NEW_DATA, NEW_NOTES] }],
    })
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const onClose = vi.fn()
    await mountWithProviders(DuplicateAssetsModal, {
      queryClient,
      props: {
        targetId: TARGET_ID,
        conflictingIds: conflicting.map((asset) => asset.id),
        category: { type: 'cloud' },
        backend,
        onSubmit,
        onCancel,
        onClose,
        ...extra,
      },
    })
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] form')).not.toBeNull())
    return { onSubmit, onCancel, onClose, queryClient }
  }

  test('one conflict: the title, the prompt, and the new and existing assets', async () => {
    await mountSeeded([NEW_DATA])
    expect(dialog().querySelector('h2')?.textContent).toBe('1 conflicting file found')
    expect(dialog().textContent).toContain(
      'A file with the same name already exists in this folder. How would you like to proceed?',
    )
    expect(dialog().textContent).toContain('New')
    expect(dialog().textContent).toContain('Existing')
    expect(dialog().textContent).toContain('last modified on 2026-10-03')
    expect(dialog().textContent).toContain('last modified on 2026-10-01')
    expect(listDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: TARGET_ID, filterBy: 'Trashed' }),
      TARGET_ID,
    )
  })

  test('several conflicts are counted in the title', async () => {
    await mountSeeded([NEW_DATA, NEW_NOTES])
    expect(dialog().querySelector('h2')?.textContent).toBe('2 conflicting files found')
    expect(dialog().textContent).toContain('2 files with the same name already exist')
  })

  test('Replace is offered only when replacing is possible', async () => {
    await mountSeeded([NEW_DATA])
    expect(() => button('Replace', dialog())).toThrow()
  })

  test('Apply without a choice renames to the suggested name', async () => {
    const { onSubmit } = await mountSeeded([NEW_DATA])
    await userEvent.click(button('Apply', dialog()))
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith([
      { assetId: NEW_DATA.id, conclusion: 'rename', newName: 'data.csv (2)' },
    ])
  })

  test('Skip, then Apply, skips it', async () => {
    const { onSubmit, onCancel } = await mountSeeded([NEW_DATA])
    await userEvent.click(button('Skip', dialog()))
    expect(dialog().textContent).toContain('The new file will be skipped')
    expect(dialog().textContent).toContain('Change')
    await userEvent.click(button('Apply', dialog()))
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([{ assetId: NEW_DATA.id, conclusion: 'skip' }]),
    )
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('Replace, then Apply, replaces it', async () => {
    const { onSubmit } = await mountSeeded([NEW_DATA], { canReplace: true })
    await userEvent.click(button('Replace', dialog()))
    expect(dialog().textContent).toContain('The existing file will be replaced with the new file')
    await userEvent.click(button('Apply', dialog()))
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([{ assetId: NEW_DATA.id, conclusion: 'replace' }]),
    )
  })

  test('Rename opens a form with the suggested name selected, and applies a new one', async () => {
    const { onSubmit } = await mountSeeded([NEW_DATA])
    await userEvent.click(button('Rename', dialog()))
    const input = await vi.waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('input[name="newName"]')
      expect(element).not.toBeNull()
      return element!
    })
    expect(input.value).toBe('data.csv (2)')
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'data.csv (2)'.length])
    await userEvent.keyboard('renamed.csv{Enter}')
    await vi.waitFor(() =>
      expect(dialog().textContent).toContain('The new file will be renamed to: renamed.csv'),
    )
    await userEvent.click(button('Apply', dialog()))
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([
        { assetId: NEW_DATA.id, conclusion: 'rename', newName: 'renamed.csv' },
      ]),
    )
  })

  test('the new name must be unique among the siblings', async () => {
    await mountSeeded([NEW_DATA])
    await userEvent.click(button('Rename', dialog()))
    const input = await vi.waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('input[name="newName"]')
      expect(element).not.toBeNull()
      return element!
    })
    // The input is focused (and its text selected) after a short delay, as in React.
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    await userEvent.keyboard('notes.csv{Enter}')
    await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
    expect(dialog().textContent).not.toContain('will be renamed')
  })

  test('Skip All skips every asset', async () => {
    const { onSubmit } = await mountSeeded([NEW_DATA, NEW_NOTES])
    await userEvent.click(button('Skip All', dialog()))
    await userEvent.click(button('Apply', dialog()))
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([
        { assetId: NEW_DATA.id, conclusion: 'skip' },
        { assetId: NEW_NOTES.id, conclusion: 'skip' },
      ]),
    )
  })

  test('Cancel, or Escape, cancels', async () => {
    const { onCancel, onSubmit } = await mountSeeded([NEW_DATA])
    await userEvent.click(button('Cancel', dialog()))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('Escape cancels', async () => {
    const { onCancel } = await mountSeeded([NEW_DATA])
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('no actual conflict: it answers at once with nothing, without asking', async () => {
    siblings = [EXISTING_NOTES]
    const { createTestQueryClient } = await import('$/utils/testing/mountWithProviders')
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['remote', 'listDirectory', 'source'], {
      pages: [{ assets: [NEW_DATA] }],
    })
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    await mountWithProviders(DuplicateAssetsModal, {
      queryClient,
      props: {
        targetId: TARGET_ID,
        conflictingIds: [NEW_DATA.id],
        category: { type: 'cloud' },
        backend,
        onSubmit,
        onCancel,
      },
    })
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]))
    expect(onCancel).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"] form')).toBeNull()
  })
})
