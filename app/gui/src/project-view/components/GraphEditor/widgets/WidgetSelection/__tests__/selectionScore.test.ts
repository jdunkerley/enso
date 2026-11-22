import type { WidgetInput } from '$/providers/openedProjects/widgetRegistry'
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { hasDropdown, underKindPicker } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'

const withTags = (dynamicConfig?: WidgetConfiguration): WidgetInput =>
  ({
    portId: 'p',
    value: undefined,
    dynamicConfig,
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'a', tagValues: ['A.x', 'A.y'] } },
  }) as unknown as WidgetInput

/** A Boolean argument (tagged `True`/`False`), unset. */
const booleanArgument = (dynamicConfig?: WidgetConfiguration): WidgetInput =>
  ({
    portId: 'p',
    value: undefined,
    dynamicConfig,
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'b', tagValues: ['True', 'False'] } },
  }) as unknown as WidgetInput

const singleChoice: WidgetConfiguration = {
  kind: 'Single_Choice',
  values: [{ value: '..Upper', label: 'Upper', parameters: [] }],
}

describe('WidgetSelection under the kind picker', () => {
  test('unmarked: tagValues claim an unset or text-default argument', () => {
    expect(hasDropdown(withTags())).toBe(true)
  })
  test('marked with a Text_Input kind, tagValues do not claim it', () => {
    expect(hasDropdown(underKindPicker(withTags({ kind: 'Text_Input' })))).toBe(false)
  })
  test('marked with no configuration (Nothing), tagValues do not claim it', () => {
    expect(hasDropdown(underKindPicker(withTags()))).toBe(false)
  })
  test('marked with a Single_Choice kind, it still claims', () => {
    expect(hasDropdown(underKindPicker(withTags(singleChoice)))).toBe(true)
  })
  test('marked with a Boolean_Input kind on a Boolean argument, it claims', () => {
    expect(hasDropdown(underKindPicker(booleanArgument({ kind: 'Boolean_Input' })))).toBe(true)
  })
  test('marked with another kind on a Boolean argument, it does not claim', () => {
    expect(hasDropdown(underKindPicker(booleanArgument({ kind: 'Text_Input' })))).toBe(false)
    expect(hasDropdown(underKindPicker(booleanArgument({ kind: 'Numeric_Input' })))).toBe(false)
    expect(hasDropdown(underKindPicker(booleanArgument()))).toBe(false)
  })
})
