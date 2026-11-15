import {
  HELP_ARGUMENTS_EXPANDED_STORAGE_KEY,
  useHelpArgumentsExpanded,
} from '@/components/ComponentHelp/expanded'
import { beforeEach, expect, test } from 'vitest'
import { nextTick } from 'vue'

beforeEach(() => localStorage.removeItem(HELP_ARGUMENTS_EXPANDED_STORAGE_KEY))

test('collapsed by default; a choice persists across calls', async () => {
  expect(useHelpArgumentsExpanded().value).toBe(false)
  useHelpArgumentsExpanded().value = true
  await nextTick()
  expect(useHelpArgumentsExpanded().value).toBe(true)
})

test('a stored value that is not a boolean counts as collapsed', () => {
  localStorage.setItem(HELP_ARGUMENTS_EXPANDED_STORAGE_KEY, '"yes"')
  expect(useHelpArgumentsExpanded().value).toBe(false)
})
