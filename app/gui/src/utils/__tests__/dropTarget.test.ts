/** @file Tests for the drop-target ancestry check. */
import { canDropAssetsInto, isDirectoryWithin } from '$/utils/dropTarget'
import { AssetType, DirectoryId, Path, type AssetId } from 'enso-common/src/services/Backend'
import { newDirectoryId, newProjectId } from 'enso-common/src/services/LocalBackend'
import { describe, expect, test } from 'vitest'

const dir = (path: string) => newDirectoryId(Path(path))
const folder = (path: string) => ({ id: dir(path) as AssetId, type: AssetType.directory })

describe('isDirectoryWithin', () => {
  test('a directory is within itself', () => {
    expect(isDirectoryWithin(dir('/r/X'), dir('/r/X'))).toBe(true)
  })

  test('a descendant, however deep, is within', () => {
    expect(isDirectoryWithin(dir('/r/X/Y'), dir('/r/X'))).toBe(true)
    expect(isDirectoryWithin(dir('/r/X/Y/Z'), dir('/r/X'))).toBe(true)
  })

  test('a sibling or ancestor is not within', () => {
    expect(isDirectoryWithin(dir('/r/Y'), dir('/r/X'))).toBe(false)
    expect(isDirectoryWithin(dir('/r'), dir('/r/X'))).toBe(false)
  })

  test('a name sharing only a prefix is not within', () => {
    expect(isDirectoryWithin(dir('/r/XY'), dir('/r/X'))).toBe(false)
    expect(isDirectoryWithin(dir('/r/X2/Y'), dir('/r/X'))).toBe(false)
  })

  test('Windows separators and a trailing one are read as the same path', () => {
    expect(isDirectoryWithin(dir('C:\\r\\X\\Y'), dir('C:/r/X'))).toBe(true)
    expect(isDirectoryWithin(dir('/r/X/Y'), dir('/r/X/'))).toBe(true)
  })

  test('an id that is not a typed path is within only itself', () => {
    const odd = DirectoryId('not-a-typed-id')
    expect(isDirectoryWithin(odd, dir('/r/X'))).toBe(false)
    expect(isDirectoryWithin(odd, odd)).toBe(true)
  })
})

describe('canDropAssetsInto', () => {
  test('refuses a folder dropped on itself or its subfolder', () => {
    expect(canDropAssetsInto([folder('/r/X')], dir('/r/X'))).toBe(false)
    expect(canDropAssetsInto([folder('/r/X')], dir('/r/X/Y'))).toBe(false)
  })

  test('allows other targets', () => {
    expect(canDropAssetsInto([folder('/r/X')], dir('/r'))).toBe(true)
    expect(canDropAssetsInto([folder('/r/X')], dir('/r/Z'))).toBe(true)
    expect(canDropAssetsInto([folder('/r/X')], dir('/r/XY'))).toBe(true)
  })

  test('refuses a selection of which any folder contains the target', () => {
    const file = { id: newProjectId(Path('/r/P')) as AssetId, type: AssetType.project }
    expect(canDropAssetsInto([file, folder('/r/Z'), folder('/r/X')], dir('/r/X/Y'))).toBe(false)
    expect(canDropAssetsInto([file, folder('/r/Z')], dir('/r/X/Y'))).toBe(true)
  })

  test('allows an empty selection', () => {
    expect(canDropAssetsInto([], dir('/r/X'))).toBe(true)
  })
})
