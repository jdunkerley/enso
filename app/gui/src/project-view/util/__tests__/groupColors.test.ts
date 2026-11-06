import type { GroupInfo } from '$/providers/openedProjects/suggestionDatabase/groupInfo'
import { colorFromString } from '@/util/colors'
import { groupColor, groupColorStyle, groupColorVar } from '@/util/groupColors'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

const selections: GroupInfo = {
  name: 'Selections',
  project: 'Standard.Base' as QualifiedName,
  color: 'oklch(0.464 0.14 325)',
}

test('the CSS variable name replaces non-word characters', () => {
  expect(groupColorVar(selections)).toBe('--group-color-Standard-Base-Selections')
  expect(groupColorVar({ ...selections, name: 'Date Time' })).toBe(
    '--group-color-Standard-Base-Date-Time',
  )
  expect(groupColorVar(undefined)).toBe('--group-color-fallback')
  expect(groupColorStyle(selections)).toBe('var(--group-color-Standard-Base-Selections)')
})

test('a group is coloured by its declared colour, else from its name', () => {
  expect(groupColor(selections)).toBe('oklch(0.464 0.14 325)')
  const { color: _, ...uncoloured } = selections
  expect(groupColor(uncoloured)).toBe(colorFromString('Selections'))
})
