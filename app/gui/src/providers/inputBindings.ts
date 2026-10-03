/**
 * @file The window's keyboard and mouse bindings, with the user's changes (#170): one store for the
 * dashboard's (`$/configurations/inputBindings`) and the graph editor's
 * (`$/configurations/graphInputBindings`). The React dashboard reads the dashboard's through
 * `InputBindingsProvider`, Vue menus through `$/providers/dashboardInputBindings`, the graph editor
 * through `graphBindings` (`@/bindings`), and the Keyboard shortcuts settings tab edits both. A
 * change applies at once everywhere, and is saved.
 *
 * ## Saved format
 *
 * The user's bindings are saved in `localStorage` under `inputBindings`: a record from action to
 * its list of bindings. Version 1 (#86 and before) holds every dashboard action. Version 2 (#170)
 * extends it, so that a version 1 reader still reads it unchanged:
 *
 * ```json
 * { "$version": ["2"], "copy": ["Mod+C"], "...": [], "graph.undo": ["Mod+U"] }
 * ```
 *
 * - `$version` marks the format. It is a list, like every other value, because a version 1 reader
 *   validates the whole record as lists of strings and would drop all of it otherwise.
 * - Every dashboard action is still saved, as in version 1, so that going back to a version 1
 *   build keeps the user's dashboard bindings.
 * - A graph action is saved only when the user has changed it. Graph actions are dotted
 *   (`graph.undo`), dashboard actions are not, so the two never collide; a version 1 reader ignores
 *   the graph's, as it ignores any action it does not know.
 *
 * Loading takes any version: each action found replaces that action's defaults, and an action
 * missing from the record keeps its defaults (version 1 left it with none; only an action added
 * in a later release can be missing).
 */
import {
  createGraphBindings,
  GRAPH_BINDING_FOLLOWERS,
  GRAPH_BINDINGS,
  type GraphBindingKey,
  type GraphBindingNamespace,
} from '$/configurations/graphInputBindings'
import {
  createBindings,
  type DashboardBindingKey,
  type DashboardBindingNamespace,
} from '$/configurations/inputBindings'
import {
  conflictsFor,
  currentConflicts,
  listShortcuts,
  type Shortcut,
  type ShortcutId,
} from '$/configurations/keyboardShortcuts'
import LocalStorage from '$/utils/LocalStorage'
import { unsafeKeys } from 'enso-common/src/utilities/data/object'
import { computed, shallowRef } from 'vue'
import { z } from 'zod'

declare module '$/utils/LocalStorage' {
  /** */
  interface LocalStorageData {
    /**
     * The user's bindings, by action: every dashboard action, the graph actions the user changed,
     * and the format's version (see `$/providers/inputBindings`).
     */
    readonly inputBindings: Readonly<Record<string, readonly string[]>>
  }
}

LocalStorage.registerKey('inputBindings', {
  schema: z.record(z.string().array().readonly()).transform((value) =>
    Object.fromEntries(
      Object.entries<unknown>({ ...value }).flatMap((kv) => {
        const [k, v] = kv
        return Array.isArray(v) && v.every((item): item is string => typeof item === 'string') ?
            [[k, v]]
          : []
      }),
    ),
  ),
})

/** The key of the saved format's version, in the saved record. */
export const FORMAT_VERSION_KEY = '$version'
/** The saved format's current version. */
export const FORMAT_VERSION = 2

/** What the store needs of `LocalStorage`. */
export type InputBindingsStorage = Pick<LocalStorage, 'get' | 'set'>

/** Whether two lists of bindings are the same. */
function sameBindings(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((binding, i) => binding === b[i])
}

/** Replace an action's bindings in a namespace, without saving. */
function replaceBindings<K extends string>(
  namespace: {
    readonly metadata: Readonly<Record<K, { readonly bindings: readonly string[] }>>
    readonly add: (key: K, binding: string) => void
    readonly delete: (key: K, binding: string) => void
  },
  key: K,
  bindings: readonly string[],
) {
  for (const oldBinding of namespace.metadata[key].bindings) namespace.delete(key, oldBinding)
  for (const newBinding of bindings) namespace.add(key, newBinding)
}

/**
 * The window's bindings, with the user's changes loaded from `storage` and saved there on every
 * change. `metadata`, `shortcuts` and `conflicts` are reactive in Vue.
 */
export function createInputBindingsStore(
  storage: InputBindingsStorage = LocalStorage.getInstance(),
) {
  const dashboardNamespace = createBindings()
  const graphNamespace = createGraphBindings()
  const revision = shallowRef(0)

  const saved = storage.get('inputBindings')
  if (saved != null) {
    for (const key of unsafeKeys(dashboardNamespace.metadata)) {
      const bindings = saved[key]
      if (bindings != null) replaceBindings(dashboardNamespace, key, bindings)
    }
    for (const key of unsafeKeys(graphNamespace.metadata)) {
      const bindings = saved[key]
      if (bindings != null && isGraphActionRebindable(key)) {
        replaceBindings(graphNamespace, key, bindings)
      }
    }
  }

  const save = () => {
    const record: Record<string, readonly string[]> = {
      [FORMAT_VERSION_KEY]: [String(FORMAT_VERSION)],
    }
    for (const [key, info] of Object.entries(dashboardNamespace.metadata)) {
      record[key] = info.bindings
    }
    for (const key of unsafeKeys(graphNamespace.metadata)) {
      const bindings = graphNamespace.metadata[key].bindings
      if (!sameBindings(bindings, GRAPH_BINDINGS[key].bindings)) record[key] = bindings
    }
    storage.set('inputBindings', record)
    revision.value += 1
  }

  /** A namespace whose changes are saved, and whose `metadata` Vue tracks. */
  function editable<
    K extends string,
    Namespace extends {
      readonly metadata: Readonly<Record<K, { readonly bindings: readonly string[] }>>
      readonly add: (key: K, binding: string) => void
      readonly delete: (key: K, binding: string) => void
      readonly reset: (key: K) => void
    },
  >(namespace: Namespace) {
    return {
      ...namespace,
      reset: (key: K) => {
        namespace.reset(key)
        save()
      },
      add: (key: K, binding: string) => {
        if (namespace.metadata[key].bindings.includes(binding)) return
        namespace.add(key, binding)
        save()
      },
      delete: (key: K, binding: string) => {
        // `defineBindingNamespace`'s `delete` would remove the last binding of one it lacks.
        if (!namespace.metadata[key].bindings.includes(binding)) return
        namespace.delete(key, binding)
        save()
      },
      /** A counter of the changes, for the React provider to re-render its consumers. */
      get revision() {
        return revision.value
      },
      get metadata(): Namespace['metadata'] {
        // Read for Vue's dependency tracking: `metadata` is a new object after every change.
        void revision.value
        return namespace.metadata
      },
    }
  }

  const dashboard = editable<DashboardBindingKey, DashboardBindingNamespace>(dashboardNamespace)
  const graph = editable<GraphBindingKey, GraphBindingNamespace>(graphNamespace)

  const shortcuts = computed(() => listShortcuts(dashboard.metadata, graph.metadata))
  const conflicts = computed(() => currentConflicts(shortcuts.value))

  const shortcutById = (id: ShortcutId): Shortcut | undefined =>
    shortcuts.value.find((shortcut) => shortcut.id === id)

  /** Apply `change` to the action's namespace, if the user may change the action. */
  function onAction(
    id: ShortcutId,
    change: {
      dashboard: (key: DashboardBindingKey) => void
      graph: (key: GraphBindingKey) => void
    },
  ) {
    const shortcut = shortcutById(id)
    if (shortcut == null || !shortcut.rebindable) return
    if (shortcut.owner === 'dashboard') change.dashboard(id as DashboardBindingKey)
    else if (shortcut.owner === 'graph') change.graph(id as GraphBindingKey)
  }

  return {
    /** The dashboard's bindings, as the React provider and Vue menus use them. */
    dashboard,
    /** The graph editor's bindings, which `graphBindings` (`@/bindings`) dispatches. */
    graph,
    /** Every action with a shortcut, with its current bindings (`$/configurations/keyboardShortcuts`). */
    get shortcuts(): readonly Shortcut[] {
      return shortcuts.value
    },
    /** The conflicts among the current bindings, by action and binding. */
    get conflicts() {
      return conflicts.value
    },
    /** The actions `binding` would conflict with, if added to `id`. */
    conflictsFor(id: ShortcutId, binding: string): readonly Shortcut[] {
      const shortcut = shortcutById(id)
      return shortcut == null ? [] : conflictsFor(shortcuts.value, shortcut, binding)
    },
    /** Add a binding to an action, and save. */
    add(id: ShortcutId, binding: string) {
      onAction(id, {
        dashboard: (key) => dashboard.add(key, binding),
        graph: (key) => graph.add(key, binding),
      })
    },
    /** Remove a binding from an action, and save. */
    delete(id: ShortcutId, binding: string) {
      onAction(id, {
        dashboard: (key) => dashboard.delete(key, binding),
        graph: (key) => graph.delete(key, binding),
      })
    },
    /** Restore an action's default bindings, and save. */
    reset(id: ShortcutId) {
      onAction(id, { dashboard: dashboard.reset, graph: graph.reset })
    },
    /** Restore every action's default bindings, and save once. */
    resetAll() {
      for (const key of unsafeKeys(dashboardNamespace.metadata)) dashboardNamespace.reset(key)
      for (const key of unsafeKeys(graphNamespace.metadata)) graphNamespace.reset(key)
      save()
    },
  }
}

/** Whether the user may change a graph action's bindings (a follower follows another's). */
function isGraphActionRebindable(key: GraphBindingKey) {
  return GRAPH_BINDINGS[key].rebindable !== false && GRAPH_BINDING_FOLLOWERS[key] == null
}

/** The window's bindings. */
export type InputBindingsStore = ReturnType<typeof createInputBindingsStore>

let instance: InputBindingsStore | undefined

/** The window's bindings, created (and the user's changes loaded) on first use. */
export function getInputBindingsStore(): InputBindingsStore {
  instance ??= createInputBindingsStore()
  return instance
}
