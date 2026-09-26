# Node Appearance Cache — Design

**Date:** 2026-09-26 **Status:** Draft, for review

## Motivation

When a workflow is first opened, every component node renders in a flat
slate-grey (`--node-color-no-type`, `#596b81`) with the default `enso_logo` icon
until the engine has executed it and the IDE has loaded the library groups. On a
large project that can take a while, and the graph gives no hint of what each
node is. The IDE already knows each node's colour and icon from the last
session; it just doesn't keep them.

**Goal:** remember each node's last computed colour and icon in the node's IDE
metadata in the `.enso` file, and while the node has not yet been recomputed,
render it with the remembered colour — faded by the existing pending style — and
the remembered icon, instead of grey and the default icon.

**Decisions already taken (with the maintainer, 2026-09-26):**

- The cache is written **whenever a node's computed colour or icon changes**
  (after it has been computed), not only alongside other edits. Opening an
  existing project once adds the new field to its metadata line — a one-off diff
  — and afterwards the file changes only when a node's appearance really
  changes.
- The cached state **reuses the existing `.pending` fade** (60% colour + 40%
  grey on background and outgoing edges) and shows the cached icon normally. No
  new CSS.
- The cache lives in **new node metadata fields** (option "A"), not in widget
  metadata or a separate top-level map.

**Explicit non-goals:**

- Caching anything other than colour and icon (types, values, visualizations).
- Changing how colours or icons are computed once real data arrives.
- Input/output nodes: their colour and icon are fixed; they are never cached.
- Nodes with a user colour override: the override is already persisted and
  always wins, so no colour is cached for them (an icon still is).
- Any engine, language-server or parser change. The engine reads only the id-map
  line of the metadata section (`lib/rust/parser/src/metadata.rs`), so none is
  needed.

## Background (how it works today)

- **File format.** `app/ydoc-shared/src/ensoFile.ts`: the `#### METADATA ####`
  section holds the id map, then the IDE metadata JSON. The IDE metadata schema
  is `app/ydoc-server/src/fileFormat.ts` (zod, `.passthrough()`); per node:
  `position`, `visualization`, `colorOverride`, `displayMode`.
- **Hand-listed fields.** Node metadata is copied field by field in:
  `fileFormat.ts` (schema), `ydoc-shared/src/ast/tree.ts` (`NodeMetadataFields`,
  `nodeMetadataKeys`, `setNodeMetadata` drops unknown keys),
  `ydoc-server/src/edits.ts` (`applyDocumentUpdates` rebuilds each node's
  metadata from four fields), `ydoc-server/src/languageServerSession.ts`
  (`syncFileContents` copies each field into Yjs),
  `gui/src/providers/openedProjects/graph/graphDatabase.ts` (initial read,
  `updateMetadata`, `NodeDataFromMetadata`, `mockNode`), and `aiNode.ts` (copies
  fields when rewriting a node). Copy/paste is generic (`serializeMetadata` /
  `setNodeMetadata`).
- **Colour.** `graphDatabase.ts` `nodeColor`: `colorOverride` →
  `computeNodeColor` (`composables/nodeColors.ts`): input/output fixed → library
  group colour (`var(--group-color-…)`) → `colorFromString(type)` →
  `'var(--node-color-no-type)'`. Group colours exist only after
  `projectStore.firstExecution` resolves (`suggestionDatabase/index.ts`
  `loadGroups`).
- **Pending fade.** `composables/componentColors.ts`: `pending` is true while
  the expression payload is `Unknown` or `Pending`; `GraphNode.vue` adds the
  `.pending` class; `assets/base.css` (`.define-node-colors`) mixes the node
  colour 60/40 with grey. With no known colour, the mix is of grey with grey.
- **Icon.** `util/getIconName.ts`: `displayedIconOf` → suggestion entry icon →
  type icon → `DEFAULT_ICON` (`'enso_logo'`); `useDisplayedIcon` swaps in
  `'$evaluating'` while evaluating. Two render paths: `ComponentWidgetTree.vue`
  (`iconOfNode`) and `widgets/WidgetSelfAccessChain.vue` (`displayedIconOf`).
- **Derived writes.** Auto-layout (`graph.ts`) writes positions in
  `module.batchEdits(…, 'local:autoLayout')`; that origin is not in
  `localUserActionOrigins` (`ydoc-shared/src/yjsModel.ts`), so the undo manager
  ignores it.

## Design

### 1. Data model

A new optional field on each node's IDE metadata:

```ts
cachedAppearance?: {
  color?: string // resolved CSS colour, e.g. "oklch(0.62 0.12 250)" or "#4a7fb0"
  icon?: string // an IconName from icons.svg
}
```

- **On disk** (`fileFormat.ts`): `cachedAppearance` is
  `z.object({ color: z.string().max(64).optional(), icon: z.string().max(64).optional() }).optional().catch(() => undefined)`.
  The `.catch` is per field, so a malformed cache on one node drops only that
  node's cache — it must not fail the node record, which would reset all IDE
  metadata to defaults.
- **In Yjs** (`tree.ts`): add `cachedAppearance` to `NodeMetadataFields` and
  `nodeMetadataKeys`, stored as a plain value (like `visualization`).
- **Save path** (`edits.ts`): include `cachedAppearance` in the rebuilt node
  entry when present; omit the key when absent so files without a cache are
  byte-identical to today. (Existing constraint kept: only nodes with a
  `position` get an entry.)
- **Load path** (`languageServerSession.ts` `syncFileContents`): copy the field
  into Yjs like `colorOverride`, comparing before `set`.
- **GUI** (`graphDatabase.ts`): carry the field through the initial read,
  `updateMetadata`, `NodeDataFromMetadata` and `mockNode`; `aiNode.ts` copies it
  like the other fields.

Only the **resolved** colour is stored, never a `var(--…)` reference: group
colour variables are undefined until the first execution completes, which is
exactly when the cache is needed.

### 2. Validation on use (GUI)

The server-side schema is deliberately loose (strings, bounded length). The GUI
validates before use and ignores an invalid value for that node only:

- `color`: must parse with `culori` (already used by `util/colors.ts`). This
  also rejects anything that is not a single colour value (e.g.
  `red; background: url(…)`), and unlike `CSS.supports` it behaves the same in
  unit tests as in the browser.
- `icon`: must satisfy `isIconName` and must not be `'$evaluating'`.

### 3. Reading: fallbacks

- **Colour.** In `graphDatabase.ts` `nodeColor`, the order becomes: user
  `colorOverride` → input/output fixed → group colour → type colour → **cached
  colour** → `'var(--node-color-no-type)'`. Implemented by giving
  `computeNodeColor` an optional fallback argument used in place of the final
  no-type colour. Because the node is `pending` until its value arrives, the
  existing `.pending` rule fades the cached colour automatically; edges
  (`GraphEdge.vue`) and output ports read `getNodeColorStyle` and follow.
- **Icon.** `displayedIconOf` gains an optional fallback used in place of
  `DEFAULT_ICON`; `iconOfNode` and `WidgetSelfAccessChain.vue` pass the node's
  cached icon. The evaluating spinner still takes precedence while evaluating.

Once real data arrives, the computed colour/icon win by the existing precedence,
so a stale cache is visible only until the node is recomputed.

**While a node's suggestion entry is pending, the cache also outranks the
type.** Expression updates (with `typeInfo` and `methodCall`) arrive with the
first execution, but suggestion entries arrive later, in two stages:

1. The suggestion database snapshot is only fetched after the first execution
   completes (and after the groups); `suggestionDb.loaded` then becomes true.
2. Even then, a library's suggestions may still be missing: the engine
   deserializes them in a background job (`DeserializeLibrarySuggestionsJob`,
   started from `InvalidateModulesIndexCommand`), and sends them afterwards as
   `suggestionsDatabaseUpdate` notifications, which the GUI applies as they
   come.

In that window a computed node has a type, and often a `methodCall`, but no
suggestion entry, so neither its group colour nor its entry icon can be known
yet; the type colour, and the type-derived icon (usually `DEFAULT_ICON`), are
only provisional. Showing them made nodes flash from the cached appearance to
the type colour and Enso logo, and back once the entry arrived.

So `GraphDb.isNodeSuggestionPending(id)` defines the node's entry as **pending**
when `suggestionDb.loaded` is false, or when the node's expression info has a
`methodCall` whose entry `getNodeMainSuggestion` cannot find. It is reactive: it
reads the expression info and the suggestion database, so it turns false as soon
as the entry arrives. While it is true:

- **Colour:** override → fixed → group → **cached** → type → cached → no-type
  grey. The source is reported as `'cached'`, so the writer skips it.
- **Icon:** with no suggestion entry, the cached icon (when there is one) is
  preferred to the type-derived icon, on both render paths (`iconOfNode` and
  `WidgetSelfAccessChain`), via `displayedIconOf`'s `preferFallbackOverType`
  option.
- **Writing:** nothing is written for the node, even without a cache (see §4):
  otherwise a node would first be cached with its type colour, then rewritten
  with its group colour moments later, on every open.

`GraphDb` learns the `loaded` flag the same way it learns `groups`: the graph
store passes `toRef(suggestionDb, 'loaded')` to its constructor (`GraphDb.Mock`
defaults it to loaded). A node without a `methodCall` is never pending once
`loaded` is true, so the precedence above the bold paragraph applies to it
unchanged, as it does to any node whose entry is known.

Accepted consequences:

- The cached appearance is never cleared on edit, only overwritten by the writer
  once the entry is no longer pending. So a node edited before then keeps its
  old cached colour and icon until then. `loaded` only becomes true after a
  _completed_ first execution. In a session where that never happens (e.g. only
  `executionFailed` arrives), the node stays that way for the whole session.
  That is harmless: group and entry data are unknowable then anyway, and nothing
  is written.
- If a method's entry never arrives (for example, the method has no suggestion
  at all), the node keeps its cached appearance for the whole session, and
  nothing is written for it. Without a cache, it shows the type-derived colour
  and icon as before.
- **Accepted known limitation: private methods, conversions and modules.** The
  engine emits no suggestions for these (`SuggestionBuilder.scala` filters out
  `isPrivate` methods, conversions and modules), so a node calling one of them
  is pending forever — `isNodeSuggestionPending` never turns false for it.
  Consequence 1: such a node is never cached (§4 condition 5), so every time the
  project is opened it shows no-type grey, then its type colour, and never a
  group colour. Consequence 2: because nothing is written for a pending node,
  the cache is never cleared on edit either. A node edited from a public call
  (with a cache already written) to a private helper keeps that old cached
  colour and icon permanently, across reopens, even though it now renders from
  its type. A possible future mitigation, not implemented here: clear the node's
  `cachedAppearance` when its call changes, or key the cache to the method
  pointer so a different call cannot inherit it.

### 4. Writing: when and how

A GUI composable, `useNodeAppearanceCache` (mounted once by the graph editor,
where CSS variables can be resolved with `getCssValue`), watches component nodes
and writes `cachedAppearance` when **all** of these hold:

1. The project's first execution has completed and library groups are loaded
   (otherwise a group-coloured node would first be written with its type colour
   and then rewritten — churn).
2. The node is not `pending` (its payload is a `Value`, `DataflowError` or
   `Panic`), and has expression info.
3. Its colour came from a group or a type — never from the cached fallback or
   the no-type grey (that would just echo the cache back).
4. The resolved colour or the icon differs from what is stored.
5. The node's suggestion entry is not pending
   (`GraphDb.isNodeSuggestionPending`, §3): a library's entries can arrive well
   after the first execution, so condition 1 alone does not rule out the same
   churn.

Rules:

- No colour is cached for nodes with a `colorOverride`; if one is stored it is
  left alone (the override wins on display).
- An icon equal to `DEFAULT_ICON` is stored as absent (equivalent on display).
- Writes are coalesced: changes seen in one update tick are applied in a single
  `module.batchEdits(…, 'local:derivedMetadata')`.
- `'local:derivedMetadata'` is a new `Origin`, handled like `'local:autoLayout'`
  in `yjsModel.ts`: **not** in `localUserActionOrigins`, so cache writes never
  appear on the undo stack.
- Collaborators: writes sync to other clients like any metadata. Two clients
  computing the same appearance converge, because each writes only on a
  difference.

### 5. Compatibility

- Files without the field load exactly as today (`undefined` → current
  behaviour) and are not changed until a node is computed.
- Older IDE versions drop the field on their next save (their `edits.ts` lists
  fields explicitly). Harmless: it is a cache and is rewritten on the next
  computation by a new IDE.
- The Rust parser, the JNI bindings and the engine ignore the IDE metadata.
- The ydoc-server runs inside the project's engine, so a project pinned to an
  older engine keeps the cache only in the session's Yjs document and never
  persists it. Harmless: nothing is written to the file, so there is no churn.

## Testing

**Unit (vitest):**

- `fileFormat.ts` / save path: round-trip a node with and without
  `cachedAppearance`; a file without the field is byte-identical after a
  round-trip; a malformed `cachedAppearance` on one node drops only that node's
  cache and keeps every other node's metadata. (There are no metadata round-trip
  tests today; these fill that gap.)
- `tree.ts`: `setNodeMetadata` / `serializeMetadata` keep `cachedAppearance`;
  copy/paste carries it.
- `computeNodeColor`: precedence including the new fallback (none of this is
  tested today).
- `displayedIconOf` / `iconOfNode`: cached icon used only when nothing better is
  known, or while the suggestion entry is pending; `'$evaluating'` and non-icon
  names rejected.
- `GraphDb.isNodeSuggestionPending`: pending before `loaded`, and for a node
  whose `methodCall` has no entry yet; the colour is the cached one then, and
  the group or type colour once the entry is added.
- `useNodeAppearanceCache`: writes once conditions are met; no write while
  pending, before groups load, while the suggestion entry is pending, when
  unchanged, or for input/output nodes; no colour for overridden nodes; writes
  use `'local:derivedMetadata'` and do not create undo entries.

**Integration (Playwright, `app/gui/integration-test/project-view/`):** open the
mock project (`integration-test/mock/project/src/Main.enso`) whose metadata
contains a `cachedAppearance` for a node, **before** mocking its expression
update, and assert the node has the `pending` class and `--node-group-color`
equal to the cached colour, and that its icon is the cached one; then mock the
update and assert the computed colour/icon replace it. Playwright does not run
on native Windows — run it in WSL (`CLAUDE.md`, "Verify on Linux").

## Files expected to change

`app/ydoc-server/src/fileFormat.ts`, `app/ydoc-server/src/edits.ts`,
`app/ydoc-server/src/languageServerSession.ts`,
`app/ydoc-shared/src/ast/tree.ts`, `app/ydoc-shared/src/yjsModel.ts`,
`app/gui/src/providers/openedProjects/graph/graphDatabase.ts`,
`app/gui/src/project-view/composables/nodeColors.ts`,
`app/gui/src/project-view/util/getIconName.ts`,
`app/gui/src/project-view/components/ComponentWidgetTree.vue`,
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelfAccessChain.vue`,
`app/gui/src/project-view/components/GraphEditor/aiNode.ts`, a new
`composables/nodeAppearanceCache.ts` mounted from the graph editor, their tests,
the mock project (`app/gui/integration-test/mock/project/src/Main.enso`), and
`CHANGELOG.md` (`#### Enso IDE`).

## Risks and open points

- **Group colours can change between sessions** (e.g. a library update). The
  cached colour is then wrong only until the node is recomputed, and is
  rewritten then. Acceptable for a cache.
- **Theme dependence.** A resolved colour is theme-specific. The IDE has a
  single theme today; if themes are added, the cache should store the colour's
  source (group/type) instead. Recorded, not solved.
- **Write volume on first open of a large project:** one metadata edit per
  coalesced batch after the first execution; the language-server sync already
  merges updates while a write is in flight. If it proves noisy, a short
  debounce can be added without changing the design.
