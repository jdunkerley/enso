import { BINDINGS } from '$/configurations/inputBindings'
import { createDashboardInputBindings } from '$/providers/dashboardInputBindings'
import LocalStorage from '$/utils/LocalStorage'
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { afterEach, describe, expect, test } from 'vitest'
import { computed } from 'vue'

/** The key the bindings have always been saved under in `window.localStorage`. */
const STORAGE_KEY = `${PRODUCT_NAME}::inputBindings`

/** A stand-in for `LocalStorage` holding only the bindings. */
function fakeStorage(initial?: Readonly<Record<string, readonly string[]>>) {
  let stored = initial
  return {
    get: () => stored,
    set: (_key: string, value: Readonly<Record<string, readonly string[]>>) => {
      stored = value
    },
    stored: () => stored,
  } as const
}

afterEach(() => {
  window.localStorage.clear()
})

describe('createDashboardInputBindings', () => {
  test('starts from the defaults when nothing is saved', () => {
    const bindings = createDashboardInputBindings(fakeStorage() as never)
    expect(bindings.metadata.rename.bindings).toEqual(BINDINGS.rename.bindings)
  })

  test("loads the user's changes, replacing each changed action's bindings", () => {
    const bindings = createDashboardInputBindings(
      fakeStorage({ rename: ['Mod+Shift+R', 'F2'], duplicate: [] }) as never,
    )
    expect(bindings.metadata.rename.bindings).toEqual(['Mod+Shift+R', 'F2'])
    expect(bindings.metadata.duplicate.bindings).toEqual([])
  })

  test('an action missing from the saved bindings has none, as the React provider loaded them', () => {
    // Every save writes every action, so this only happens to an action added in a later release.
    // Kept as it was for #170, which unifies the registries.
    const bindings = createDashboardInputBindings(fakeStorage({ rename: ['F2'] }) as never)
    expect(bindings.metadata.copy.bindings).toEqual([])
  })

  test('ignores saved actions that no longer exist', () => {
    const bindings = createDashboardInputBindings(
      fakeStorage({ noSuchAction: ['Mod+Q'], rename: ['F2'] }) as never,
    )
    expect(bindings.metadata.rename.bindings).toEqual(['F2'])
    expect('noSuchAction' in bindings.metadata).toBe(false)
  })

  test('saves every action after a change, in the same format', () => {
    const storage = fakeStorage()
    const bindings = createDashboardInputBindings(storage as never)
    bindings.add('rename', 'F2')
    expect(storage.stored()?.rename).toEqual([...BINDINGS.rename.bindings, 'F2'])
    bindings.delete('rename', 'F2')
    expect(storage.stored()?.rename).toEqual(BINDINGS.rename.bindings)
    bindings.delete('copy', 'Mod+C')
    expect(storage.stored()?.copy).toEqual([])
    bindings.reset('copy')
    expect(storage.stored()?.copy).toEqual(BINDINGS.copy.bindings)
    expect(Object.keys(storage.stored() ?? {}).sort()).toEqual(Object.keys(BINDINGS).sort())
  })

  test('changes are seen by Vue', () => {
    const bindings = createDashboardInputBindings(fakeStorage() as never)
    const rename = computed(() => bindings.metadata.rename.bindings)
    expect(rename.value).toEqual(BINDINGS.rename.bindings)
    bindings.add('rename', 'F2')
    expect(rename.value).toEqual([...BINDINGS.rename.bindings, 'F2'])
  })

  test('changes reach the event handlers', () => {
    const bindings = createDashboardInputBindings(fakeStorage() as never)
    let renamed = 0
    const handler = bindings.handler({ rename: () => void renamed++ })
    bindings.add('rename', 'F2')
    handler(new KeyboardEvent('keydown', { key: 'F2' }))
    expect(renamed).toBe(1)
  })

  test('reads what the React dashboard saved in window.localStorage, unchanged', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rename: ['Mod+Shift+R'], settings: ['Mod+,', 'F10'] }),
    )
    const bindings = createDashboardInputBindings(LocalStorage.getInstance())
    expect(bindings.metadata.rename.bindings).toEqual(['Mod+Shift+R'])
    expect(bindings.metadata.settings.bindings).toEqual(['Mod+,', 'F10'])
    bindings.add('rename', 'F2')
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    expect(saved).toMatchObject({ rename: ['Mod+Shift+R', 'F2'], settings: ['Mod+,', 'F10'] })
  })
})
