/**
 * @file The project view's keyboard and mouse shortcuts, by namespace.
 *
 * Only the graph editor's (`graphBindings`) can be changed by the user, in the Keyboard shortcuts
 * settings tab (#170): they are defined in `$/configurations/graphInputBindings`, and the window's
 * store (`$/providers/inputBindings`) holds them with the user's changes. Every other namespace
 * here is fixed, for the reason noted above it. `app`, `app-container` and `command-palette` are
 * still in the shortcut registry (`APP_SHELL_BINDINGS` in `$/configurations/keyboardShortcuts`),
 * so that no rebindable shortcut takes their keys; the rest belong to focused widgets, which take
 * their keys before the graph does (see that file's comment on scopes).
 */
import { GRAPH_BINDING_FOLLOWERS, type GraphBindingKey } from '$/configurations/graphInputBindings'
import { getInputBindingsStore } from '$/providers/inputBindings'
import { isMacLike } from '@/composables/events'
import { defineKeybinds, defineRebindableKeybinds } from '@/util/shortcuts'
import { mapEntries } from 'enso-common/src/utilities/data/object'

// Some debug shortcuts are also defined in electron
// (Look for `registerShortcuts` method).

// Fixed: Escape cancels everywhere, and `Mod+Q` quits as on every desktop app.
export const appBindings = defineKeybinds('app', {
  'app.cancel': ['Escape'],
  'app.close': ['Mod+Q'],
})

// Fixed: the app shell's, not the graph's; `Mod+W` has alternatives because browsers keep it.
export const appContainerBindings = defineKeybinds('app-container', {
  'app.closeTab':
    // An alternative shortcut is required because Mod+W cannot be overridden in browsers.
    ['Mod+W', 'Mod+Alt+W', ...(!isMacLike ? ['Mod+F4' as const] : [])],
})

// Fixed: text editing inside CodeMirror (the documentation editor). These follow the conventions
// of text editors, and CodeMirror takes them while it has the focus.
export const documentationEditorFormatBindings = defineKeybinds('documentation-editor-formatting', {
  'documentationEditor.italic': ['Mod+I'],
  'documentationEditor.bold': ['Mod+B'],
  'documentationEditor.link': ['Mod+K'],
  'documentationEditor.paragraph': ['Mod+Alt+0'],
  'documentationEditor.header1': ['Mod+Alt+1'],
  'documentationEditor.header2': ['Mod+Alt+2'],
  'documentationEditor.header3': ['Mod+Alt+3'],
})

// Fixed: text editing inside CodeMirror (moving, deleting, the clipboard).
export const textEditorsCommonBindings = defineKeybinds('text-editors-common-bindings', {
  'textEditor.moveLeft': [{ key: 'ArrowLeft', allowRepeat: true }],
  'textEditor.moveRight': [{ key: 'ArrowRight', allowRepeat: true }],
  'textEditor.deleteBack': [{ key: 'Backspace', allowRepeat: true }],
  'textEditor.deleteForward': [{ key: 'Delete', allowRepeat: true }],
  'textEditor.cut': ['Mod+X'],
  'textEditor.copy': ['Mod+C'],
  'textEditor.paste': ['Mod+V'],
  'textEditor.pasteRaw': ['Mod+Shift+V'],
})

// Fixed: a new line inside a multi-line CodeMirror editor.
export const textEditorsMultilineBindings = defineKeybinds('text-editors-multiline-bindings', {
  'textEditor.newline': ['Alt+Enter'],
})

// Fixed: moving through and picking from a list, which the arrow keys and Enter do everywhere.
export const listBindings = defineKeybinds('list', {
  'list.moveUp': [{ key: 'ArrowUp', allowRepeat: true }],
  'list.moveDown': [{ key: 'ArrowDown', allowRepeat: true }],
  'list.accept': ['Enter'],
})

// Fixed: typing into the component browser. Its keys accept or edit what was typed, and must not
// be taken away from typing.
export const componentBrowserBindings = defineKeybinds('component-browser', {
  'componentBrowser.editSuggestion': ['Shift+Enter'],
  'componentBrowser.acceptSuggestion': ['Enter'],
  'componentBrowser.acceptInputAsCode': ['Enter'],
  'componentBrowser.switchToCodeEditMode': ['Mod+Tab'],
  'componentBrowser.acceptInput': ['Mod+Enter'],
  'componentBrowser.acceptAIPrompt': ['Enter'],
  'componentBrowser.switchPanelFocus': ['Tab'],
})

/**
 * The graph editor's shortcuts: rebindable (#170). Defined in `$/configurations/graphInputBindings`;
 * they follow the window's store (`$/providers/inputBindings`), so a change in the settings applies
 * at once. An action in `GRAPH_BINDING_FOLLOWERS` has the bindings of the action it follows.
 */
export const graphBindings = defineRebindableKeybinds<GraphBindingKey>('graph-editor', () => {
  const metadata = getInputBindingsStore().graph.metadata
  return followersFollowing(metadata)
})

/** The followers' bindings replaced by those of the actions they follow, cached per `metadata`. */
const followed = new WeakMap<object, Record<GraphBindingKey, { bindings: readonly string[] }>>()
function followersFollowing(
  metadata: Readonly<Record<GraphBindingKey, { readonly bindings: readonly string[] }>>,
) {
  let result = followed.get(metadata)
  if (result == null) {
    result = mapEntries(metadata, (key, info) => {
      const leader = GRAPH_BINDING_FOLLOWERS[key]
      return { bindings: leader != null ? metadata[leader].bindings : info.bindings }
    })
    followed.set(metadata, result)
  }
  return result
}

// Fixed: a visualization's own keys, while it has the focus.
export const visualizationBindings = defineKeybinds('visualization', {
  'visualization.nextType': ['Mod+Space'],
  'panel.fullscreen': ['Shift+Space'],
  'visualization.exitFullscreen': ['Escape'],
})

// Fixed: the table's clipboard, which follows the conventions of spreadsheets.
export const gridBindings = defineKeybinds('grid', {
  'grid.cutCells': ['Mod+X'],
  'grid.copyCells': ['Mod+C'],
  'grid.pasteCells': ['Mod+V'],
})

// Fixed: the app shell's, active everywhere, not only in the graph editor.
export const commandPaletteBindings = defineKeybinds('command-palette', {
  'commandPalette.open': ['Mod+K'],
})

// === Mouse bindings ===
// Fixed: the settings tab captures keys only, and these follow platform conventions for clicks.

export const textEditorsBindings = defineKeybinds('text-editors', {
  openLink: ['Mod+PointerMain'],
})

export const selectionMouseBindings = defineKeybinds('selection', {
  replace: ['PointerMain'],
  add: ['Mod+Shift+PointerMain'],
  remove: ['Shift+Alt+PointerMain'],
  toggle: ['Shift+PointerMain'],
  invert: ['Mod+Shift+Alt+PointerMain'],
})

export const nodeEditBindings = defineKeybinds('node-edit', {
  edit: ['Mod+PointerMain'],
})
