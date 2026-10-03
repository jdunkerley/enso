/**
 * @file The window's bindings (#170): one store for the dashboard's and the graph editor's, loading
 * every saved format and saving the versioned extension of the old one.
 */
import { GRAPH_BINDINGS } from '$/configurations/graphInputBindings'
import { BINDINGS } from '$/configurations/inputBindings'
import {
  createInputBindingsStore,
  FORMAT_VERSION,
  FORMAT_VERSION_KEY,
} from '$/providers/inputBindings'
import LocalStorage from '$/utils/LocalStorage'
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { mapEntries } from 'enso-common/src/utilities/data/object'
import { afterEach, describe, expect, test } from 'vitest'
import { computed } from 'vue'
import { z } from 'zod'

/** The key the bindings have always been saved under in `window.localStorage`. */
const STORAGE_KEY = `${PRODUCT_NAME}::inputBindings`

type Saved = Readonly<Record<string, readonly string[]>>

/** A stand-in for `LocalStorage` holding only the bindings. */
function fakeStorage(initial?: Saved) {
  let stored = initial
  return {
    get: () => stored,
    set: (_key: string, value: Saved) => {
      stored = value
    },
    stored: () => stored,
  } as const
}

const create = (storage: ReturnType<typeof fakeStorage>) =>
  createInputBindingsStore(storage as never)

/** Every dashboard action with its default bindings: what a version 1 build saved, untouched. */
const VERSION_1_DEFAULTS: Saved = mapEntries(BINDINGS, (_key, info) => info.bindings)

/**
 * How a version 1 build (#86 and before) read the saved bindings: its schema, then each dashboard
 * action replaced by what was saved, or left with none.
 */
function loadAsVersion1(saved: unknown) {
  const schema = z.record(z.string().array().readonly())
  const parsed = schema.safeParse(saved)
  if (!parsed.success) return undefined
  return mapEntries(BINDINGS, (key) => parsed.data[key] ?? [])
}

afterEach(() => {
  window.localStorage.clear()
})

describe('loading', () => {
  test('nothing saved: the defaults', () => {
    const store = create(fakeStorage())
    expect(store.dashboard.metadata.rename.bindings).toEqual(BINDINGS.rename.bindings)
    expect(store.graph.metadata['graph.undo'].bindings).toEqual(['Mod+Z'])
  })

  test("version 1: the user's dashboard bindings, unchanged", () => {
    const saved = { ...VERSION_1_DEFAULTS, rename: ['Mod+Shift+R', 'F2'], duplicate: [] }
    const store = create(fakeStorage(saved))
    expect(store.dashboard.metadata.rename.bindings).toEqual(['Mod+Shift+R', 'F2'])
    expect(store.dashboard.metadata.duplicate.bindings).toEqual([])
    for (const key of Object.keys(BINDINGS) as (keyof typeof BINDINGS)[]) {
      expect(store.dashboard.metadata[key].bindings, key).toEqual(saved[key])
    }
    // The graph editor's are the defaults: version 1 had none.
    for (const key of Object.keys(GRAPH_BINDINGS) as (keyof typeof GRAPH_BINDINGS)[]) {
      expect(store.graph.metadata[key].bindings, key).toEqual(GRAPH_BINDINGS[key].bindings)
    }
  })

  test('an action missing from the saved record keeps its defaults', () => {
    const store = create(fakeStorage({ rename: ['F2'] }))
    expect(store.dashboard.metadata.rename.bindings).toEqual(['F2'])
    expect(store.dashboard.metadata.copy.bindings).toEqual(BINDINGS.copy.bindings)
  })

  test("version 2: the user's graph bindings too", () => {
    const store = create(
      fakeStorage({
        [FORMAT_VERSION_KEY]: ['2'],
        ...VERSION_1_DEFAULTS,
        'graph.undo': ['Mod+U'],
        'graph.fitAll': [],
      }),
    )
    expect(store.graph.metadata['graph.undo'].bindings).toEqual(['Mod+U'])
    expect(store.graph.metadata['graph.fitAll'].bindings).toEqual([])
    expect(store.graph.metadata['graph.redo'].bindings).toEqual(
      GRAPH_BINDINGS['graph.redo'].bindings,
    )
  })

  test('ignores unknown actions, and graph actions that are not rebindable', () => {
    const store = create(
      fakeStorage({
        noSuchAction: ['Mod+Q'],
        'graph.noSuchAction': ['Mod+Q'],
        'graph.deselectAll': ['Q'],
        'graph.deleteSelectedEdge': ['Q'],
      }),
    )
    expect('noSuchAction' in store.dashboard.metadata).toBe(false)
    expect('graph.noSuchAction' in store.graph.metadata).toBe(false)
    expect(store.graph.metadata['graph.deselectAll'].bindings).toEqual(['Escape'])
    expect(store.graph.metadata['graph.deleteSelectedEdge'].bindings).toEqual([
      'Delete',
      'Backspace',
    ])
  })
})

describe('saving', () => {
  test('writes the version, every dashboard action, and only the changed graph actions', () => {
    const storage = fakeStorage()
    const store = create(storage)
    store.add('graph.undo', 'Mod+U')
    expect(storage.stored()).toEqual({
      [FORMAT_VERSION_KEY]: [String(FORMAT_VERSION)],
      ...VERSION_1_DEFAULTS,
      'graph.undo': ['Mod+Z', 'Mod+U'],
    })
    store.add('rename', 'F2')
    expect(storage.stored()?.rename).toEqual([...BINDINGS.rename.bindings, 'F2'])
    expect(storage.stored()?.['graph.undo']).toEqual(['Mod+Z', 'Mod+U'])
  })

  test('a graph action back at its defaults is no longer saved', () => {
    const storage = fakeStorage()
    const store = create(storage)
    store.delete('graph.undo', 'Mod+Z')
    expect(storage.stored()?.['graph.undo']).toEqual([])
    store.reset('graph.undo')
    expect(storage.stored()).not.toHaveProperty(['graph.undo'])
    store.add('graph.fitAll', 'F2')
    store.delete('graph.fitAll', 'F2')
    expect(storage.stored()).not.toHaveProperty(['graph.fitAll'])
  })

  test('a version 1 build reads what this one saves, dashboard bindings unchanged', () => {
    const storage = fakeStorage({ ...VERSION_1_DEFAULTS, rename: ['F2'] })
    const store = create(storage)
    store.add('graph.undo', 'Mod+U')
    store.add('copy', 'Mod+Shift+Y')
    expect(loadAsVersion1(storage.stored())).toEqual({
      ...VERSION_1_DEFAULTS,
      rename: ['F2'],
      copy: [...BINDINGS.copy.bindings, 'Mod+Shift+Y'],
    })
  })

  test('saves what it loaded, and loads what it saved', () => {
    const storage = fakeStorage({ ...VERSION_1_DEFAULTS, rename: ['F2'] })
    create(storage).add('graph.undo', 'Mod+U')
    const reloaded = create(fakeStorage(storage.stored()))
    expect(reloaded.dashboard.metadata.rename.bindings).toEqual(['F2'])
    expect(reloaded.graph.metadata['graph.undo'].bindings).toEqual(['Mod+Z', 'Mod+U'])
  })

  test('resetAll restores every default, and saves once', () => {
    let saves = 0
    const storage = fakeStorage()
    const store = createInputBindingsStore({
      get: storage.get,
      set: (key, value) => {
        saves += 1
        storage.set(key, value)
      },
    } as never)
    store.delete('rename', 'Mod+R')
    store.add('graph.undo', 'Mod+U')
    saves = 0
    store.resetAll()
    expect(saves).toBe(1)
    expect(storage.stored()).toEqual({
      [FORMAT_VERSION_KEY]: [String(FORMAT_VERSION)],
      ...VERSION_1_DEFAULTS,
    })
  })
})

describe('editing', () => {
  test('an action that is not rebindable cannot be changed', () => {
    const storage = fakeStorage()
    const store = create(storage)
    store.add('graph.deselectAll', 'Q')
    store.delete('graph.deselectAll', 'Escape')
    store.add('graph.deleteSelectedEdge', 'Q')
    store.add('app.cancel', 'Q')
    store.add('closeModal', 'Q')
    expect(store.graph.metadata['graph.deselectAll'].bindings).toEqual(['Escape'])
    expect(store.graph.metadata['graph.deleteSelectedEdge'].bindings).toEqual([
      'Delete',
      'Backspace',
    ])
    expect(store.dashboard.metadata.closeModal.bindings).toEqual(['Escape'])
    expect(storage.stored()).toBeUndefined()
  })

  test('removing a binding an action lacks changes nothing', () => {
    const store = create(fakeStorage())
    store.delete('graph.redo', 'Mod+Q')
    expect(store.graph.metadata['graph.redo'].bindings).toEqual(
      GRAPH_BINDINGS['graph.redo'].bindings,
    )
  })

  test('adding a binding twice adds it once', () => {
    const store = create(fakeStorage())
    store.add('graph.undo', 'Mod+U')
    store.add('graph.undo', 'Mod+U')
    expect(store.graph.metadata['graph.undo'].bindings).toEqual(['Mod+Z', 'Mod+U'])
  })

  test('changes are seen by Vue, in the shortcuts and their conflicts', () => {
    const store = create(fakeStorage())
    const undo = computed(
      () => store.shortcuts.find((shortcut) => shortcut.id === 'graph.undo')?.bindings,
    )
    const fitAllConflicts = computed(() => store.conflicts.get('graph.fitAll'))
    expect(undo.value).toEqual(['Mod+Z'])
    expect(fitAllConflicts.value).toBeUndefined()
    store.add('graph.undo', 'Mod+U')
    expect(undo.value).toEqual(['Mod+Z', 'Mod+U'])
    store.add('graph.fitAll', 'Mod+U')
    expect(fitAllConflicts.value?.get('Mod+U')?.map((other) => other.id)).toEqual(['graph.undo'])
  })

  test('conflictsFor checks against the current bindings, by scope', () => {
    const store = create(fakeStorage())
    expect(store.conflictsFor('graph.fitAll', 'Mod+U').map((other) => other.id)).toEqual([])
    store.add('aboutThisApp', 'Mod+U')
    expect(store.conflictsFor('graph.fitAll', 'Mod+U').map((other) => other.id)).toEqual([
      'aboutThisApp',
    ])
    // The drive's are never active with the graph's.
    store.add('rename', 'Mod+J')
    expect(store.conflictsFor('graph.fitAll', 'Mod+J')).toEqual([])
  })
})

describe('in window.localStorage', () => {
  test('reads what a version 1 build saved, and keeps the key', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...VERSION_1_DEFAULTS,
        rename: ['Mod+Shift+R'],
        settings: ['Mod+,', 'F10'],
      }),
    )
    const store = createInputBindingsStore(LocalStorage.getInstance())
    expect(store.dashboard.metadata.rename.bindings).toEqual(['Mod+Shift+R'])
    expect(store.dashboard.metadata.settings.bindings).toEqual(['Mod+,', 'F10'])
    store.add('graph.undo', 'Mod+U')
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    expect(saved).toMatchObject({
      [FORMAT_VERSION_KEY]: ['2'],
      rename: ['Mod+Shift+R'],
      settings: ['Mod+,', 'F10'],
      'graph.undo': ['Mod+Z', 'Mod+U'],
    })
    LocalStorage.getInstance().delete('inputBindings')
  })
})
