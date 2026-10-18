/** @file The drive's categories: the local ones, the local Recent category, and added folders. */
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
import { newDirectoryId } from 'enso-common/src/services/LocalBackend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'

vi.mock('$/providers/backends', () => ({ useBackends: () => ({ localBackend: null }) }))
vi.mock('$/providers/localDirectories', () => ({
  useLocalPaths: () => reactive({ localRootDirectory: '/root' }),
}))
vi.mock('$/providers/text', () => ({ useText: () => ({ getText: (key: string) => key }) }))

describe('the local Recent category', () => {
  test('only the local categories are listed', () => {
    const categories = useCategories()
    expect(categories).not.toHaveProperty('cloudCategoriesList')
    expect(categories.localCategoriesList.map((category) => category.type)).toEqual([
      'local',
      'localRecent',
    ])
  })

  test('`isRecentCategory` is true for the local Recent only', () => {
    expect(isRecentCategory({ type: 'localRecent' })).toBe(true)
    expect(isRecentCategory('localRecent')).toBe(true)
    const others: Category[] = [
      { type: 'local' },
      { type: 'localDirectory', path: Path('/somewhere') },
    ]
    for (const category of others) expect(isRecentCategory(category)).toBe(false)
  })

  test('it has the Recent icon, and round-trips its key', () => {
    expect(categoryIcon('localRecent')).toBe('history')
    expect(categoryFromKey(categoryKey({ type: 'localRecent' }))).toEqual({ type: 'localRecent' })
  })

  test('every category is local, and the removed cloud keys parse to nothing', () => {
    expect(Object.keys(CATEGORY_BACKEND).sort()).toEqual(['local', 'localDirectory', 'localRecent'])
    for (const value of Object.values(CATEGORY_BACKEND)) expect(value).toBe(BackendType.local)
    for (const key of ['cloud', 'recent', 'trash', 'team-usergroup-a']) {
      expect(categoryFromKey(key)).toBeNull()
    }
  })

  test('dropping moves between local folders, and cancels into the same folder or Recent', () => {
    const dir: Category = { type: 'localDirectory', path: Path('/a') }
    expect(dropOperationBetweenCategories({ type: 'local' }, dir)).toBe('move')
    expect(dropOperationBetweenCategories(dir, dir)).toBe('cancel')
    expect(dropOperationBetweenCategories(dir, dir, newDirectoryId(Path('/a/b')))).toBe('move')
    expect(dropOperationBetweenCategories(dir, { type: 'localRecent' })).toBe('cancel')
    expect(dropOperationBetweenCategories({ type: 'localRecent' }, { type: 'local' })).toBe(
      'cancel',
    )
  })

  test('the local list is Local, then Recent, with no home directory', () => {
    const categories = useCategories()
    expect(categories.localCategoriesList.slice(0, 2)).toEqual([
      { type: 'local' },
      { type: 'localRecent' },
    ])
    expect(categories.categoryLabel({ type: 'localRecent' })).toBe('recentCategory')
    expect(categories.categoryDirectoryId({ type: 'localRecent' })).toBeNull()
  })
})

describe('a folder added on Windows', () => {
  const DIALOG_PATH = Path('C:\\Users\\me\\Empty folder')
  const NORMALISED = Path('C:/Users/me/Empty folder')

  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  test('is kept with forward slashes, the way the local backend lists it', async () => {
    const categories = (await import('$/providers/category')).useCategories()
    const added = categories.addLocalDirectory(DIALOG_PATH)
    expect(added).toBe(NORMALISED)
    expect(categories.localCategoriesList.slice(2)).toEqual([
      { type: 'localDirectory', path: NORMALISED },
    ])
    expect(categories.categoryDirectoryId({ type: 'localDirectory', path: added })).toBe(
      newDirectoryId(NORMALISED),
    )
    // Adding it again, spelt either way, does not list it twice.
    categories.addLocalDirectory(NORMALISED)
    expect(categories.localCategoriesList).toHaveLength(3)
  })

  test('saved with backslashes before, is listed with forward slashes and can be removed', async () => {
    localStorage.setItem(
      'enso-local-saved-directories',
      JSON.stringify({ state: { localDirectories: [DIALOG_PATH] }, version: 1 }),
    )
    const categories = (await import('$/providers/category')).useCategories()
    expect(categories.localCategoriesList.slice(2)).toEqual([
      { type: 'localDirectory', path: NORMALISED },
    ])
    expect(categories.removeLocalDirectory(NORMALISED)).toBe(true)
    expect(categories.localCategoriesList).toHaveLength(2)
  })
})
