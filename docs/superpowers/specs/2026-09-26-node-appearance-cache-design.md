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

- `color`: must parse with `culori` (already used by `util/colors.ts`) and be
  supported by the browser (`cssSupported`).
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
  known; `'$evaluating'` and non-icon names rejected.
- `useNodeAppearanceCache`: writes once conditions are met; no write while
  pending, before groups load, when unchanged, or for input/output nodes; no
  colour for overridden nodes; writes use `'local:derivedMetadata'` and do not
  create undo entries.

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
