/**
 * @file The one registry of the app's keyboard shortcuts (#170): the dashboard's
 * (`$/configurations/inputBindings`), the graph editor's (`$/configurations/graphInputBindings`)
 * and the app shell's fixed ones, each with the scope it is active in, its category and its name.
 * The Keyboard shortcuts settings tab lists them from here, and checks a new shortcut against them
 * for conflicts. The window's bindings, with the user's changes, are `$/providers/inputBindings`.
 *
 * ## Scopes
 *
 * A shortcut is active in one scope. Two shortcuts conflict when they have the same key and their
 * scopes can be active at once ({@link scopesOverlap}):
 *
 * - `app`: anywhere in the window, over the drive, the settings and the graph alike. The user
 *   menu's entries (Settings, About), the dashboard's navigation (Go Back, the settings tabs), the
 *   app shell's Close Tab, Quit and command palette, and the Escape that closes a modal.
 * - `drive`: the drive. These are attached to the assets table's focus scope, so they act only
 *   on a key pressed inside it.
 * - `graph`: the graph editor. Its handler listens only while its project tab is the current
 *   tab (`KeepAlive` deactivates it otherwise).
 *
 * `drive` and `graph` are never active together: a project tab and the drive are never current
 * at once, and focus cannot be inside a hidden tab. So a graph shortcut may share a key with a
 * drive shortcut (both have `Mod+C` for Copy), but not with an `app` one.
 *
 * Not in the registry, and not rebindable: the shortcuts of the focused widgets inside the graph
 * editor (the component browser, CodeMirror's text and documentation editors, the table's grid,
 * lists, visualizations), and the graph's mouse bindings. Those widgets take their keys first
 * while they have the focus, deliberately shadowing the graph's (`Enter` in a list, `Mod+C` in a
 * text editor), so they are no conflict; see `@/bindings` for why each stays fixed.
 */
import {
  dottedActionToTextId,
  GRAPH_BINDING_FOLLOWERS,
  GRAPH_BINDINGS,
  GRAPH_CATEGORIES,
  type GraphBindingKey,
} from '$/configurations/graphInputBindings'
import {
  actionToTextId,
  BINDINGS,
  CATEGORIES,
  type DashboardBindingKey,
} from '$/configurations/inputBindings'
import { isMacLike } from '$/utils/event'
import type { KeybindsWithMetadata } from '$/utils/inputBindings'
import type { Icon } from '@/util/iconMetadata/iconName'
import { parseKeybindString } from '@/util/shortcuts'
import type { TextId } from 'enso-common/src/text'
import { unsafeKeys } from 'enso-common/src/utilities/data/object'

/** Where a shortcut is active. See the file comment. */
export type ShortcutScope = 'app' | 'drive' | 'graph'

/** Whether shortcuts in these two scopes can be active at the same time. */
export function scopesOverlap(a: ShortcutScope, b: ShortcutScope) {
  return a === b || a === 'app' || b === 'app'
}

/**
 * The dashboard actions whose shortcuts work anywhere in the window: attached to `document.body`
 * by the dashboard page (`Dashboard.tsx`), the user menu and the organization switcher
 * (`useMenuEntries` outside a focus scope), the context menu and the assets table's `cancelCut`.
 * Every other dashboard action is the drive's.
 */
const DASHBOARD_APP_ACTIONS: ReadonlySet<DashboardBindingKey> = new Set<DashboardBindingKey>([
  'settings',
  'aboutThisApp',
  'signOut',
  'upgradePlan',
  'downloadApp',
  'toggleEnsoDevtools',
  'switchOrganization',
  'goBack',
  'goForward',
  'goToAccountSettings',
  'goToOrganizationSettings',
  'goToLocalSettings',
  'goToBillingAndPlansSettings',
  'goToMembersSettings',
  'goToUserGroupsSettings',
  'goToKeyboardShortcutsSettings',
  'goToActivityLogSettings',
  'closeModal',
  'cancelCut',
])

/** The scope of a dashboard action's shortcuts. */
export function dashboardActionScope(action: DashboardBindingKey): ShortcutScope {
  return DASHBOARD_APP_ACTIONS.has(action) ? 'app' : 'drive'
}

/**
 * The app shell's shortcuts, defined in `@/bindings` (`appBindings`, `appContainerBindings`,
 * `commandPaletteBindings`) and active everywhere. They are not rebindable: Escape cancels
 * everywhere, `Mod+W` has its alternatives because browsers keep `Mod+W` for themselves, and they
 * belong to the app shell rather than to the dashboard or the graph. They are here so that no
 * other shortcut is given their keys. A test keeps these lists equal to `@/bindings`.
 */
export const APP_SHELL_BINDINGS = {
  'app.cancel': ['Escape'],
  'app.close': ['Mod+Q'],
  'app.closeTab': ['Mod+W', 'Mod+Alt+W', ...(!isMacLike ? ['Mod+F4'] : [])],
  'commandPalette.open': ['Mod+K'],
} as const satisfies Record<string, readonly string[]>

/** The name of one of the app shell's fixed shortcuts. */
export type AppShellBindingKey = keyof typeof APP_SHELL_BINDINGS

/** Which part of the app defines, and dispatches, a shortcut. */
export type ShortcutOwner = 'dashboard' | 'graph' | 'appShell'

/**
 * The id of an action with a shortcut. Dashboard actions are plain names (`copy`); graph and app
 * shell actions are dotted (`components.copy`), so the ids never collide.
 */
export type ShortcutId = DashboardBindingKey | GraphBindingKey | AppShellBindingKey

/** The categories, in the order the settings tab and the command palette show them. */
export const SHORTCUT_CATEGORIES = [...CATEGORIES, ...GRAPH_CATEGORIES] as const

/** A category of shortcuts. */
export type ShortcutCategory = (typeof SHORTCUT_CATEGORIES)[number]

/** The text id of a category's name. */
export function categoryToTextId(category: ShortcutCategory): TextId {
  return `${category}BindingCategory`
}

/** An action with a shortcut, and its current bindings. */
export interface Shortcut {
  readonly id: ShortcutId
  readonly owner: ShortcutOwner
  readonly scope: ShortcutScope
  /** `undefined` for the app shell's, which are not listed. */
  readonly category: ShortcutCategory | undefined
  readonly nameTextId: TextId
  readonly icon: Icon | undefined
  readonly color: string | undefined
  /** Whether the settings tab lists it, and the user may change it. */
  readonly rebindable: boolean
  /** The current bindings: the user's, or the defaults. */
  readonly bindings: readonly string[]
  readonly defaults: readonly string[]
  /** The action whose shortcuts this one follows (`GRAPH_BINDING_FOLLOWERS`). */
  readonly follows: ShortcutId | undefined
}

/** The current bindings of each action of a namespace, as `defineBindingNamespace` keeps them. */
type NamespaceMetadata<K extends string> = Readonly<
  Record<K, Pick<KeybindsWithMetadata<string>, 'bindings'>>
>

/**
 * Every action with a shortcut, in the order of {@link SHORTCUT_CATEGORIES}' namespaces (the
 * dashboard's, the graph editor's, the app shell's), each with its current bindings.
 */
export function listShortcuts(
  dashboard: NamespaceMetadata<DashboardBindingKey>,
  graph: NamespaceMetadata<GraphBindingKey>,
): Shortcut[] {
  const dashboardShortcuts = unsafeKeys(BINDINGS).map((id): Shortcut => {
    const info: KeybindsWithMetadata<string> = BINDINGS[id]
    return {
      id,
      owner: 'dashboard',
      scope: dashboardActionScope(id),
      category: info.category as ShortcutCategory,
      nameTextId: actionToTextId(id),
      icon: info.icon,
      color: info.color,
      rebindable: info.rebindable !== false,
      bindings: dashboard[id].bindings,
      defaults: info.bindings,
      follows: undefined,
    }
  })
  const graphShortcuts = unsafeKeys(GRAPH_BINDINGS).map((id): Shortcut => {
    const info: KeybindsWithMetadata<string> = GRAPH_BINDINGS[id]
    const follows = GRAPH_BINDING_FOLLOWERS[id]
    return {
      id,
      owner: 'graph',
      scope: 'graph',
      category: info.category as ShortcutCategory,
      nameTextId: dottedActionToTextId(id),
      icon: info.icon,
      color: info.color,
      rebindable: info.rebindable !== false && follows == null,
      bindings: graph[follows ?? id].bindings,
      defaults: info.bindings,
      follows,
    }
  })
  const appShellShortcuts = unsafeKeys(APP_SHELL_BINDINGS).map((id): Shortcut => ({
    id,
    owner: 'appShell',
    scope: 'app',
    category: undefined,
    nameTextId: dottedActionToTextId(id),
    icon: undefined,
    color: undefined,
    rebindable: false,
    bindings: APP_SHELL_BINDINGS[id],
    defaults: APP_SHELL_BINDINGS[id],
    follows: undefined,
  }))
  return [...dashboardShortcuts, ...graphShortcuts, ...appShellShortcuts]
}

/** Every action with a shortcut, with its default bindings. */
export function defaultShortcuts(): Shortcut[] {
  return listShortcuts(BINDINGS, GRAPH_BINDINGS)
}

/**
 * A binding in a form that is equal for equal keys: `Mod+Shift+K` and `shift+mod+k` give the same
 * one, as do `OsDelete` and the platform's Delete key.
 */
export function canonicalShortcut(binding: string): string {
  const { bind } = parseKeybindString(binding)
  return `${bind.type}:${bind.modifierFlags}:${bind.key}`
}

/** Whether the two actions are one for conflicts: the same, or one follows the other. */
function isSameAction(a: Shortcut, b: Shortcut) {
  return a.id === b.id || a.follows === b.id || b.follows === a.id
}

/**
 * The other actions that already have `binding` in a scope that overlaps `shortcut`'s: binding it
 * to `shortcut` too would make the key ambiguous. Defaults count, as in the dashboard's check.
 */
export function conflictsFor(
  shortcuts: readonly Shortcut[],
  shortcut: Shortcut,
  binding: string,
): Shortcut[] {
  const key = canonicalShortcut(binding)
  return shortcuts.filter(
    (other) =>
      !isSameAction(other, shortcut) &&
      scopesOverlap(other.scope, shortcut.scope) &&
      other.bindings.some((otherBinding) => canonicalShortcut(otherBinding) === key),
  )
}

/** Whether `binding` is one of `shortcut`'s defaults. */
function isDefault(shortcut: Shortcut, binding: string) {
  const key = canonicalShortcut(binding)
  return shortcut.defaults.some((defaultBinding) => canonicalShortcut(defaultBinding) === key)
}

/**
 * The conflicts among the current bindings, for the settings tab to show: by action, then by
 * binding, the other actions with the same key in an overlapping scope. A key two actions have by
 * default is shared on purpose (Rename and Restore From Trash are both `Mod+R`; each acts only
 * where it applies), so it is reported only once the user has given it to one of them.
 */
export function currentConflicts(
  shortcuts: readonly Shortcut[],
): ReadonlyMap<ShortcutId, ReadonlyMap<string, readonly Shortcut[]>> {
  const result = new Map<ShortcutId, Map<string, Shortcut[]>>()
  for (const shortcut of shortcuts) {
    for (const binding of shortcut.bindings) {
      const others = conflictsFor(shortcuts, shortcut, binding).filter(
        (other) =>
          !isDefault(shortcut, binding) ||
          !other.bindings.some(
            (otherBinding) =>
              canonicalShortcut(otherBinding) === canonicalShortcut(binding) &&
              isDefault(other, otherBinding),
          ),
      )
      if (others.length === 0) continue
      let byBinding = result.get(shortcut.id)
      if (byBinding == null) {
        byBinding = new Map()
        result.set(shortcut.id, byBinding)
      }
      byBinding.set(binding, others)
    }
  }
  return result
}
