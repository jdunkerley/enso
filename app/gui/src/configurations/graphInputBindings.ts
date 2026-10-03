/**
 * @file The graph editor's keyboard shortcuts (the `graph-editor` namespace): their defaults and
 * what the Keyboard shortcuts settings tab shows of them (#170). The window's bindings, with the
 * user's changes, are `$/providers/inputBindings`; the graph editor dispatches them through
 * `graphBindings` (`@/bindings`), which reads that store.
 *
 * The order matters: when a key is bound to several actions, the graph editor offers it to them in
 * this order, and the first whose handler accepts it wins (`components.deleteSelected` before
 * `graph.deleteSelectedEdge`).
 *
 * Only plain key strings here: a rebindable action has no per-binding options (`allowRepeat`), as
 * the settings tab could not show or keep them.
 */
import { isMacLike } from '$/utils/event'
import * as inputBindings from '$/utils/inputBindings'

/** The categories of the graph editor's shortcuts, after the dashboard's in the settings tab. */
export type GraphBindingCategory = (typeof GRAPH_CATEGORIES)[number]

/** The name of a graph editor action with a keyboard shortcut. */
export type GraphBindingKey = keyof typeof GRAPH_BINDINGS

/**
 * The text id of a dotted action name: `graph.toggleCodeEditor` is
 * `graphToggleCodeEditorShortcut`, as a dashboard action's is `<action>Shortcut`.
 */
export type DottedActionTextId<K extends string> =
  K extends `${infer Prefix}.${infer Rest}` ? `${Prefix}${Capitalize<Rest>}Shortcut` : never

/** The text id of the name of a graph editor (or app shell) action, from its dotted name. */
export function dottedActionToTextId<K extends string>(action: K): DottedActionTextId<K> {
  const dot = action.indexOf('.')
  const prefix = action.slice(0, dot)
  const rest = action.slice(dot + 1)
  // This is SAFE: it is the computation `DottedActionTextId` describes.
  return `${prefix}${rest.charAt(0).toUpperCase()}${rest.slice(1)}Shortcut` as DottedActionTextId<K>
}

/**
 * Graph actions that follow another action's shortcuts instead of having their own. "Delete" deletes
 * the selection, whichever kind it is: the selected components or, when there are none, the
 * selected connection. The follower is not listed in the settings tab, and never conflicts with the
 * action it follows.
 */
export const GRAPH_BINDING_FOLLOWERS: Readonly<Partial<Record<GraphBindingKey, GraphBindingKey>>> =
  {
    'graph.deleteSelectedEdge': 'components.deleteSelected',
  }

const GRAPH_BINDINGS_AND_CATEGORIES = inputBindings.defineBindings(
  ['graphEditor', 'graphComponents'],
  {
    'graph.toggleCodeEditor': {
      bindings: ['Mod+`'],
      icon: 'bottom_panel',
      category: 'graphEditor',
    },
    'graph.toggleDocumentationEditor': {
      bindings: ['Mod+D'],
      icon: 'right_panel',
      category: 'graphEditor',
    },
    'graph.undo': { bindings: ['Mod+Z'], icon: 'undo', category: 'graphEditor' },
    'graph.redo': {
      // On Mac, `Mod+Shift+Z` takes priority and will be displayed in the tooltip.
      bindings: isMacLike ? ['Mod+Shift+Z', 'Mod+Y'] : ['Mod+Y', 'Mod+Shift+Z'],
      icon: 'redo',
      category: 'graphEditor',
    },
    'graph.openComponentBrowser': { bindings: ['Enter'], icon: 'add', category: 'graphEditor' },
    'graph.toggleVisualization': { bindings: ['Space'], icon: 'eye', category: 'graphComponents' },
    'components.deleteSelected': {
      bindings: ['Delete', 'Backspace'],
      icon: 'trash',
      category: 'graphComponents',
    },
    'graph.fitAll': { bindings: ['Mod+Shift+A'], icon: 'show_all', category: 'graphEditor' },
    'graph.selectAll': { bindings: ['Mod+A'], category: 'graphEditor' },
    // Not rebindable: Escape cancels, everywhere. Here it ends the current interaction (clears the
    // selection and the focus), and it must stay the one key that does.
    'graph.deselectAll': { bindings: ['Escape'], rebindable: false, category: 'graphEditor' },
    'components.copy': { bindings: ['Mod+C'], icon: 'copy', category: 'graphComponents' },
    'graph.pasteNode': { bindings: ['Mod+V'], icon: 'paste', category: 'graphComponents' },
    'components.collapse': { bindings: ['Mod+G'], icon: 'group', category: 'graphComponents' },
    'graph.startProfiling': { bindings: ['Mod+Alt+,'], category: 'graphEditor' },
    'graph.stopProfiling': { bindings: ['Mod+Alt+.'], category: 'graphEditor' },
    'component.enterNode': { bindings: ['Mod+E'], icon: 'open', category: 'graphComponents' },
    'graph.navigateUp': {
      bindings: ['Mod+Shift+E'],
      icon: 'navigate_up',
      category: 'graphEditor',
    },
    'components.pickColorMulti': {
      bindings: ['Mod+Shift+C'],
      icon: 'paint_palette',
      category: 'graphComponents',
    },
    'components.tidyUp': {
      bindings: ['Mod+Shift+L'],
      icon: 'tidy_up',
      category: 'graphComponents',
    },
    'graph.openDocumentation': { bindings: ['F1'], icon: 'help', category: 'graphEditor' },
    // Not rebindable on its own: it follows `components.deleteSelected` (`GRAPH_BINDING_FOLLOWERS`).
    'graph.deleteSelectedEdge': {
      bindings: ['Delete', 'Backspace'],
      rebindable: false,
      icon: 'trash',
      category: 'graphComponents',
    },
  },
)

export const GRAPH_BINDINGS = GRAPH_BINDINGS_AND_CATEGORIES.bindings
export const GRAPH_CATEGORIES = GRAPH_BINDINGS_AND_CATEGORIES.categories

/** Create the graph editor's bindings, for the window's store (`$/providers/inputBindings`). */
export function createGraphBindings() {
  return inputBindings.defineBindingNamespace('graph-editor', GRAPH_BINDINGS, GRAPH_CATEGORIES)
}

/** The graph editor's bindings, as {@link createGraphBindings} creates them. */
export type GraphBindingNamespace = ReturnType<typeof createGraphBindings>
