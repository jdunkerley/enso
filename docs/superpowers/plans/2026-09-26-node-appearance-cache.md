# Node Appearance Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save each node's last computed colour and icon in the `.enso` node
metadata, and show them (faded by the existing pending style) while the node has
not yet been recomputed after the workflow is opened.

**Architecture:** A new optional `cachedAppearance: { color?, icon? }` node
metadata field is threaded through every place that lists node metadata fields
by hand (Yjs AST metadata, file schema, ydoc-server save/load, GUI graph
database). The GUI reads it as the last fallback before the "no type" grey and
the default icon. A GUI composable writes it, off the undo stack, whenever a
computed node's resolved colour or icon differs from what is stored.

**Tech Stack:** TypeScript, Vue 3, Yjs, zod, culori, vitest, Playwright; pnpm
monorepo under `app/`.

**Spec:** `docs/superpowers/specs/2026-09-26-node-appearance-cache-design.md`

## Global Constraints

- Metadata field name: `cachedAppearance`, shape
  `{ color?: string; icon?: string }`. On disk, each string is at most 64
  characters.
- Only the **resolved** colour is stored (e.g. `#4a7fb0`,
  `oklch(0.464 0.14 123)`), never a `var(--…)` reference.
- A malformed `cachedAppearance` on one node drops only that node's cache. It
  must never fail the node record, which would reset all IDE metadata.
- A file without the field must round-trip byte-identically (the key is omitted
  when absent).
- Writes use the new origin `'local:derivedMetadata'`, which must **not** be in
  `localUserActionOrigins`. Only those origins are tracked by undo
  (`app/gui/src/providers/openedProjects/module/module.ts:79`).
- Nothing is cached for input/output nodes. No colour is cached for nodes with a
  `colorOverride`; a colour already stored for them is left as it is.
- An icon equal to `DEFAULT_ICON` (`'enso_logo'`) is stored as absent.
- Use `corepack pnpm`, never bare `pnpm`/`npm`. The Playwright suite does not
  run on native Windows: run it in WSL (Task 7).
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HtSCMjmJWC1DPtGWKF9UEx
  ```
- Branch: `feature/node-appearance-cache` (already created from `develop`; the
  spec is committed on it).

---

### Task 1: Shared metadata field and origin (ydoc-shared)

**Files:**

- Modify: `app/ydoc-shared/src/ast/tree.ts:135-147` (`NodeMetadataFields`,
  `nodeMetadataKeys`)
- Modify: `app/ydoc-shared/src/yjsModel.ts:202-215` (`Origin`, `tryAsOrigin`)
- Create: `app/ydoc-shared/src/ast/__tests__/nodeMetadata.test.ts`

**Interfaces:**

- Produces:
  `export interface CachedAppearance { color?: string; icon?: string }` from
  `tree.ts`, re-exported by `ydoc-shared/ast`. The new metadata key is
  `cachedAppearance?: CachedAppearance | undefined` on `NodeMetadataFields`. The
  new `Origin` member is `'local:derivedMetadata'`.

- [ ] **Step 1: Write the failing test**

Create `app/ydoc-shared/src/ast/__tests__/nodeMetadata.test.ts`:

```ts
import { expect, test } from "vitest";
import { isLocalUserActionOrigin, tryAsOrigin } from "../../yjsModel";
import { MutableModule } from "../mutableModule";
import { parseExpression } from "../parse";

function expression() {
  return parseExpression("a + 1", MutableModule.Transient())!;
}

test("setNodeMetadata stores and serializes cachedAppearance", () => {
  const expr = expression();
  expr.setNodeMetadata({
    cachedAppearance: { color: "#4a7fb0", icon: "table" },
  });
  expect(expr.nodeMetadata.get("cachedAppearance")).toEqual({
    color: "#4a7fb0",
    icon: "table",
  });
  expect(expr.serializeMetadata().cachedAppearance).toEqual({
    color: "#4a7fb0",
    icon: "table",
  });
});

test("setNodeMetadata with an undefined cachedAppearance removes it", () => {
  const expr = expression();
  expr.setNodeMetadata({ cachedAppearance: { color: "#4a7fb0" } });
  expr.setNodeMetadata({ cachedAppearance: undefined });
  expect(expr.nodeMetadata.get("cachedAppearance")).toBeUndefined();
});

test("derived metadata origin is known but is not a user action", () => {
  expect(tryAsOrigin("local:derivedMetadata")).toBe("local:derivedMetadata");
  expect(isLocalUserActionOrigin("local:derivedMetadata")).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`cd app/ydoc-shared && corepack pnpm exec vitest run src/ast/__tests__/nodeMetadata.test.ts`
Expected: FAIL. The first two tests fail because `setNodeMetadata` skips keys
not in `nodeMetadataKeys` (the value is `undefined`). The third fails because
`tryAsOrigin` returns `undefined`. (Type errors in the test do not stop vitest.)

- [ ] **Step 3: Implement**

In `app/ydoc-shared/src/ast/tree.ts`, replace the `NodeMetadataFields` interface
and `nodeMetadataKeys` with:

```ts
/**
 * A node's last computed appearance, saved so that it can be shown before the node is
 * recomputed after the project is opened.
 */
export interface CachedAppearance {
  /** A resolved CSS colour, never a `var(--…)` reference. */
  color?: string;
  /** An icon name. */
  icon?: string;
}
export interface NodeMetadataFields {
  position?: NodePositionMetadata | undefined;
  visualization?: VisualizationMetadata | undefined;
  colorOverride?: string | undefined;
  displayMode?: "expanded" | "collapsed" | undefined;
  cachedAppearance?: CachedAppearance | undefined;
}

const nodeMetadataKeys = allKeys<NodeMetadataFields>({
  position: null,
  visualization: null,
  colorOverride: null,
  displayMode: null,
  cachedAppearance: null,
});
```

In `app/ydoc-shared/src/yjsModel.ts`, replace the `Origin` type and extend
`tryAsOrigin`:

```ts
/**
 * `'local:autoLayout'` and `'local:derivedMetadata'` are local changes the user did not make
 * directly (node placement, cached node appearance). They are not user actions, so the undo
 * manager does not track them.
 */
export type Origin =
  | LocalUserActionOrigin
  | "remote"
  | "local:autoLayout"
  | "local:derivedMetadata";
```

```ts
export function tryAsOrigin(origin: string): Origin | undefined {
  if (isLocalUserActionOrigin(origin)) return origin;
  if (origin === "local:autoLayout") return origin;
  if (origin === "local:derivedMetadata") return origin;
  if (origin === "remote") return origin;
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run:
`cd app/ydoc-shared && corepack pnpm exec vitest run && corepack pnpm run typecheck`
Expected: all tests PASS; typecheck clean. If the typecheck reports a `switch`
over `Origin` that is no longer exhaustive, handle `'local:derivedMetadata'`
there the same way as `'local:autoLayout'`.

- [ ] **Step 5: Commit**

```bash
git add app/ydoc-shared/src/ast/tree.ts app/ydoc-shared/src/yjsModel.ts app/ydoc-shared/src/ast/__tests__/nodeMetadata.test.ts
git commit -m "Add cachedAppearance node metadata field and local:derivedMetadata origin"
```

(Include the trailers from Global Constraints in every commit message.)

---

### Task 2: File format, save and load (ydoc-server)

**Files:**

- Modify: `app/ydoc-server/src/fileFormat.ts:25-35` (node schema; export
  `NodeMetadata` type)
- Modify: `app/ydoc-server/src/edits.ts:77-94` (save loop). Add the exported
  helpers `nodeMetadataToFile` and `applyNodeMetadataFromFile`.
- Modify: `app/ydoc-server/src/languageServerSession.ts:705-725` (load loop, to
  use the helper)
- Create: `app/ydoc-server/src/__tests__/nodeMetadata.test.ts`

**Interfaces:**

- Consumes: `CachedAppearance`, `NodeMetadata`, `MutableNodeMetadata` from
  `ydoc-shared/ast` (Task 1).
- Produces:
  - `fileFormat.NodeMetadata` (the zod-inferred file node entry).
  - `nodeMetadataToFile(metadata: Ast.NodeMetadata): fileFormat.NodeMetadata | undefined`
  - `applyNodeMetadataFromFile(metadata: Ast.MutableNodeMetadata, meta: fileFormat.NodeMetadata): void`

- [ ] **Step 1: Write the failing tests**

Create `app/ydoc-server/src/__tests__/nodeMetadata.test.ts`:

```ts
import { expect, test } from "vitest";
import * as Ast from "ydoc-shared/ast";
import { applyNodeMetadataFromFile, nodeMetadataToFile } from "../edits";
import { tryParseMetadataOrFallback } from "../fileFormat";

const NODE_A = "0a68d440-a0b5-4d6e-ad08-4fb7532a69ce";
const NODE_B = "235c06eb-7293-4675-8d18-1396cc74af6f";

function parseIde(ide: unknown) {
  return tryParseMetadataOrFallback(JSON.stringify({ ide })).ide;
}

function expression() {
  return Ast.parseExpression("a + 1", Ast.MutableModule.Transient())!;
}

test("cachedAppearance is read from the file", () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        cachedAppearance: { color: "#4a7fb0", icon: "table" },
      },
    },
  });
  expect(ide.node[NODE_A]?.cachedAppearance).toEqual({
    color: "#4a7fb0",
    icon: "table",
  });
});

test("a malformed cachedAppearance drops only that node's cache", () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        colorOverride: "#ff0000",
        cachedAppearance: { color: 42 },
      },
      [NODE_B]: {
        position: { vector: [3, 4] },
        cachedAppearance: { icon: "table" },
      },
    },
  });
  expect(ide.node[NODE_A]).toEqual({
    position: { vector: [1, 2] },
    colorOverride: "#ff0000",
  });
  expect(ide.node[NODE_B]?.cachedAppearance).toEqual({ icon: "table" });
});

test("an overlong cached colour is dropped", () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        cachedAppearance: { color: "x".repeat(65) },
      },
    },
  });
  expect(ide.node[NODE_A]?.cachedAppearance).toBeUndefined();
  expect(ide.node[NODE_A]?.position).toEqual({ vector: [1, 2] });
});

test("saving a node without a cache writes no cachedAppearance key", () => {
  const expr = expression();
  expr.setNodeMetadata({ position: { x: 10, y: -20 } });
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]}}',
  );
});

test("saving a node with a cache writes it after the existing fields", () => {
  const expr = expression();
  expr.setNodeMetadata({
    position: { x: 10, y: -20 },
    colorOverride: "#ff0000",
    cachedAppearance: { color: "#4a7fb0", icon: "table" },
  });
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]},"colorOverride":"#ff0000",' +
      '"cachedAppearance":{"color":"#4a7fb0","icon":"table"}}',
  );
});

test("a node without a position is not saved", () => {
  const expr = expression();
  expr.setNodeMetadata({ cachedAppearance: { color: "#4a7fb0" } });
  expect(nodeMetadataToFile(expr.nodeMetadata)).toBeUndefined();
});

test("file -> Yjs -> file round-trips the cache", () => {
  const entry = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [10, 20] },
        cachedAppearance: { color: "#4a7fb0", icon: "table" },
      },
    },
  }).node[NODE_A]!;
  const expr = expression();
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry);
  expect(expr.nodeMetadata.get("cachedAppearance")).toEqual({
    color: "#4a7fb0",
    icon: "table",
  });
  expect(JSON.stringify(nodeMetadataToFile(expr.nodeMetadata))).toBe(
    '{"position":{"vector":[10,20]},"cachedAppearance":{"color":"#4a7fb0","icon":"table"}}',
  );
});

test("loading an unchanged cache does not rewrite it", () => {
  const entry = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [10, 20] },
        cachedAppearance: { icon: "table" },
      },
    },
  }).node[NODE_A]!;
  const expr = expression();
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry);
  const stored = expr.nodeMetadata.get("cachedAppearance");
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry);
  expect(expr.nodeMetadata.get("cachedAppearance")).toBe(stored);
});

test("loading a file without a cache clears a stale one", () => {
  const entry = parseIde({
    node: { [NODE_A]: { position: { vector: [10, 20] } } },
  }).node[NODE_A]!;
  const expr = expression();
  expr.setNodeMetadata({ cachedAppearance: { icon: "table" } });
  applyNodeMetadataFromFile(expr.mutableNodeMetadata(), entry);
  expect(expr.nodeMetadata.get("cachedAppearance")).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`cd app/ydoc-server && corepack pnpm exec vitest run src/__tests__/nodeMetadata.test.ts`
Expected: FAIL. The import of `nodeMetadataToFile` / `applyNodeMetadataFromFile`
fails ("is not a function" or "does not provide an export named").

- [ ] **Step 3: Implement the schema**

In `app/ydoc-server/src/fileFormat.ts`, directly above `const nodeMetadata`,
add:

```ts
const cachedAppearance = z.object({
  color: z.string().max(64).optional(),
  icon: z.string().max(64).optional(),
});
```

Replace the `nodeMetadata` definition with the following. The `.catch` is per
field: a bad cache must not fail the node record, because that would reset all
IDE metadata.

```ts
export type NodeMetadata = z.infer<typeof nodeMetadata>;
const nodeMetadata = z
  .object({
    position: z.object({ vector }).catch((ctx) => {
      printError(ctx);
      return { vector: [0, 0] satisfies Vector };
    }),
    visualization: visualizationMetadata.optional().catch(() => undefined),
    colorOverride: z.string().optional(),
    displayMode: z.enum(["expanded", "collapsed"]).optional(),
    // A cache: a malformed value drops only this field, never the whole node record.
    cachedAppearance: cachedAppearance.optional().catch(() => undefined),
  })
  .passthrough();
```

- [ ] **Step 4: Implement the save and load helpers**

In `app/ydoc-server/src/edits.ts`:

1. Change the import from `ydoc-shared/yjsModel` to:
   ```ts
   import {
     IdMap,
     ModuleDoc,
     visMetadataEquals,
     type VisualizationMetadata,
   } from "ydoc-shared/yjsModel";
   ```
2. Replace the body of the `Ast.visitRecursive` callback's node-metadata part
   (from `let pos = …` to the closing brace of `if (pos) { … }`) with:
   ```ts
   const nodeEntry = nodeMetadataToFile(ast.nodeMetadata);
   if (nodeEntry) newMetadata!.node[ast.externalId] = nodeEntry;
   ```
   Leave the widget-metadata part below it unchanged.
3. Add, directly after `applyDocumentUpdates`:

```ts
/** Copy a cached appearance, omitting absent fields so they are not written as keys. */
function copyCachedAppearance(
  cached:
    | {
        readonly color?: string | undefined;
        readonly icon?: string | undefined;
      }
    | undefined,
): Ast.CachedAppearance | undefined {
  if (cached?.color == null && cached?.icon == null) return undefined;
  return {
    ...(cached.color != null ? { color: cached.color } : {}),
    ...(cached.icon != null ? { icon: cached.icon } : {}),
  };
}

/**
 * The file representation of a node's metadata, or `undefined` if the node has nothing to save.
 * Only nodes with a position (or a visualization, which implies one) are saved.
 */
export function nodeMetadataToFile(
  metadata: Ast.NodeMetadata,
): fileFormat.NodeMetadata | undefined {
  let pos = metadata.get("position");
  const vis = metadata.get("visualization");
  if (vis && !pos) pos = { x: 0, y: 0 };
  if (!pos) return undefined;
  // Key order is part of the file format: new keys go last so existing files keep their bytes.
  return {
    position: { vector: [Math.round(pos.x), Math.round(-pos.y)] },
    visualization: vis && translateVisualizationToFile(vis),
    colorOverride: metadata.get("colorOverride"),
    displayMode: metadata.get("displayMode"),
    cachedAppearance: copyCachedAppearance(metadata.get("cachedAppearance")),
  };
}

/** Update a node's Yjs metadata from its file representation, setting only fields that differ. */
export function applyNodeMetadataFromFile(
  metadata: Ast.MutableNodeMetadata,
  meta: fileFormat.NodeMetadata,
) {
  const oldPos = metadata.get("position");
  const newPos = { x: meta.position.vector[0], y: -meta.position.vector[1] };
  if (oldPos?.x !== newPos.x || oldPos?.y !== newPos.y)
    metadata.set("position", newPos);
  const oldVis = metadata.get("visualization");
  const newVis =
    meta.visualization && translateVisualizationFromFile(meta.visualization);
  if (!visMetadataEquals(newVis, oldVis)) metadata.set("visualization", newVis);
  const oldColorOverride = metadata.get("colorOverride");
  const newColorOverride = meta.colorOverride;
  if (oldColorOverride !== newColorOverride)
    metadata.set("colorOverride", newColorOverride);
  const oldDisplayMode = metadata.get("displayMode");
  const newDisplayMode = meta.displayMode;
  if (oldDisplayMode !== newDisplayMode)
    metadata.set("displayMode", newDisplayMode);
  const oldCached = metadata.get("cachedAppearance");
  const newCached = copyCachedAppearance(meta.cachedAppearance);
  if (
    oldCached?.color !== newCached?.color ||
    oldCached?.icon !== newCached?.icon
  )
    metadata.set("cachedAppearance", newCached);
}
```

In `app/ydoc-server/src/languageServerSession.ts`, inside the
`for (const [id, meta] of nodeMeta)` loop, replace everything after
`const metadata = syncModule.getVersion(ast).mutableNodeMetadata()` up to the
end of the loop body (the four old/new comparisons) with:

```ts
applyNodeMetadataFromFile(metadata, meta);
```

Add `applyNodeMetadataFromFile` to the existing import from `./edits`. Remove
`translateVisualizationFromFile` and `visMetadataEquals` from that file's
imports if they are now unused. Lint (Step 5) reports unused imports.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run:
`cd app/ydoc-server && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run lint`
Expected: all PASS, including the existing `edits.test.ts`.

If the typecheck rejects `metadata.set('cachedAppearance', …)` or the
`copyCachedAppearance(metadata.get(...))` call over `DeepReadonly`, widen the
`copyCachedAppearance` parameter type rather than casting.

- [ ] **Step 6: Commit**

```bash
git add app/ydoc-server/src/fileFormat.ts app/ydoc-server/src/edits.ts app/ydoc-server/src/languageServerSession.ts app/ydoc-server/src/__tests__/nodeMetadata.test.ts
git commit -m "Save and load cachedAppearance in the .enso node metadata"
```

---

### Task 3: GUI validation and carrying the field in the graph database

**Files:**

- Create: `app/gui/src/project-view/util/cachedAppearance.ts`
- Create: `app/gui/src/project-view/util/__tests__/cachedAppearance.test.ts`
- Modify: `app/gui/src/providers/openedProjects/graph/graphDatabase.ts`:
  - initial read (~L367-375);
  - `updateMetadata` (~L467-487);
  - `mockNode` (~L595-611);
  - `NodeDataFromMetadata` (~L723-729).
- Modify: `app/gui/src/project-view/components/GraphEditor/aiNode.ts:236-243`

**Interfaces:**

- Consumes: `CachedAppearance` from `ydoc-shared/ast` (Task 1).
- Produces:
  - `interface ValidCachedAppearance { color?: string; icon?: Icon }`
  - `sanitizeCachedAppearance(raw: { readonly color?: unknown; readonly icon?: unknown } | null | undefined): ValidCachedAppearance | undefined`
  - `Node.cachedAppearance: ValidCachedAppearance | undefined`, via
    `NodeDataFromMetadata`.

- [ ] **Step 1: Write the failing test**

Create `app/gui/src/project-view/util/__tests__/cachedAppearance.test.ts`:

```ts
import { sanitizeCachedAppearance } from "@/util/cachedAppearance";
import { expect, test } from "vitest";

test.each([
  [undefined, undefined],
  [null, undefined],
  [{}, undefined],
  [
    { color: "#4a7fb0", icon: "table" },
    { color: "#4a7fb0", icon: "table" },
  ],
  [{ color: "oklch(0.464 0.14 123)" }, { color: "oklch(0.464 0.14 123)" }],
  [{ color: "rgb(74 127 176)" }, { color: "rgb(74 127 176)" }],
  [{ color: "not a colour", icon: "table" }, { icon: "table" }],
  [{ color: "red; background: url(x)" }, undefined],
  [{ color: 42 }, undefined],
  [{ color: "#4a7fb0", icon: "no_such_icon" }, { color: "#4a7fb0" }],
  [{ icon: "$evaluating" }, undefined],
])("sanitizeCachedAppearance(%o) = %o", (raw, expected) => {
  expect(sanitizeCachedAppearance(raw)).toEqual(expected);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/util/__tests__/cachedAppearance.test.ts`
Expected: FAIL, because `@/util/cachedAppearance` can't be resolved.

- [ ] **Step 3: Implement the validator**

Create `app/gui/src/project-view/util/cachedAppearance.ts`:

```ts
import { isIconName, type Icon } from "@/util/iconMetadata/iconName";
import { modeOklch, modeRgb, parse, useMode } from "culori/fn";

// `culori/fn` parses only the colour spaces registered with it; these cover every colour the
// IDE produces (hex and `rgb()` group colours, `oklch()` type colours). Registering is idempotent.
useMode(modeRgb);
useMode(modeOklch);

/** A node's cached appearance, after validation: safe to use as a CSS colour and an icon name. */
export interface ValidCachedAppearance {
  color?: string;
  icon?: Icon;
}

/**
 * Validate a cached appearance read from the file (which may have been edited by hand). Invalid
 * parts are dropped individually; `undefined` if nothing valid remains.
 */
export function sanitizeCachedAppearance(
  raw: { readonly color?: unknown; readonly icon?: unknown } | null | undefined,
): ValidCachedAppearance | undefined {
  if (raw == null) return undefined;
  const color =
    typeof raw.color === "string" && parse(raw.color) != null
      ? raw.color
      : undefined;
  const icon =
    typeof raw.icon === "string" && isIconName(raw.icon) ? raw.icon : undefined;
  if (color == null && icon == null) return undefined;
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/util/__tests__/cachedAppearance.test.ts`
Expected: PASS. If `culori/fn` has no `parse` export in the installed version,
check `node_modules/culori/src/index.fn.js` for the parse entry point and import
that instead; do not fall back to regexes.

- [ ] **Step 5: Carry the field through `GraphDb`**

In `app/gui/src/providers/openedProjects/graph/graphDatabase.ts`:

- Import:
  `import { sanitizeCachedAppearance, type ValidCachedAppearance } from '@/util/cachedAppearance'`
- Add `cachedAppearance: ValidCachedAppearance | undefined` to
  `NodeDataFromMetadata`.
- In the `metadataFields` object of the new-node branch, after `colorOverride`:
  ```ts
        cachedAppearance: sanitizeCachedAppearance(nodeMeta.get('cachedAppearance')),
  ```
- In `updateMetadata`, after the `colorOverride` block:
  ```ts
  if (changes.has("cachedAppearance")) {
    node.cachedAppearance = sanitizeCachedAppearance(
      changes.get("cachedAppearance"),
    );
  }
  ```
- In `mockNode`, after `colorOverride: undefined,`, add
  `cachedAppearance: undefined,`.

In `app/gui/src/project-view/components/GraphEditor/aiNode.ts`, add this to the
`newCallAst.setNodeMetadata({...})` object, after `displayMode`:

```ts
    cachedAppearance: oldNodeMeta.get('cachedAppearance'),
```

Extend the comment above it so the list of preserved state includes "cached
appearance".

- [ ] **Step 6: Typecheck and run the GUI unit tests**

Run:
`cd app/gui && corepack pnpm run typecheck && corepack pnpm exec vitest run src/providers/openedProjects src/project-view/util`
Expected: PASS. Fix any other `Node` object literal that the typecheck reports
as missing `cachedAppearance` by adding `cachedAppearance: undefined`.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/util/cachedAppearance.ts app/gui/src/project-view/util/__tests__/cachedAppearance.test.ts app/gui/src/providers/openedProjects/graph/graphDatabase.ts app/gui/src/project-view/components/GraphEditor/aiNode.ts
git commit -m "Validate cachedAppearance and carry it through the graph database"
```

---

### Task 4: Colour fallback and colour source

**Files:**

- Modify: `app/gui/src/project-view/composables/nodeColors.ts`
  (`computeNodeColor`)
- Modify: `app/gui/src/providers/openedProjects/graph/graphDatabase.ts:151-158`
  (`nodeColor`), and `:264-266` (`getNodeColorStyle`); add `getNodeColorSource`.
- Create: `app/gui/src/project-view/composables/__tests__/nodeColors.test.ts`

**Interfaces:**

- Consumes: `Node.cachedAppearance` (Task 3).
- Produces:
  - `type NodeColorSource = 'override' | 'fixed' | 'group' | 'type' | 'cached' | 'none'`
  - `interface NodeColorInfo { color: string; source: NodeColorSource }`
  - `computeNodeColor(getType, getGroup, getTypeName, getCachedColor?: () => string | undefined): NodeColorInfo`
  - `GraphDb.getNodeColorSource(id: NodeId): NodeColorSource`.
    `GraphDb.getNodeColorStyle(id)` still returns a `string`.

- [ ] **Step 1: Write the failing test**

Create `app/gui/src/project-view/composables/__tests__/nodeColors.test.ts`:

```ts
import { computeNodeColor } from "@/composables/nodeColors";
import { colorFromString } from "@/util/colors";
import { ProjectPath } from "@/util/projectPath";
import type { QualifiedName } from "@/util/qualifiedName";
import { expect, test } from "vitest";

const group = { name: "Input", project: "Standard.Base" as QualifiedName };
const typeName = ProjectPath.create(
  "Standard.Base" as QualifiedName,
  "Data.Numbers.Integer" as QualifiedName,
);
const cached = () => "#4a7fb0";
const none = () => undefined;

test("input and output nodes have a fixed colour, even with a cache", () => {
  expect(computeNodeColor(() => "output", none, none, cached)).toEqual({
    color: "var(--output-node-color)",
    source: "fixed",
  });
  expect(computeNodeColor(() => "input", none, none, cached).source).toBe(
    "fixed",
  );
});

test("a group colour beats the type and the cache", () => {
  expect(
    computeNodeColor(
      () => "component",
      () => group,
      () => typeName,
      cached,
    ),
  ).toEqual({
    color: "var(--group-color-Standard-Base-Input)",
    source: "group",
  });
});

test("a type colour beats the cache", () => {
  expect(
    computeNodeColor(
      () => "component",
      none,
      () => typeName,
      cached,
    ),
  ).toEqual({
    color: colorFromString(typeName.key()),
    source: "type",
  });
});

test("the cached colour is used when nothing is known", () => {
  expect(computeNodeColor(() => "component", none, none, cached)).toEqual({
    color: "#4a7fb0",
    source: "cached",
  });
});

test("without a cache the no-type colour is used", () => {
  expect(computeNodeColor(() => "component", none, none)).toEqual({
    color: "var(--node-color-no-type)",
    source: "none",
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/composables/__tests__/nodeColors.test.ts`
Expected: FAIL, because `computeNodeColor` returns a string rather than
`{ color, source }`.

- [ ] **Step 3: Implement**

In `app/gui/src/project-view/composables/nodeColors.ts`, replace
`computeNodeColor` with:

```ts
/** Where a node's displayed colour comes from. */
export type NodeColorSource =
  "override" | "fixed" | "group" | "type" | "cached" | "none";

/** A node's displayed colour (a CSS colour or `var(…)` reference) and where it comes from. */
export interface NodeColorInfo {
  color: string;
  source: NodeColorSource;
}

/**
 * Compute node color based on the node type, group, and type name. The cached colour, saved from
 * an earlier session, is used only while none of those is known yet.
 */
export function computeNodeColor(
  getType: () => NodeType,
  getGroup: () => GroupInfo | undefined,
  getTypeName: () => ProjectPath | undefined,
  getCachedColor: () => string | undefined = () => undefined,
): NodeColorInfo {
  if (getType() === "output")
    return { color: "var(--output-node-color)", source: "fixed" };
  if (getType() === "input")
    return { color: "var(--output-node-color)", source: "fixed" };
  const group = getGroup();
  if (group) return { color: groupColorStyle(group), source: "group" };
  const typeName = getTypeName();
  if (typeName)
    return { color: colorFromString(typeName.key()), source: "type" };
  const cachedColor = getCachedColor();
  if (cachedColor) return { color: cachedColor, source: "cached" };
  return { color: "var(--node-color-no-type)", source: "none" };
}
```

In `graphDatabase.ts`, import `type NodeColorInfo, type NodeColorSource` from
`@/composables/nodeColors` alongside `computeNodeColor`, and replace the
`nodeColor` mapping and `getNodeColorStyle`:

```ts
nodeColor = new ReactiveMapping(
  this.nodeIdToNode,
  (id, entry): NodeColorInfo => {
    if (entry.colorOverride != null)
      return { color: entry.colorOverride, source: "override" };
    return computeNodeColor(
      () => entry.type,
      () =>
        tryGetIndex(
          this.groups.value,
          this.getNodeMainSuggestion(id)?.groupIndex,
        ),
      () => this.getExpressionInfo(id)?.typeInfo?.primaryType,
      () => entry.cachedAppearance?.color,
    );
  },
);
```

```ts
  /** The CSS colour (or `var(…)` reference) the node is displayed with. */
  getNodeColorStyle(id: NodeId): string {
    return this.nodeColor.lookup(id)?.color ?? 'var(--node-color-no-type)'
  }

  /** Where the node's displayed colour comes from. */
  getNodeColorSource(id: NodeId): NodeColorSource {
    return this.nodeColor.lookup(id)?.source ?? 'none'
  }
```

Confirm nothing else reads `nodeColor.lookup` directly:
`git grep -n "nodeColor.lookup\|computeNodeColor" app/gui/src` should show only
`graphDatabase.ts`, `nodeColors.ts` and the new test.

- [ ] **Step 4: Run the tests and typecheck**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/composables src/providers/openedProjects && corepack pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/composables/nodeColors.ts app/gui/src/project-view/composables/__tests__/nodeColors.test.ts app/gui/src/providers/openedProjects/graph/graphDatabase.ts
git commit -m "Fall back to the cached node colour before the no-type grey"
```

---

### Task 5: Icon fallback on both render paths

**Files:**

- Modify: `app/gui/src/project-view/util/getIconName.ts`: `displayedIconOf`,
  `iconOfNode`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelfAccessChain.vue:24-32`
- Check only:
  `app/gui/src/project-view/components/GraphEditor/ComponentWidgetTree.vue:35`.
  It calls `iconOfNode`, so it gets the fallback without a change.
- Create: `app/gui/src/project-view/util/__tests__/getIconName.test.ts`

**Interfaces:**

- Consumes: `Node.cachedAppearance.icon: Icon | undefined` (Task 3).
- Produces:
  - `displayedIconOf(entry?, methodCall?, actualType?, fallback?: Icon): Icon`
  - `iconOfNode(node: NodeId, graphDb: GraphDb, options?: { useCachedIcon?: boolean }): Icon`.
    Task 6 calls it with `{ useCachedIcon: false }`.

- [ ] **Step 1: Write the failing test**

Create `app/gui/src/project-view/util/__tests__/getIconName.test.ts`:

```ts
import { DEFAULT_ICON, displayedIconOf } from "@/util/getIconName";
import { ProjectPath } from "@/util/projectPath";
import type { QualifiedName } from "@/util/qualifiedName";
import { expect, test } from "vitest";

const textType = ProjectPath.create(
  "Standard.Base" as QualifiedName,
  "Data.Text.Text" as QualifiedName,
);

test("with nothing known, the default icon is used", () => {
  expect(displayedIconOf()).toBe(DEFAULT_ICON);
});

test("with nothing known, the cached icon is used", () => {
  expect(displayedIconOf(undefined, undefined, undefined, "table")).toBe(
    "table",
  );
});

test("a known type beats the cached icon", () => {
  expect(displayedIconOf(undefined, undefined, textType, "table")).toBe(
    "text_input",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/util/__tests__/getIconName.test.ts`
Expected: FAIL on the second test (`'enso_logo'` instead of `'table'`).

- [ ] **Step 3: Implement**

In `app/gui/src/project-view/util/getIconName.ts`, replace `displayedIconOf` and
`iconOfNode`:

```ts
/**
 * Returns an icon for a suggestion entry or method call. `fallback` is used when neither says
 * anything (e.g. the icon saved from an earlier session, before the node is recomputed).
 */
export function displayedIconOf(
  entry?: SuggestionEntry,
  methodCall?: MethodPointer,
  actualType?: ProjectPath,
  fallback: Icon = DEFAULT_ICON,
): Icon {
  if (entry) {
    return suggestionEntryToIcon(entry);
  } else if (!methodCall?.name && actualType) {
    return typeNameToIcon(actualType);
  } else {
    return fallback;
  }
}

/**
 * Returns the icon to show on a component. With `useCachedIcon: false` the icon saved from an
 * earlier session is ignored, giving the icon computed from current data alone.
 */
export function iconOfNode(
  node: NodeId,
  graphDb: GraphDb,
  { useCachedIcon = true }: { useCachedIcon?: boolean } = {},
) {
  const expressionInfo = graphDb.getExpressionInfo(node);
  const suggestionEntry = graphDb.getNodeMainSuggestion(node);
  const nodeData = graphDb.nodeIdToNode.get(node);
  switch (nodeData?.type) {
    default:
    case "component":
      return displayedIconOf(
        suggestionEntry,
        expressionInfo?.methodCall?.methodPointer,
        expressionInfo?.typeInfo?.primaryType,
        useCachedIcon ? nodeData?.cachedAppearance?.icon : undefined,
      );
    case "output":
      return "data_output";
    case "input":
      return "data_input";
  }
}
```

In `WidgetSelfAccessChain.vue`, first confirm that `tree.externalId` is the
node's id. `git grep -n "provideWidgetTree(" app/gui/src` shows what
`ComponentWidgetTree.vue` passes: it should be the node's `rootExpr`/node
external id, the same value `ComponentWidgetTree` passes to `useDisplayedIcon`
as `nodeId`. Then import `asNodeId` from
`$/providers/openedProjects/graph/graphDatabase` and replace `baseIcon`:

```ts
const baseIcon = computed(() => {
  const callInfo = functionInfo?.callInfo;
  const nodeId =
    tree.externalId != null ? asNodeId(tree.externalId) : undefined;
  const cachedIcon =
    nodeId && graph.db.nodeIdToNode.get(nodeId)?.cachedAppearance?.icon;
  return displayedIconOf(
    callInfo?.suggestion,
    callInfo?.methodCall.methodPointer,
    functionInfo?.outputType,
    cachedIcon || undefined,
  );
});
```

If `tree.externalId` turns out **not** to be the node id, look up the node with
`graph.db.getExpressionNodeId(tree.externalId)` (or whichever `GraphDb` method
maps an expression's external id to its node; find it with
`git grep -n "NodeId | undefined" app/gui/src/providers/openedProjects/graph/graphDatabase.ts`).

- [ ] **Step 4: Run the tests, typecheck and lint**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/util && corepack pnpm run typecheck && corepack pnpm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/util/getIconName.ts app/gui/src/project-view/util/__tests__/getIconName.test.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelfAccessChain.vue
git commit -m "Show the cached node icon until the node's icon is known"
```

---

### Task 6: Writing the cache

**Files:**

- Create: `app/gui/src/project-view/composables/nodeAppearanceCache.ts`
- Create:
  `app/gui/src/project-view/composables/__tests__/nodeAppearanceCache.test.ts`
- Modify: `app/gui/src/providers/openedProjects/graph/graph.ts`. Add
  `setNodeCachedAppearances` next to `overrideNodeColor` (~L405) and export it
  in the returned object (~L699).
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts:340-372`.
  Add `groupsLoaded`.
- Modify: `app/gui/src/project-view/components/GraphEditor.vue:733-735`, to
  mount the writer.

**Interfaces:**

- Consumes:
  - `CachedAppearance` (Task 1);
  - `GraphDb.getNodeColorSource`, `NodeColorSource` (Task 4);
  - `iconOfNode(id, db, { useCachedIcon: false })` and `DEFAULT_ICON` (Task 5);
  - `Node.cachedAppearance` (Task 3);
  - `getNodeColor(id): string | undefined` from `useNodeColors`. It resolves
    `var(--…)` references and returns `undefined` for an unresolved variable.
- Produces:
  - `appearanceToCache(input: AppearanceInput): CachedAppearance | undefined`
  - `useNodeAppearanceCache(graph: GraphStore, getNodeColor: (id: NodeId) => string | undefined, ready: () => boolean): void`
  - `GraphStore.setNodeCachedAppearances(appearances: ReadonlyMap<NodeId, CachedAppearance>): void`
  - `suggestionDb.groupsLoaded: boolean`

- [ ] **Step 1: Write the failing test**

Create
`app/gui/src/project-view/composables/__tests__/nodeAppearanceCache.test.ts`:

```ts
import {
  appearanceToCache,
  type AppearanceInput,
} from "@/composables/nodeAppearanceCache";
import { DEFAULT_ICON } from "@/util/getIconName";
import { expect, test } from "vitest";

const computedNode: AppearanceInput = {
  type: "component",
  pending: false,
  hasColorOverride: false,
  colorSource: "type",
  resolvedColor: "oklch(0.464 0.14 123)",
  icon: "table",
  stored: undefined,
};

test("a computed node is cached", () => {
  expect(appearanceToCache(computedNode)).toEqual({
    color: "oklch(0.464 0.14 123)",
    icon: "table",
  });
});

test("a group colour is cached as its resolved value, trimmed", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: "group",
      resolvedColor: " #4a7fb0",
    }),
  ).toEqual({ color: "#4a7fb0", icon: "table" });
});

test("the default icon is stored as absent", () => {
  expect(appearanceToCache({ ...computedNode, icon: DEFAULT_ICON })).toEqual({
    color: "oklch(0.464 0.14 123)",
  });
});

test("nothing is written when the stored appearance is unchanged", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      stored: { color: "oklch(0.464 0.14 123)", icon: "table" },
    }),
  ).toBeUndefined();
});

test("a changed colour is rewritten", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      stored: { color: "#000000", icon: "table" },
    }),
  ).toEqual({ color: "oklch(0.464 0.14 123)", icon: "table" });
});

test.each(["input", "output"] as const)("%s nodes are never cached", (type) => {
  expect(appearanceToCache({ ...computedNode, type })).toBeUndefined();
});

test("pending nodes are not cached", () => {
  expect(appearanceToCache({ ...computedNode, pending: true })).toBeUndefined();
});

test.each(["cached", "none", "fixed"] as const)(
  "a colour from source %s is not cached",
  (colorSource) => {
    expect(appearanceToCache({ ...computedNode, colorSource })).toBeUndefined();
  },
);

test("an unresolved group colour is not cached", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: "group",
      resolvedColor: undefined,
    }),
  ).toBeUndefined();
  expect(
    appearanceToCache({
      ...computedNode,
      colorSource: "group",
      resolvedColor: "",
    }),
  ).toBeUndefined();
});

test("with a colour override, only the icon is updated and a stored colour is kept", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: "override",
      resolvedColor: "#ff0000",
      stored: { color: "#111111", icon: "data_input" },
    }),
  ).toEqual({ color: "#111111", icon: "table" });
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: "override",
      resolvedColor: "#ff0000",
    }),
  ).toEqual({ icon: "table" });
});

test("with a colour override and the default icon, nothing is written", () => {
  expect(
    appearanceToCache({
      ...computedNode,
      hasColorOverride: true,
      colorSource: "override",
      icon: DEFAULT_ICON,
    }),
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/composables/__tests__/nodeAppearanceCache.test.ts`
Expected: FAIL, because `@/composables/nodeAppearanceCache` can't be resolved.

- [ ] **Step 3: Implement the decision function and the composable**

Create `app/gui/src/project-view/composables/nodeAppearanceCache.ts`:

```ts
import type { GraphStore, NodeId } from "$/providers/openedProjects/graph";
import type { NodeType } from "$/providers/openedProjects/graph/graphDatabase";
import type { NodeColorSource } from "@/composables/nodeColors";
import { DEFAULT_ICON, iconOfNode } from "@/util/getIconName";
import { computed, watch } from "vue";
import type { CachedAppearance } from "ydoc-shared/ast";

/** What {@link appearanceToCache} needs to know about a node. */
export interface AppearanceInput {
  type: NodeType;
  /** Whether the node is waiting for its value (`Unknown` or `Pending` payload). */
  pending: boolean;
  hasColorOverride: boolean;
  colorSource: NodeColorSource;
  /** The displayed colour with any `var(--…)` resolved; `undefined` if it could not be resolved. */
  resolvedColor: string | undefined;
  /** The icon computed from current data alone, ignoring the cache. */
  icon: string;
  stored: CachedAppearance | undefined;
}

/**
 * The appearance to save for a node, or `undefined` if nothing should be written: the node is not
 * a computed component, its colour is not known from current data, or nothing has changed.
 */
export function appearanceToCache(
  input: AppearanceInput,
): CachedAppearance | undefined {
  if (input.type !== "component" || input.pending) return undefined;
  let color: string | undefined;
  if (input.hasColorOverride) {
    // The override is saved separately and always wins; keep whatever colour was cached before.
    color = input.stored?.color;
  } else {
    if (input.colorSource !== "group" && input.colorSource !== "type")
      return undefined;
    color = input.resolvedColor?.trim();
    if (!color) return undefined;
  }
  const icon = input.icon === DEFAULT_ICON ? undefined : input.icon;
  if (input.stored?.color === color && input.stored?.icon === icon)
    return undefined;
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  };
}

/**
 * Keep each node's `cachedAppearance` metadata in step with its computed colour and icon, so that
 * the next time the project is opened, nodes can be shown in their colours before they are
 * recomputed. Changes seen together are written in one batch, off the undo stack.
 *
 * `ready` must stay false until library groups are loaded; otherwise a group-coloured node would
 * be cached with its type colour first and rewritten moments later.
 */
export function useNodeAppearanceCache(
  graph: GraphStore,
  getNodeColor: (id: NodeId) => string | undefined,
  ready: () => boolean,
) {
  const writes = computed(() => {
    const result = new Map<NodeId, CachedAppearance>();
    if (!ready()) return result;
    const db = graph.db;
    for (const [id, node] of db.nodeIdToNode.entries()) {
      if (node.type !== "component") continue;
      const payload =
        db.getExpressionInfo(node.innerExpr.externalId)?.payload.type ??
        "Unknown";
      const pending = payload === "Unknown" || payload === "Pending";
      if (pending) continue;
      const colorSource = db.getNodeColorSource(id);
      const update = appearanceToCache({
        type: node.type,
        pending,
        hasColorOverride: node.colorOverride != null,
        colorSource,
        resolvedColor:
          colorSource === "group" || colorSource === "type"
            ? getNodeColor(id)
            : undefined,
        icon: iconOfNode(id, db, { useCachedIcon: false }),
        stored: node.cachedAppearance,
      });
      if (update) result.set(id, update);
    }
    return result;
  });
  watch(
    writes,
    (appearances) => {
      if (appearances.size > 0) graph.setNodeCachedAppearances(appearances);
    },
    { flush: "post" },
  );
}
```

Note that `stored` is the **sanitized** cache (Task 3). An invalid stored value
therefore reads as absent and is overwritten with a valid one.

- [ ] **Step 4: Run the test to verify it passes**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/composables/__tests__/nodeAppearanceCache.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store writer, `groupsLoaded`, and mount it**

In `app/gui/src/providers/openedProjects/graph/graph.ts`, add after
`getNodeColorOverride`:

```ts
/**
 * Save nodes' computed appearance in their metadata. This is derived data, so it is written off
 * the undo stack.
 */
function setNodeCachedAppearances(
  appearances: ReadonlyMap<NodeId, CachedAppearance>,
) {
  module.batchEdits(() => {
    for (const [nodeId, appearance] of appearances) {
      module
        .mutableNodeMetadata(db.idFromExternal(nodeId))
        ?.set("cachedAppearance", appearance);
    }
  }, "local:derivedMetadata");
}
```

Import `type CachedAppearance` from `ydoc-shared/ast`, and add
`setNodeCachedAppearances,` to the returned `proxyRefs({...})` after
`getNodeColorOverride,`.

In `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts`
(`createSuggestionDbStore`):

```ts
const groups = ref<GroupInfo[]>([]);
const groupsLoaded = ref(false);

const updateProcessor = loadGroups(
  projectStore.lsRpcConnection,
  projectStore.firstExecution,
).then((loadedGroups) => {
  groups.value = loadedGroups;
  groupsLoaded.value = true;
  return new SuggestionUpdateProcessor(loadedGroups, projectNames);
});
```

and add `groupsLoaded: readonly(groupsLoaded),` after
`groups: readonly(groups),` in the returned object. (`loadGroups` returns `[]`
after logging when the request fails, so `groupsLoaded` still becomes true. The
cache then records type colours, which is correct for a session without groups.)

In `app/gui/src/project-view/components/GraphEditor.vue`, replace the
`provideNodeColors(...)` call under `// === Color Picker ===` with:

```ts
const { getNodeColor } = provideNodeColors(graphStore, (variable) =>
  viewportElem.value
    ? getComputedStyle(viewportElem.value).getPropertyValue(variable)
    : "",
);

// === Node Appearance Cache ===

useNodeAppearanceCache(
  graphStore,
  getNodeColor,
  () => suggestionDb.groupsLoaded,
);
```

and add
`import { useNodeAppearanceCache } from '@/composables/nodeAppearanceCache'`
with the other `@/composables` imports.

`provideNodeColors` returns the constructed store (`createContextStore`'s
`provideFn` returns it), so `getNodeColor` is the same function the colour
picker uses.

- [ ] **Step 6: Run all GUI unit tests, typecheck and lint**

Run:
`cd app/gui && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/composables/nodeAppearanceCache.ts app/gui/src/project-view/composables/__tests__/nodeAppearanceCache.test.ts app/gui/src/providers/openedProjects/graph/graph.ts app/gui/src/providers/openedProjects/suggestionDatabase/index.ts app/gui/src/project-view/components/GraphEditor.vue
git commit -m "Save each computed node's colour and icon as cachedAppearance"
```

---

### Task 7: End-to-end test (Playwright, in WSL)

The mock language server (`app/gui/integration-test/mock/lsHandler.ts`) serves a
`Main.enso` without metadata, and sends no expression updates on its own. Every
node therefore stays pending until a test calls `mockExpressionUpdate`. The test
drives the whole in-app cycle:

1. compute a node;
2. the writer caches its colour;
3. make the node pending with no type;
4. the cached colour is shown, faded.

Persistence across a reload is covered by Task 2's round-trip tests.

**Files:**

- Create: `app/gui/integration-test/project-view/nodeAppearanceCache.spec.ts`

**Interfaces:**

- Consumes: `mockExpressionUpdate` (`./expressionUpdates`),
  `locate.graphNodeByBinding` (`./locate`), and the `editorPage` fixture
  (`integration-test/base`). The `five` and `ten` nodes are in the mock `main`.

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from "integration-test/base";
import { mockExpressionUpdate } from "./expressionUpdates";
import * as locate from "./locate";

async function nodeColor(node: ReturnType<typeof locate.graphNodeByBinding>) {
  const style = (await node.getAttribute("style")) ?? "";
  return /--node-group-color:\s*([^;]+)/.exec(style)?.[1]?.trim();
}

test("a pending node shows the colour cached from its last computation", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const five = locate.graphNodeByBinding(page, "five");
  const ten = locate.graphNodeByBinding(page, "ten");

  // Never computed: pending, no-type colour.
  await expect(ten).toHaveClass(/pending/);
  expect(await nodeColor(ten)).toBe("var(--node-color-no-type)");

  // Computed with a type: gets the type's colour, which is then cached.
  await mockExpressionUpdate(page, "five", {
    type: ["Standard.Base.Data.Numbers.Integer"],
  });
  await expect(five).not.toHaveClass(/pending/);
  const computedColor = await nodeColor(five);
  expect(computedColor).toBeDefined();
  expect(computedColor).not.toBe("var(--node-color-no-type)");

  // Pending again with no type info: the cached colour is shown, faded by `.pending`.
  await mockExpressionUpdate(page, "five", {
    type: [],
    payload: { type: "Pending" },
  });
  await expect(five).toHaveClass(/pending/);
  await expect.poll(() => nodeColor(five)).toBe(computedColor);
});
```

- [ ] **Step 2: Run it in WSL, where the suite can run**

The Windows checkout's `node_modules` holds Windows native binaries, so run the
test from the WSL clone `~/enso-b4`:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-b4 && git fetch /mnt/c/Repos/Enso/ide feature/node-appearance-cache && git checkout -f FETCH_HEAD && corepack pnpm install --frozen-lockfile && cd app/gui && corepack pnpm exec playwright install chromium && corepack pnpm run test:integration integration-test/project-view/nodeAppearanceCache.spec.ts'
```

Commit the spec file first (Step 4) so that `git fetch` sees it, or copy it
across. Expected: 1 passed.

To prove the test tests something, temporarily comment out the
`useNodeAppearanceCache(...)` line in `GraphEditor.vue` in the WSL clone and
re-run. The test must then fail at the last assertion, because the colour
reverts to `var(--node-color-no-type)`. Restore the line afterwards with
`git checkout -- .`.

- [ ] **Step 3: Run the neighbouring colour specs to check nothing regressed**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-b4/app/gui && for i in 1 2 3; do corepack pnpm run test:integration integration-test/project-view/coloringNodes.spec.ts integration-test/project-view/undoRedo.spec.ts integration-test/project-view/nodeAppearanceCache.spec.ts; done'
```

Expected: all pass on each of the 3 runs. Integration tests are timing-sensitive
(repo `CLAUDE.md`). If one fails, run the same spec on `develop` the same number
of times before attributing it to this change. `undoRedo.spec.ts` is included
because the cache writes must not add undo steps.

- [ ] **Step 4: Commit**

```bash
git add app/gui/integration-test/project-view/nodeAppearanceCache.spec.ts
git commit -m "Integration test: a pending node shows its cached colour"
```

---

### Task 8: Final verification, changelog, PR

**Files:**

- Modify: `CHANGELOG.md` (`# Next Release` → `#### Enso IDE`)

- [ ] **Step 1: Full checks on Windows**

```bash
cd app/ydoc-shared && corepack pnpm exec vitest run && corepack pnpm run typecheck
cd ../ydoc-server && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run lint
cd ../gui && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run lint
cd ../.. && corepack pnpm exec prettier --check $(git diff --name-only origin/develop -- '*.ts' '*.vue' '*.md')
```

Expected: all green. Prettier's `organize-imports` plugin misbehaves on Vue SFCs
only on Linux (#19). Also run the prettier check once in the WSL clone for the
two changed `.vue` files.

- [ ] **Step 2: Manual check in the dev IDE (optional but recommended)**

Open a real project in `corepack pnpm dev:gui` (or the locally built IDE) and
let it compute. Close and reopen it: nodes should appear in faded colours with
their icons before execution finishes. Check the saved `.enso` file's metadata
line for `cachedAppearance` entries. The file should not change again on reopen
when nothing is recomputed differently.

- [ ] **Step 3: Open the PR, then add the changelog entry with its number**

```bash
git push -u origin feature/node-appearance-cache
gh pr create --base develop --title "Show nodes in their last known colour and icon while a workflow first loads" --body-file <body file>
```

In the PR body, summarise the spec. Say which checks ran where (the unit tests
on Windows; Playwright in WSL). End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HtSCMjmJWC1DPtGWKF9UEx
```

Then add to `CHANGELOG.md` under `# Next Release` → `#### Enso IDE`, using the
PR number `NNN`:

```md
- [Components keep their colour and icon while a workflow is loading, instead of
  showing grey until they are computed.][NNN]
```

and the matching link definition in that section's link list:

```md
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

Commit and push, then request a Copilot review (the same call used for the
earlier PRs in this programme):

```bash
gh api -X POST repos/jdunkerley/enso/pulls/NNN/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```
