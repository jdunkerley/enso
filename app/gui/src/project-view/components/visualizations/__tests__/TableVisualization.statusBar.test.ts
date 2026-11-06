// The fixtures below mirror the engine's visualization payload, whose field names are snake_case
// on the wire (`use_bottom_status_bar`, `value_type`, …). Renaming them to satisfy the lint rule
// would stop them matching what `Data` actually receives, so the rule is disabled for this file.
/* eslint-disable camelcase */
import { describe, expect, test } from 'vitest'
import { computeBottomStatusBar } from '../TableVisualization.vue'

const baseEnsoTableData = {
  type: 'EnsoTableOrColumn' as const,
  json: null,
  header: undefined,
  data: undefined,
  value_type: [],
  has_index_col: undefined,
  links: undefined,
  get_child_node_action: '',
  get_child_node_link_name: '',
  child_label: '',
  visualization_header: '',
  is_using_server_sort_and_filter: false,
  enable_create_node: false,
  requires_number_format: [],
  is_using_multi_filter: [],
}

describe('computeBottomStatusBar', () => {
  test('shows the row counts when the backend asks for a bottom status bar', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true }
    expect(computeBottomStatusBar(data, 42, null)).toEqual({
      total: 42,
      filtered: null,
      showFiltered: false,
    })
  })

  test('is absent when the backend did not ask for a bottom status bar', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: false }
    expect(computeBottomStatusBar(data, 42, null)).toBeUndefined()
    expect(computeBottomStatusBar('a plain string value', 42, null)).toBeUndefined()
  })

  test('shows the filtered count only when it differs from the total', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true }
    expect(computeBottomStatusBar(data, 42, 7)?.showFiltered).toBe(true)
    expect(computeBottomStatusBar(data, 42, 42)?.showFiltered).toBe(false)
    expect(computeBottomStatusBar(data, 42, null)?.showFiltered).toBe(false)
  })
})
