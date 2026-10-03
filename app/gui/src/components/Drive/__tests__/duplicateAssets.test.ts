/** @file The suggested new name of a duplicate, and `resolveDuplications` on the modal stack (#92). */
import { useModals } from '$/providers/modals'
import { AssetId, DirectoryId } from 'enso-common/src/services/Backend'
import { afterEach, describe, expect, test } from 'vitest'
import DuplicateAssetsModal from '../DuplicateAssetsModal.vue'
import { getUniqueName, resolveDuplications, type ResolvedDuplication } from '../duplicateAssets'

describe('getUniqueName', () => {
  test.each([
    { title: 'data.csv', siblings: [], expected: 'data.csv' },
    { title: 'data.csv', siblings: ['other.csv'], expected: 'data.csv' },
    { title: 'data.csv', siblings: ['data.csv'], expected: 'data.csv (2)' },
    { title: 'data.csv', siblings: ['data.csv', 'data.csv (2)'], expected: 'data.csv (3)' },
    { title: 'data.csv', siblings: ['data.csv', 'data.csv (7)'], expected: 'data.csv (8)' },
    { title: 'Project', siblings: ['Project', 'Project (copy)'], expected: 'Project (2)' },
    { title: 'Project', siblings: ['Project (copy 4)'], expected: 'Project (5)' },
    // A numbered title counts from its base name.
    { title: 'Project (2)', siblings: ['Project', 'Project (2)'], expected: 'Project (3)' },
    // Regular expression characters in the title are literal.
    { title: 'a.b', siblings: ['a.b', 'axb (5)'], expected: 'a.b (2)' },
  ])('$title among $siblings → $expected', ({ title, siblings, expected }) => {
    expect(getUniqueName(title, siblings)).toBe(expected)
  })
})

describe('resolveDuplications', () => {
  const options = {
    targetId: DirectoryId('directory-target'),
    conflictingIds: [AssetId('file-1')],
  }

  afterEach(() => {
    useModals().closeAll()
  })

  function topEntry() {
    const entry = useModals().stack.value.at(-1)
    if (entry == null) throw new Error('No modal is open')
    return entry
  }

  test('replaces the open modals with the duplicate-name dialog', () => {
    useModals().open({ render: () => null }, {})
    void resolveDuplications(options).catch(() => {})
    expect(useModals().stack.value).toHaveLength(1)
    expect(topEntry().component).toBe(DuplicateAssetsModal)
    expect(topEntry().props).toMatchObject(options)
  })

  test('resolves with what the dialog submits', async () => {
    const promise = resolveDuplications(options)
    const resolutions: ResolvedDuplication[] = [{ assetId: AssetId('file-1'), conclusion: 'skip' }]
    ;(topEntry().props.onSubmit as (value: ResolvedDuplication[]) => void)(resolutions)
    await expect(promise).resolves.toBe(resolutions)
  })

  test('rejects when the dialog is cancelled', async () => {
    const promise = resolveDuplications(options)
    ;(topEntry().props.onCancel as () => void)()
    await expect(promise).rejects.toBeUndefined()
  })
})
