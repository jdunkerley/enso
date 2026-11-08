/** @file When the drive table shows its parent-folder entry, and how the arrow keys reach it. */
import {
  arrowKeyIndex,
  PARENT_ENTRY_INDEX,
  parentEntryDirectoryId,
  rubberBandAssetIndex,
  type ParentEntryState,
} from '#/layouts/Drive/parentEntry'
import { DirectoryId } from 'enso-common/src/services/Backend'
import { describe, expect, test } from 'vitest'

const ROOT = DirectoryId('directory-root')
const FOLDER = DirectoryId('directory-folder')
const NESTED = DirectoryId('directory-nested')

/** A folder one level below the category's root, which shows the entry. */
const IN_FOLDER: ParentEntryState = {
  isRecent: false,
  isSearching: false,
  currentDirectoryId: NESTED,
  categoryRootId: ROOT,
  parentId: FOLDER,
}

describe('parentEntryDirectoryId', () => {
  test('is the parent of a folder below the category root', () => {
    expect(parentEntryDirectoryId(IN_FOLDER)).toBe(FOLDER)
    expect(
      parentEntryDirectoryId({ ...IN_FOLDER, currentDirectoryId: FOLDER, parentId: ROOT }),
    ).toBe(ROOT)
  })

  test('is null at the category root', () => {
    expect(
      parentEntryDirectoryId({
        ...IN_FOLDER,
        currentDirectoryId: ROOT,
        parentId: DirectoryId('directory-outside'),
      }),
    ).toBeNull()
  })

  test('is null in a Recent list and in search results', () => {
    expect(parentEntryDirectoryId({ ...IN_FOLDER, isRecent: true })).toBeNull()
    expect(parentEntryDirectoryId({ ...IN_FOLDER, isSearching: true })).toBeNull()
  })

  test('is null until the parent is known, and for a folder that is its own parent', () => {
    expect(parentEntryDirectoryId({ ...IN_FOLDER, parentId: undefined })).toBeNull()
    expect(parentEntryDirectoryId({ ...IN_FOLDER, parentId: null })).toBeNull()
    expect(parentEntryDirectoryId({ ...IN_FOLDER, parentId: NESTED })).toBeNull()
  })
})

describe('arrowKeyIndex', () => {
  test('moves between the assets, and stops at either end', () => {
    expect(arrowKeyIndex(1, 'down', 3, false, false)).toBe(2)
    expect(arrowKeyIndex(2, 'down', 3, false, false)).toBe(2)
    expect(arrowKeyIndex(1, 'up', 3, false, false)).toBe(0)
    expect(arrowKeyIndex(0, 'up', 3, false, false)).toBe(0)
  })

  test('reaches the entry above the first asset, and comes back down from it', () => {
    expect(arrowKeyIndex(0, 'up', 3, true, false)).toBe(PARENT_ENTRY_INDEX)
    expect(arrowKeyIndex(PARENT_ENTRY_INDEX, 'up', 3, true, false)).toBe(PARENT_ENTRY_INDEX)
    expect(arrowKeyIndex(PARENT_ENTRY_INDEX, 'down', 3, true, false)).toBe(0)
  })

  test('never extends a selection onto the entry', () => {
    expect(arrowKeyIndex(0, 'up', 3, true, true)).toBe(0)
    expect(arrowKeyIndex(PARENT_ENTRY_INDEX, 'down', 3, true, true)).toBe(0)
  })

  test('stays on the entry in an empty folder', () => {
    expect(arrowKeyIndex(PARENT_ENTRY_INDEX, 'down', 0, true, false)).toBe(PARENT_ENTRY_INDEX)
  })
})

describe('rubberBandAssetIndex', () => {
  const ROW = 36
  const HEIGHT = 360

  test('counts from the first asset, below the heading', () => {
    expect(rubberBandAssetIndex(ROW, 0, HEIGHT, ROW, false)).toBe(0)
    expect(rubberBandAssetIndex(ROW * 3, 0, HEIGHT, ROW, false)).toBe(2)
  })

  test('skips the parent-folder entry while it is in view', () => {
    expect(rubberBandAssetIndex(ROW, 0, HEIGHT, ROW, true)).toBe(0)
    expect(rubberBandAssetIndex(ROW * 2, 0, HEIGHT, ROW, true)).toBe(0)
    expect(rubberBandAssetIndex(ROW * 3, 0, HEIGHT, ROW, true)).toBe(1)
  })

  test('scrolled, the row just below the heading is an asset, not the entry', () => {
    // Scrolled by 10 rows: the entry and assets 0-8 are above the heading; asset 9 is right below.
    const scrollTop = ROW * 10
    expect(Math.floor(rubberBandAssetIndex(ROW + 4, scrollTop, HEIGHT, ROW, true))).toBe(9)
    expect(Math.floor(rubberBandAssetIndex(ROW + 4, scrollTop, HEIGHT, ROW, false))).toBe(10)
  })

  test('clamps a position above the heading or below the root', () => {
    expect(rubberBandAssetIndex(-50, 0, HEIGHT, ROW, true)).toBe(0)
    expect(rubberBandAssetIndex(HEIGHT * 3, 0, HEIGHT, ROW, false)).toBe(HEIGHT / ROW)
  })
})
