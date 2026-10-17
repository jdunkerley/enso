import { AssetType } from 'enso-common/src/services/Backend'
import { expect, test } from 'vitest'
import { canDownloadAsset } from '../downloadEntry'

test('locally only projects and datalinks offer Download', () => {
  expect(canDownloadAsset(false, AssetType.project)).toBe(true)
  expect(canDownloadAsset(false, AssetType.datalink)).toBe(true)
  expect(canDownloadAsset(false, AssetType.file)).toBe(false)
  expect(canDownloadAsset(false, AssetType.directory)).toBe(false)
  expect(canDownloadAsset(false, AssetType.secret)).toBe(false)
})

test('in the cloud everything but a directory offers Download', () => {
  expect(canDownloadAsset(true, AssetType.datalink)).toBe(true)
  expect(canDownloadAsset(true, AssetType.file)).toBe(true)
  expect(canDownloadAsset(true, AssetType.directory)).toBe(false)
})
