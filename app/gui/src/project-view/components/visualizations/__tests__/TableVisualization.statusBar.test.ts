import { describe, expect, test } from 'vitest'
import { computeUseBottomStatusBar } from '../TableVisualization.vue'

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

describe('computeUseBottomStatusBar', () => {
  test('is false when the backend requests it but no AG Grid Enterprise license is configured', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true }
    expect(computeUseBottomStatusBar(data, false)).toBe(false)
  })

  test('is true when the backend requests it and a license is configured', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true }
    expect(computeUseBottomStatusBar(data, true)).toBe(true)
  })

  test('is false when the backend does not request it, even when licensed', () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: false }
    expect(computeUseBottomStatusBar(data, true)).toBe(false)
  })

  test('is false for data shapes without a use_bottom_status_bar field, regardless of license', () => {
    expect(computeUseBottomStatusBar('a plain string value', true)).toBe(false)
    expect(computeUseBottomStatusBar('a plain string value', false)).toBe(false)
  })
})
