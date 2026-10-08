/**
 * @file The dashboard's bindings with the user's saved changes (#83), through `LocalStorage`
 * itself. #86's `dashboardInputBindings.test.ts` covers the same store.
 */
import { createDashboardInputBindings } from '$/providers/dashboardInputBindings'
import LocalStorage from '$/utils/LocalStorage'
import { afterEach, describe, expect, test } from 'vitest'

afterEach(() => {
  LocalStorage.getInstance().delete('inputBindings')
})

describe('createDashboardInputBindings', () => {
  test('the defaults, without saved bindings', () => {
    const bindings = createDashboardInputBindings(LocalStorage.getInstance())
    expect(bindings.metadata.settings.bindings).toEqual(['Mod+,'])
    expect(bindings.metadata.aboutThisApp.bindings).toEqual(['Mod+/'])
  })

  test('saved bindings replace the defaults', () => {
    // What is saved is always every action's list (see the next test).
    LocalStorage.getInstance().set('inputBindings', {
      settings: ['Mod+Shift+S'],
      aboutThisApp: ['Mod+/', 'F1'],
    })
    const bindings = createDashboardInputBindings(LocalStorage.getInstance())
    expect(bindings.metadata.settings.bindings).toEqual(['Mod+Shift+S'])
    expect(bindings.metadata.aboutThisApp.bindings).toEqual(['Mod+/', 'F1'])
  })

  test('changes are saved', () => {
    const storage = LocalStorage.getInstance()
    const bindings = createDashboardInputBindings(storage)
    bindings.add('aboutThisApp', 'F1')
    expect(storage.get('inputBindings')?.aboutThisApp).toEqual(['Mod+/', 'F1'])
    bindings.reset('aboutThisApp')
    expect(storage.get('inputBindings')?.aboutThisApp).toEqual(['Mod+/'])
  })
})
