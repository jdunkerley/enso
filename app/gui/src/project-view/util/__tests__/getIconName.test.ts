import { DEFAULT_ICON, displayedIconOf } from '@/util/getIconName'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

const textType = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Data.Text.Text' as QualifiedName,
)

test('with nothing known, the default icon is used', () => {
  expect(displayedIconOf()).toBe(DEFAULT_ICON)
})

test('with nothing known, the cached icon is used', () => {
  expect(displayedIconOf(undefined, undefined, undefined, 'table')).toBe('table')
})

test('a known type beats the cached icon', () => {
  expect(displayedIconOf(undefined, undefined, textType, 'table')).toBe('text_input')
})
