/**
 * @file The one registry of keyboard shortcuts (#170): the graph editor's defaults are those it had
 * before, every action has a name, and conflicts are found by scope.
 */
import { GRAPH_BINDINGS } from '$/configurations/graphInputBindings'
import { BINDINGS } from '$/configurations/inputBindings'
import {
  APP_SHELL_BINDINGS,
  canonicalShortcut,
  conflictsFor,
  currentConflicts,
  dashboardActionScope,
  defaultShortcuts,
  listShortcuts,
  scopesOverlap,
  SHORTCUT_CATEGORIES,
  type Shortcut,
  type ShortcutId,
  type ShortcutScope,
} from '$/configurations/keyboardShortcuts'
import { useText } from '$/providers/text'
import { appBindings, appContainerBindings, commandPaletteBindings } from '@/bindings'
import { isMacLike } from '@/composables/events'
import { parseKeybindString } from '@/util/shortcuts'
import { mapEntries } from 'enso-common/src/utilities/data/object'
import { beforeAll, describe, expect, test } from 'vitest'

const { getText } = useText()

// jsdom has no `PointerEvent`, which the handlers test for.
class MockPointerEvent extends MouseEvent {}
beforeAll(() => {
  ;(window as any).PointerEvent ??= MockPointerEvent
})

/** A `keydown` event for a binding string, on this (non-macOS) test platform. */
function keydownFor(binding: string) {
  const { info } = parseKeybindString(binding)
  return new KeyboardEvent('keydown', {
    key: info.key,
    ctrlKey: info.modifiers.includes('Mod'),
    altKey: info.modifiers.includes('Alt'),
    shiftKey: info.modifiers.includes('Shift'),
    cancelable: true,
  })
}

const byId = (shortcuts: readonly Shortcut[], id: ShortcutId) => {
  const shortcut = shortcuts.find((candidate) => candidate.id === id)
  if (shortcut == null) throw new Error(`No shortcut ${id}.`)
  return shortcut
}

describe('the graph editor’s defaults', () => {
  test('are exactly those before #170, in the same order', () => {
    // Copied from `@/bindings` as it was on `develop` before the graph's shortcuts became
    // rebindable. The order is the order in which a key is offered to the actions.
    expect(mapEntries(GRAPH_BINDINGS, (_key, info) => info.bindings)).toStrictEqual({
      'graph.toggleCodeEditor': ['Mod+`'],
      'graph.toggleDocumentationEditor': ['Mod+D'],
      'graph.undo': ['Mod+Z'],
      'graph.redo': isMacLike ? ['Mod+Shift+Z', 'Mod+Y'] : ['Mod+Y', 'Mod+Shift+Z'],
      'graph.openComponentBrowser': ['Enter'],
      'graph.toggleVisualization': ['Space'],
      'components.deleteSelected': ['Delete', 'Backspace'],
      'graph.fitAll': ['Mod+Shift+A'],
      'graph.selectAll': ['Mod+A'],
      'graph.deselectAll': ['Escape'],
      'components.copy': ['Mod+C'],
      'graph.pasteNode': ['Mod+V'],
      'components.collapse': ['Mod+G'],
      'graph.startProfiling': ['Mod+Alt+,'],
      'graph.stopProfiling': ['Mod+Alt+.'],
      'component.enterNode': ['Mod+E'],
      'graph.navigateUp': ['Mod+Shift+E'],
      'components.pickColorMulti': ['Mod+Shift+C'],
      'components.tidyUp': ['Mod+Shift+L'],
      'graph.openDocumentation': ['F1'],
      'graph.deleteSelectedEdge': ['Delete', 'Backspace'],
    })
    expect(Object.keys(GRAPH_BINDINGS)).toEqual([
      'graph.toggleCodeEditor',
      'graph.toggleDocumentationEditor',
      'graph.undo',
      'graph.redo',
      'graph.openComponentBrowser',
      'graph.toggleVisualization',
      'components.deleteSelected',
      'graph.fitAll',
      'graph.selectAll',
      'graph.deselectAll',
      'components.copy',
      'graph.pasteNode',
      'components.collapse',
      'graph.startProfiling',
      'graph.stopProfiling',
      'component.enterNode',
      'graph.navigateUp',
      'components.pickColorMulti',
      'components.tidyUp',
      'graph.openDocumentation',
      'graph.deleteSelectedEdge',
    ])
  })

  test('Escape and the connection’s Delete are not rebindable', () => {
    const shortcuts = defaultShortcuts()
    expect(byId(shortcuts, 'graph.deselectAll').rebindable).toBe(false)
    const edge = byId(shortcuts, 'graph.deleteSelectedEdge')
    expect(edge.rebindable).toBe(false)
    expect(edge.follows).toBe('components.deleteSelected')
  })
})

describe('the app shell’s fixed shortcuts', () => {
  test.each([
    ['app.cancel', appBindings],
    ['app.close', appBindings],
    ['app.closeTab', appContainerBindings],
    ['commandPalette.open', commandPaletteBindings],
  ] as const)('%s matches its namespace in `@/bindings`', (id, namespace) => {
    const bindings = APP_SHELL_BINDINGS[id]
    expect(namespace.bindings[id as keyof typeof namespace.bindings]).toEqual(
      parseKeybindString(bindings[0]).info,
    )
    for (const binding of bindings) {
      let handled = false
      namespace.handler({ [id]: () => void (handled = true) })(keydownFor(binding))
      expect(handled, binding).toBe(true)
    }
  })
})

describe('the registry', () => {
  const shortcuts = defaultShortcuts()

  test('has every action once, dashboard ids plain and the others dotted', () => {
    const ids = shortcuts.map((shortcut) => shortcut.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(
      Object.keys(BINDINGS).length +
        Object.keys(GRAPH_BINDINGS).length +
        Object.keys(APP_SHELL_BINDINGS).length,
    )
    for (const shortcut of shortcuts) {
      expect(shortcut.id.includes('.'), shortcut.id).toBe(shortcut.owner !== 'dashboard')
    }
  })

  test('names every action, and every category', () => {
    for (const shortcut of shortcuts) {
      expect(getText(shortcut.nameTextId), shortcut.id).not.toBe(shortcut.nameTextId)
      if (shortcut.rebindable) expect(shortcut.category, shortcut.id).toBeDefined()
    }
    for (const category of SHORTCUT_CATEGORIES) {
      expect(getText(`${category}BindingCategory`), category).not.toBe(`${category}BindingCategory`)
    }
    expect(new Set(SHORTCUT_CATEGORIES).size).toBe(SHORTCUT_CATEGORIES.length)
  })

  test('gives each part of the app its scope', () => {
    expect(byId(shortcuts, 'graph.undo').scope).toBe('graph')
    expect(byId(shortcuts, 'commandPalette.open').scope).toBe('app')
    expect(dashboardActionScope('settings')).toBe('app')
    expect(dashboardActionScope('aboutThisApp')).toBe('app')
    expect(dashboardActionScope('goBack')).toBe('app')
    expect(dashboardActionScope('copy')).toBe('drive')
    expect(dashboardActionScope('rename')).toBe('drive')
  })

  test('has no conflicts among the defaults', () => {
    expect([...currentConflicts(shortcuts).keys()]).toEqual([])
  })

  test('no rebindable graph default has the key of a shortcut active over the graph', () => {
    // Shared defaults (Delete for components and connections) are the same action for conflicts.
    // Escape, which cancels everywhere, is not rebindable.
    for (const shortcut of shortcuts.filter((s) => s.owner === 'graph' && s.rebindable)) {
      for (const binding of shortcut.defaults) {
        expect(
          conflictsFor(shortcuts, shortcut, binding).map((other) => other.id),
          `${shortcut.id}: ${binding}`,
        ).toEqual([])
      }
    }
  })
})

describe('scopes', () => {
  test.each<[ShortcutScope, ShortcutScope, boolean]>([
    ['app', 'app', true],
    ['app', 'drive', true],
    ['app', 'graph', true],
    ['drive', 'drive', true],
    ['graph', 'graph', true],
    ['drive', 'graph', false],
  ])('%s and %s overlap: %s', (a, b, overlap) => {
    expect(scopesOverlap(a, b)).toBe(overlap)
    expect(scopesOverlap(b, a)).toBe(overlap)
  })
})

describe('canonicalShortcut', () => {
  test.each([
    ['Mod+Shift+K', 'shift+mod+k'],
    ['OsDelete', 'Delete'],
    ['Space', 'space'],
  ])('%s is %s', (a, b) => {
    expect(canonicalShortcut(a)).toBe(canonicalShortcut(b))
  })

  test.each([
    ['Mod+K', 'Mod+Shift+K'],
    ['Mod+C', 'Mod+V'],
    ['Delete', 'Backspace'],
    ['PointerMain', 'Mod+PointerMain'],
  ])('%s is not %s', (a, b) => {
    expect(canonicalShortcut(a)).not.toBe(canonicalShortcut(b))
  })
})

describe('conflictsFor', () => {
  const shortcuts = defaultShortcuts()
  const conflicts = (id: ShortcutId, binding: string) =>
    conflictsFor(shortcuts, byId(shortcuts, id), binding).map((other) => other.id)

  test('in the same scope', () => {
    expect(conflicts('graph.fitAll', 'Mod+Z')).toEqual(['graph.undo'])
    expect(conflicts('rename', 'Mod+C')).toEqual(['copy'])
  })

  test('with an app-wide shortcut, from either side', () => {
    expect(conflicts('graph.fitAll', 'Mod+,')).toEqual(['settings'])
    expect(conflicts('graph.fitAll', 'Mod+K')).toEqual(['commandPalette.open'])
    expect(conflicts('aboutThisApp', 'Mod+Z')).toEqual(['graph.undo'])
    expect(conflicts('aboutThisApp', 'Mod+C')).toEqual(['copy', 'components.copy'])
  })

  test('none between the drive and the graph', () => {
    expect(conflicts('graph.fitAll', 'Mod+R')).toEqual([])
    expect(conflicts('rename', 'Mod+Z')).toEqual([])
  })

  test('none with the action itself, or with the action it follows', () => {
    expect(conflicts('graph.undo', 'Mod+Z')).toEqual([])
    expect(conflicts('components.deleteSelected', 'Delete')).toEqual([])
  })

  test('a non-rebindable shortcut still holds its key', () => {
    expect(conflicts('graph.fitAll', 'Escape')).toEqual(
      expect.arrayContaining(['graph.deselectAll', 'app.cancel', 'closeModal']),
    )
  })
})

describe('currentConflicts', () => {
  test('reports a key the user gave to a second action, on both actions', () => {
    const dashboard = mapEntries(BINDINGS, (_key, info) => ({ bindings: info.bindings }))
    const graph = mapEntries(GRAPH_BINDINGS, (_key, info) => ({ bindings: info.bindings }))
    const shortcuts = listShortcuts(dashboard, {
      ...graph,
      'graph.fitAll': { bindings: ['Mod+Shift+A', 'Mod+Z'] },
    })
    const conflicts = currentConflicts(shortcuts)
    expect(
      conflicts
        .get('graph.fitAll')
        ?.get('Mod+Z')
        ?.map((other) => other.id),
    ).toEqual(['graph.undo'])
    expect(
      conflicts
        .get('graph.undo')
        ?.get('Mod+Z')
        ?.map((other) => other.id),
    ).toEqual(['graph.fitAll'])
    expect(conflicts.get('graph.fitAll')?.has('Mod+Shift+A')).toBe(false)
  })

  test('a follower has its leader’s current bindings', () => {
    const dashboard = mapEntries(BINDINGS, (_key, info) => ({ bindings: info.bindings }))
    const graph = mapEntries(GRAPH_BINDINGS, (_key, info) => ({ bindings: info.bindings }))
    const shortcuts = listShortcuts(dashboard, {
      ...graph,
      'components.deleteSelected': { bindings: ['X'] },
    })
    expect(byId(shortcuts, 'graph.deleteSelectedEdge').bindings).toEqual(['X'])
  })
})
