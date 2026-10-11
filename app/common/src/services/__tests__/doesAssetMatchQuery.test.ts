/** @file Matching an asset against a search query. */
import { describe, expect, test } from 'vitest'
import * as backend from '../Backend.js'

const QUERY: backend.SearchDirectoryRequestParams = {
  parentId: null,
  query: null,
  title: null,
  description: null,
  type: null,
  extension: null,
  labels: null,
  sortExpression: null,
  sortDirection: null,
  from: null,
  pageSize: null,
}

const asset = (labels?: readonly string[]) =>
  ({
    type: backend.AssetType.project,
    title: 'Project',
    extension: null,
    ...(labels != null ? { labels: labels.map(backend.LabelName) } : {}),
  }) as unknown as backend.AnyAsset

describe('doesAssetMatchQuery: labels', () => {
  const matches = (labels: readonly string[] | null) =>
    backend.doesAssetMatchQuery({ ...QUERY, labels: labels?.map(backend.LabelName) ?? null })

  test('an asset carrying any of the labels matches', () => {
    expect(matches(['a'])(asset(['a', 'b']))).toBe(true)
    expect(matches(['x', 'b'])(asset(['a', 'b']))).toBe(true)
  })

  test('an asset carrying none of them does not', () => {
    expect(matches(['x'])(asset(['a']))).toBe(false)
    expect(matches(['x'])(asset())).toBe(false)
  })

  test('no labels match every asset', () => {
    expect(matches(null)(asset())).toBe(true)
    expect(matches([])(asset())).toBe(true)
  })
})
