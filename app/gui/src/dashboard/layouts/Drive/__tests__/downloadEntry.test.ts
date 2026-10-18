import { AssetType } from 'enso-common/src/services/Backend'
import { expect, test } from 'vitest'
import { canDownloadAsset } from '../downloadEntry'

test('only projects and datalinks offer Download', () => {
  expect(canDownloadAsset(AssetType.project)).toBe(true)
  expect(canDownloadAsset(AssetType.datalink)).toBe(true)
  expect(canDownloadAsset(AssetType.file)).toBe(false)
  expect(canDownloadAsset(AssetType.directory)).toBe(false)
  expect(canDownloadAsset(AssetType.secret)).toBe(false)
})
