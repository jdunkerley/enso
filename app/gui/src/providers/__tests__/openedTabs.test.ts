/**
 * @file Saved tabs from before the IDE was local only: a tab whose running project is a cloud or
 * hybrid one no longer parses, and the app starts with no restored tabs instead of failing.
 */
import '$/providers/container'
import LocalStorage from '$/utils/LocalStorage'
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { afterEach, expect, test, vi } from 'vitest'

const runningProject = {
  id: 'project-/root/P',
  parentId: 'directory-/root',
  title: 'P',
  ensoPath: '/root/P',
}

afterEach(() => localStorage.clear())

test.each(['cloud', 'hybrid'])('a saved %s project tab restores no tabs', (mode) => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  localStorage.setItem(
    `${PRODUCT_NAME}::openedTabs`,
    JSON.stringify([
      { type: 'project', id: runningProject.id, runningProject: { ...runningProject, mode } },
    ]),
  )
  expect(LocalStorage.getInstance().get('openedTabs')).toBeUndefined()
})

// Last: a parsed value stays cached in the `LocalStorage` singleton.
test('a saved local project tab is restored', () => {
  const tab = {
    type: 'project',
    id: runningProject.id,
    runningProject: { ...runningProject, mode: 'local' },
  }
  localStorage.setItem(`${PRODUCT_NAME}::openedTabs`, JSON.stringify([tab]))
  expect(LocalStorage.getInstance().get('openedTabs')).toEqual([tab])
})
