/** @file The drive's categories: the local Recent category beside the cloud's. */
import {
  CATEGORY_BACKEND,
  categoryFromKey,
  categoryIcon,
  categoryKey,
  dropOperationBetweenCategories,
  isRecentCategory,
  useCategories,
  type Category,
} from '$/providers/category'
import { BackendType, Path } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

vi.mock('$/providers/auth', () => ({ useAuth: () => reactive({ session: null }) }))
vi.mock('$/providers/backends', () => ({ useBackends: () => ({ localBackend: null }) }))
vi.mock('$/providers/localDirectories', () => ({
  useLocalPaths: () => reactive({ localRootDirectory: '/root' }),
}))
vi.mock('$/providers/text', () => ({ useText: () => ({ getText: (key: string) => key }) }))

describe('the local Recent category', () => {
  test('`isRecentCategory` is true for both Recents only', () => {
    expect(isRecentCategory({ type: 'recent' })).toBe(true)
    expect(isRecentCategory({ type: 'localRecent' })).toBe(true)
    expect(isRecentCategory('localRecent')).toBe(true)
    expect(isRecentCategory('recent')).toBe(true)
    const others: Category[] = [
      { type: 'cloud' },
      { type: 'trash' },
      { type: 'local' },
      { type: 'localDirectory', path: Path('/somewhere') },
    ]
    for (const category of others) expect(isRecentCategory(category)).toBe(false)
  })

  test('it uses the local backend, has the Recent icon, and round-trips its key', () => {
    expect(CATEGORY_BACKEND.localRecent).toBe(BackendType.local)
    expect(CATEGORY_BACKEND.recent).toBe(BackendType.remote)
    expect(categoryIcon('localRecent')).toBe(categoryIcon('recent'))
    expect(categoryFromKey(categoryKey({ type: 'localRecent' }))).toEqual({ type: 'localRecent' })
  })

  test('nothing can be dropped into or out of either Recent', () => {
    expect(dropOperationBetweenCategories({ type: 'local' }, { type: 'localRecent' })).toBe(
      'cancel',
    )
    expect(dropOperationBetweenCategories({ type: 'localRecent' }, { type: 'local' })).toBe(
      'cancel',
    )
    expect(dropOperationBetweenCategories({ type: 'localRecent' }, { type: 'cloud' })).toBe(
      'cancel',
    )
    expect(dropOperationBetweenCategories({ type: 'cloud' }, { type: 'recent' })).toBe('cancel')
  })

  test('the local list is Local, then Recent, labelled as the cloud Recent, with no home directory', () => {
    const categories = useCategories()
    expect(categories.localCategoriesList.slice(0, 2)).toEqual([
      { type: 'local' },
      { type: 'localRecent' },
    ])
    expect(categories.categoryLabel({ type: 'localRecent' })).toBe('recentCategory')
    expect(categories.categoryDirectoryId({ type: 'localRecent' })).toBeNull()
  })
})
