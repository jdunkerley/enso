import { BackendType, Plan } from 'enso-common/src/services/Backend'
import { describe, expect, test } from 'vitest'
import { Column, getColumnList } from '../columnUtils'

describe('getColumnList: the labels column', () => {
  test('is shown for a local backend that supports labels', () => {
    expect(getColumnList(Plan.free, BackendType.local, 'local', false, true)).toContain(
      Column.labels,
    )
  })

  test('is hidden for a backend that supports none', () => {
    expect(getColumnList(Plan.free, BackendType.local, 'local', false, false)).not.toContain(
      Column.labels,
    )
  })

  test('stays shown in the cloud', () => {
    expect(getColumnList(Plan.free, BackendType.remote, 'cloud', false, true)).toContain(
      Column.labels,
    )
  })
})
