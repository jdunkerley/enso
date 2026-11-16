# MCP `get_visualization` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent connected over MCP can look at a node's visualization: as a
PNG of what the user sees (`image`, the default) or as the JSON the view was
given (`data`).

**Architecture:** `get_visualization` is the first tool whose `run` does work in
Electron main. For `data` it forwards to the window. For `image` it asks the
window to get the visualization ready (show it if hidden, bring it into view,
wait until it has drawn) and to answer with its rectangle; main then captures
that rectangle with `webContents.capturePage` and returns a PNG. The window
finds a node's visualization through a small registry that each mounted
`GraphVisualization` writes itself into.

**Tech Stack:** TypeScript, Vue 3, Electron (`capturePage`, `NativeImage`),
`@modelcontextprotocol/sdk` 1.30, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`. The
owner approved this tool on 2026-11-15 as an addition to it: "Let's do both
please" (both formats), its own PR after the edit tools.

## Global Constraints

- `corepack pnpm` only. Work in `C:\Repos\Enso\ide-mcp`, branch
  `feature/mcp-get-visualization`.
- Tool argument names are snake_case on the wire (`node_id`, `format`).
- The Write button is never reachable from MCP. This tool adds no way to run
  code: it must not call `evaluate`, `executeExpression` or
  `updatePreprocessor`.
- The edit rules hold for the one edit this tool can make (showing a hidden
  visualization): it goes through the `EditSession` exactly as
  `set_visualization` does, so it is refused in Live mode and joins the caller's
  undo step.
- Tools answer only for the project tab on screen (already true of every project
  handler; do not register handlers anywhere else).
- A tool result is JSON text made with `jsonResult`; errors are plain sentences
  made with `toolError`.
- Only main produces images. The window never sends one.
- Every exported symbol has a doc comment; follow the `typescript-guidelines`
  skill. No `as unknown as` on Electron or SDK types.
- Each commit message ends with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- One writer in the worktree at a time (lint-staged stashes on commit).

## Decisions already taken

- **The view moves only when it must.** For `image`, the window pans (no
  animation) only if the visualization is not wholly inside the graph viewport
  or the graph is zoomed out below 100%. It is not moved back afterwards. The
  tool description says so.
- **A fullscreen visualization is captured as it is**, without panning.
- **A Ctrl-hover preview is not a visualization** for this tool: previews never
  register.
- `data` needs no panning: every node of the method is mounted (`GraphNodes.vue`
  renders all of `graph.db.nodeIdToNode`).
- PNG at most 1200 px on its long side. `data` at most 20,000 characters.
- Waiting for a visualization to draw is capped at 15 s.

## File Structure

| File                                                                                      | Responsibility                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `app/common/src/mcp.ts`                                                                   | `McpToolResult` gains an optional `image`.                                                |
| `app/electron-client/src/mcp/mcpServer.ts`                                                | Maps `image` to an MCP image content item.                                                |
| `app/electron-client/src/mcp/visualizationTool.ts` (new)                                  | The `get_visualization` definition, the capture step, PNG sizing. No `electron` import.   |
| `app/electron-client/src/electron.ts`                                                     | Registers the tool with a capture function over the window.                               |
| `app/gui/src/project-view/mcp/visualizationRegistry.ts` (new)                             | Which visualizations are mounted, by project and node.                                    |
| `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts` | Exposes `status`.                                                                         |
| `app/gui/src/project-view/components/GraphEditor/GraphVisualization.vue`                  | Registers itself.                                                                         |
| `app/gui/src/project-view/mcp/visualizationTools.ts` (new)                                | The window handlers `get_visualization_data` and `prepare_visualization`, pure over deps. |
| `app/gui/src/project-view/mcp/useProjectMcpTools.ts`, `GraphEditor.vue`                   | Wiring.                                                                                   |

---

### Task 1: A tool result can carry an image

**Files:**

- Modify: `app/common/src/mcp.ts:7-8`
- Modify: `app/electron-client/src/mcp/mcpServer.ts:135-145`
- Test: `app/electron-client/tests/headless/mcpServer.test.ts`

**Interfaces:**

- Produces: `McpImage { readonly data: string; readonly mimeType: string }`
  (`data` is base64) and
  `McpToolResult = { ok: true; value: string; image?: McpImage } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test.** In `mcpServer.test.ts`, inside
      `describe('McpHttpServer', …)`, next to the existing test that calls a
      registered tool (read the `beforeEach` there for how `registry`, `server`
      and `client` are made, and register the tool before the server starts the
      way that test does):

```ts
test("a result with an image is an image item followed by its text", async () => {
  registry.register({
    name: "picture",
    title: "Picture",
    description: "Returns an image.",
    inputSchema: {},
    run: async () => ({
      ok: true,
      value: '{"width":1}',
      image: { data: "AAAA", mimeType: "image/png" },
    }),
  });
  const result = await connect().then((c) =>
    c.callTool({ name: "picture", arguments: {} }),
  );
  expect(result.isError).toBeFalsy();
  expect(result.content).toEqual([
    { type: "image", data: "AAAA", mimeType: "image/png" },
    { type: "text", text: '{"width":1}' },
  ]);
});
```

`connect()` stands for whatever the neighbouring tests use to get a connected
client; use theirs.

- [ ] **Step 2: Run it, expect a type error or a one-item `content`.**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/mcpServer.test.ts`

- [ ] **Step 3: Implement.** In `app/common/src/mcp.ts`:

```ts
/** An image a tool returns beside its text. Only Electron main produces one. */
export interface McpImage {
  /** The image's bytes, base64. */
  readonly data: string;
  readonly mimeType: string;
}

export type McpToolResult =
  | { readonly ok: true; readonly value: string; readonly image?: McpImage }
  | { readonly ok: false; readonly error: string };
```

In `mcpServer.ts`, replace the `return result.ok ? … : …` of the tool callback:

```ts
if (!result.ok) {
  return {
    content: [{ type: "text" as const, text: result.error }],
    isError: true,
  };
}
const text = { type: "text" as const, text: result.value };
// The image first: clients show content in order, and the text describes the image.
return result.image == null
  ? { content: [text] }
  : {
      content: [
        {
          type: "image" as const,
          data: result.image.data,
          mimeType: result.image.mimeType,
        },
        text,
      ],
    };
```

Leave `windowBridge.ts` `isReply` as it is: a window reply never has an image,
and an extra property is ignored.

- [ ] **Step 4: Run the test file, expect all pass. Run
      `corepack pnpm --filter enso run typecheck` and
      `corepack pnpm --filter enso-gui run typecheck`.**

- [ ] **Step 5: Commit** `MCP: a tool result can carry an image`.

---

### Task 2: Mounted visualizations register themselves

**Files:**

- Create: `app/gui/src/project-view/mcp/visualizationRegistry.ts`
- Test: `app/gui/src/project-view/mcp/__tests__/visualizationRegistry.test.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts`
  (the `return` at the end, and a new computed above it)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization.vue`
  (script setup, after `panelElement`/`isFullscreen` exist)

**Interfaces:**

- Produces:

```ts
export type VisualizationStatus = "loading" | "error" | "ready";
export interface VisualizationEntry {
  /** The panel: toolbar and content. Undefined before it is in the DOM. */
  readonly panel: () => HTMLElement | undefined;
  readonly status: () => VisualizationStatus;
  /** The visualization type's name, e.g. `Table`. */
  readonly name: () => string;
  /** What the view was given. Undefined while loading. */
  readonly data: () => unknown;
  readonly fullscreen: () => boolean;
}
export function registerVisualization(
  projectId: string,
  nodeId: string,
  entry: VisualizationEntry,
): () => void;
export function lookupVisualization(
  projectId: string,
  nodeId: string,
): VisualizationEntry | undefined;
```

- [ ] **Step 1: Write the failing tests** (`visualizationRegistry.test.ts`):

```ts
import { expect, test } from "vitest";
import {
  lookupVisualization,
  registerVisualization,
  type VisualizationEntry,
} from "../visualizationRegistry";

function entry(name: string): VisualizationEntry {
  return {
    panel: () => undefined,
    status: () => "ready",
    name: () => name,
    data: () => null,
    fullscreen: () => false,
  };
}

test("an entry is found by project and node until it is removed", () => {
  const remove = registerVisualization("p1", "n1", entry("Table"));
  expect(lookupVisualization("p1", "n1")?.name()).toBe("Table");
  expect(lookupVisualization("p2", "n1")).toBeUndefined();
  expect(lookupVisualization("p1", "n2")).toBeUndefined();
  remove();
  expect(lookupVisualization("p1", "n1")).toBeUndefined();
});

test("removing a replaced entry leaves its replacement", () => {
  const removeOld = registerVisualization("p1", "n1", entry("Old"));
  const removeNew = registerVisualization("p1", "n1", entry("New"));
  removeOld();
  expect(lookupVisualization("p1", "n1")?.name()).toBe("New");
  removeNew();
  expect(lookupVisualization("p1", "n1")).toBeUndefined();
});
```

- [ ] **Step 2: Run, expect "Cannot find module".**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp/__tests__/visualizationRegistry.test.ts`

- [ ] **Step 3: Implement the registry.**

```ts
/**
 * @file Which node visualizations are mounted, so that an MCP tool can find one by its node. A
 * visualization's data and its DOM live inside `GraphVisualization.vue`; each instance that shows
 * a node's visualization (not a Ctrl-hover preview) writes itself in here while it is mounted.
 */

/** Whether a visualization has drawn its data. */
export type VisualizationStatus = "loading" | "error" | "ready";

/** One mounted visualization, read when asked: every member reflects the moment of the call. */
export interface VisualizationEntry {
  /** The panel: toolbar and content. Undefined before it is in the DOM. */
  readonly panel: () => HTMLElement | undefined;
  readonly status: () => VisualizationStatus;
  /** The visualization type's name, e.g. `Table`. */
  readonly name: () => string;
  /** What the view was given. Undefined while loading. */
  readonly data: () => unknown;
  readonly fullscreen: () => boolean;
}

/** Entries by project id, then by node id. */
const projects = new Map<string, Map<string, VisualizationEntry>>();

/** Adds the entry, replacing one for the same node. Returns the function that removes it. */
export function registerVisualization(
  projectId: string,
  nodeId: string,
  entry: VisualizationEntry,
): () => void {
  let nodes = projects.get(projectId);
  if (nodes == null) projects.set(projectId, (nodes = new Map()));
  nodes.set(nodeId, entry);
  return () => {
    const current = projects.get(projectId);
    // A node's component can be replaced before the old one unmounts: only remove our own.
    if (current?.get(nodeId) !== entry) return;
    current.delete(nodeId);
    if (current.size === 0) projects.delete(projectId);
  };
}

/** The mounted visualization of the node, if it has one. */
export function lookupVisualization(
  projectId: string,
  nodeId: string,
): VisualizationEntry | undefined {
  return projects.get(projectId)?.get(nodeId);
}
```

- [ ] **Step 4: Run the test, expect pass.**

- [ ] **Step 5: Expose `status` from `useVisualizationData`.** In
      `visualizationData.ts`, after `effectiveVisualization` is defined:

```ts
/** Whether the view on screen is the real one, the loading one or the error one. */
const status = computed<VisualizationStatus>(() =>
  effectiveVisualization.value === LoadingErrorVisualization
    ? "error"
    : effectiveVisualization.value === LoadingVisualization
      ? "loading"
      : "ready",
);
```

Import `type VisualizationStatus` from `@/mcp/visualizationRegistry` and add
`status` to the returned object.

- [ ] **Step 6: Register from `GraphVisualization.vue`.** Take `status` from
      `useVisualizationData`. After `isFullscreen` is declared:

```ts
// === MCP ===

const currentProject = useCurrentProject();
// A node's visualization can be found by the MCP `get_visualization` tool while it is shown.
// A Ctrl-hover preview and the Component Browser's preview are not registered.
watch(
  () =>
    props.show && !props.isPreview && props.dataSource?.type === "node"
      ? props.dataSource.nodeId
      : undefined,
  (nodeId, _previous, onCleanup) => {
    if (nodeId == null) return;
    onCleanup(
      registerVisualization(currentProject.id.value, nodeId, {
        panel: () => panelElement.value,
        status: () => status.value,
        name: () => currentVisualization.value.name,
        data: () => effectiveVisualizationData.value,
        fullscreen: () => isFullscreen.value,
      }),
    );
  },
  { immediate: true },
);
```

Imports: `useCurrentProject` from `$/components/WithCurrentProject.vue`,
`registerVisualization` from `@/mcp/visualizationRegistry`. If
`useCurrentProject()` throws in an existing unit test that mounts this component
without a project, use `useCurrentProject(true)` and skip registration when it
is undefined; say which in the report.

- [ ] **Step 7: Verify.** `corepack pnpm --filter enso-gui run typecheck`; then
      the unit tests that mount visualizations:
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor src/project-view/mcp`.
      Expect pass.

- [ ] **Step 8: Commit** `MCP: mounted node visualizations register themselves`.

---

### Task 3: The window handlers

**Files:**

- Create: `app/gui/src/project-view/mcp/visualizationTools.ts`
- Test: `app/gui/src/project-view/mcp/__tests__/visualizationTools.test.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts` (`McpEditorDeps`,
  a `visualizationDeps` function, two handlers)
- Modify: `app/gui/src/project-view/components/GraphEditor.vue:282-298`
- Test: `app/gui/integration-test/project-view/mcpVisualization.spec.ts` (new)

**Interfaces:**

- Consumes: `lookupVisualization`, `VisualizationEntry` (Task 2);
  `setVisualization(deps: EditToolDeps, { node_id, visible })`, `toolError`
  (`editTools.ts`); `findNode`, `jsonResult` (`graphTools.ts`).
- Produces two window handlers (not MCP tools; main calls them):
  - `get_visualization_data { node_id }` → JSON
    `{ node_id, visualization, shown, truncated, data }`
  - `prepare_visualization { node_id }` → JSON
    `{ node_id, visualization, shown, moved, rect: { x, y, width, height } }`,
    `rect` in CSS pixels of the window's client area, whole numbers.
  - `shown`: this call switched the visualization on. `moved`: this call moved
    the view.

- [ ] **Step 1: Write the failing unit tests.**

```ts
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import { expect, test } from "vitest";
import type {
  VisualizationEntry,
  VisualizationStatus,
} from "../visualizationRegistry";
import {
  getVisualizationData,
  prepareVisualization,
  VISUALIZATION_DATA_CHARS,
  VISUALIZATION_WAIT_MS,
  type VisualizationToolDeps,
} from "../visualizationTools";

const NODE = "00000000-0000-0000-0000-000000000001";

interface Fake {
  shown: boolean;
  status: VisualizationStatus;
  data: unknown;
  rect: { left: number; top: number; right: number; bottom: number };
  scale: number;
  time: number;
  revealed: number;
  fullscreen: boolean;
  showResult: { ok: true; value: string } | { ok: false; error: string };
}

function fake(overrides: Partial<Fake> = {}): {
  state: Fake;
  deps: VisualizationToolDeps;
} {
  const state: Fake = {
    shown: true,
    status: "ready",
    data: { rows: [1, 2] },
    rect: { left: 100, top: 100, right: 300, bottom: 250 },
    scale: 1,
    time: 0,
    revealed: 0,
    fullscreen: false,
    showResult: { ok: true, value: "{}" },
    ...overrides,
  };
  const entry: VisualizationEntry = {
    panel: () => undefined,
    status: () => state.status,
    name: () => "Table",
    data: () => state.data,
    fullscreen: () => state.fullscreen,
  };
  const deps: VisualizationToolDeps = {
    findNode: (id) =>
      id === NODE
        ? { ok: true, value: id }
        : { ok: false, error: `No node ${id}` },
    lookup: () => (state.shown ? entry : undefined),
    isShown: () => state.shown,
    show: async () => {
      if (state.showResult.ok) state.shown = true;
      return state.showResult;
    },
    panelRect: () => state.rect,
    viewRect: () => ({ left: 0, top: 0, right: 1000, bottom: 800 }),
    scale: () => state.scale,
    reveal: () => {
      state.revealed++;
      state.scale = 1;
      state.rect = { left: 400, top: 325, right: 600, bottom: 475 };
    },
    viewMoving: () => false,
    nextFrame: async () => {
      state.time += 16;
    },
    now: () => state.time,
    deadline: 60_000,
  };
  return { state, deps };
}

function parsed(result: { ok: boolean; value?: string }) {
  expect(result.ok).toBe(true);
  return JSON.parse(result.value!);
}

test("data: the view data of a shown visualization", async () => {
  const { deps } = fake();
  expect(parsed(await getVisualizationData(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    visualization: "Table",
    shown: false,
    truncated: false,
    data: { rows: [1, 2] },
  });
});

test("data: text that is JSON is given parsed", async () => {
  const { deps } = fake({ data: '{"a":1}' });
  expect(
    parsed(await getVisualizationData(deps, { node_id: NODE })).data,
  ).toEqual({ a: 1 });
});

test("data: beyond the cap, the start of the text and truncated", async () => {
  const { deps } = fake({ data: "x".repeat(VISUALIZATION_DATA_CHARS + 5) });
  const value = parsed(await getVisualizationData(deps, { node_id: NODE }));
  expect(value.truncated).toBe(true);
  expect(value.data).toHaveLength(VISUALIZATION_DATA_CHARS);
});

test("a hidden visualization is shown first, and the result says so", async () => {
  const { deps, state } = fake({ shown: false });
  expect(
    parsed(await getVisualizationData(deps, { node_id: NODE })).shown,
  ).toBe(true);
  expect(state.shown).toBe(true);
});

test("a refusal to show it is the result", async () => {
  const { deps } = fake({
    shown: false,
    showResult: { ok: false, error: "Live mode" },
  });
  expect(await getVisualizationData(deps, { node_id: NODE })).toEqual({
    ok: false,
    error: "Live mode",
  });
});

test("an unknown node is refused", async () => {
  const { deps } = fake();
  expect((await getVisualizationData(deps, { node_id: "nope" })).ok).toBe(
    false,
  );
});

test("a visualization still loading after the wait is an error", async () => {
  const { deps, state } = fake({ status: "loading" });
  const result = await getVisualizationData(deps, { node_id: NODE });
  expect(result.ok).toBe(false);
  expect(state.time).toBeGreaterThanOrEqual(VISUALIZATION_WAIT_MS);
});

test("a visualization that failed is an error with its message", async () => {
  const { deps } = fake({
    status: "error",
    data: { name: "Table", error: new Error("boom") },
  });
  const result = await getVisualizationData(deps, { node_id: NODE });
  expect(result).toEqual({
    ok: false,
    error: "The visualization failed: boom",
  });
});

test("image: a visualization in view at 100% is not moved", async () => {
  const { deps, state } = fake();
  expect(parsed(await prepareVisualization(deps, { node_id: NODE }))).toEqual({
    node_id: NODE,
    visualization: "Table",
    shown: false,
    moved: false,
    rect: { x: 100, y: 100, width: 200, height: 150 },
  });
  expect(state.revealed).toBe(0);
});

test("image: one partly out of view is brought into view", async () => {
  const { deps, state } = fake({
    rect: { left: 900, top: 100, right: 1100, bottom: 250 },
  });
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }));
  expect(state.revealed).toBe(1);
  expect(value.moved).toBe(true);
  expect(value.rect).toEqual({ x: 400, y: 325, width: 200, height: 150 });
});

test("image: a zoomed-out graph is brought to 100%", async () => {
  const { deps, state } = fake({ scale: 0.4 });
  await prepareVisualization(deps, { node_id: NODE });
  expect(state.revealed).toBe(1);
});

test("image: a fullscreen visualization is not moved", async () => {
  const { deps, state } = fake({
    fullscreen: true,
    rect: { left: 0, top: 0, right: 1400, bottom: 900 },
  });
  const value = parsed(await prepareVisualization(deps, { node_id: NODE }));
  expect(state.revealed).toBe(0);
  expect(value.rect).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
});
```

- [ ] **Step 2: Run, expect "Cannot find module".**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp/__tests__/visualizationTools.test.ts`

- [ ] **Step 3: Implement `visualizationTools.ts`.**

```ts
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
/**
 * @file The window's half of the MCP `get_visualization` tool: `get_visualization_data` answers
 * with what a node's visualization was given, and `prepare_visualization` gets the visualization
 * ready to be photographed by Electron main and answers with where it is. Both show a hidden
 * visualization first, as `set_visualization` does. Pure functions over
 * {@link VisualizationToolDeps}.
 */
import type { McpToolResult } from "enso-common/src/mcp";
import { toolError } from "./editTools";
import { jsonResult } from "./graphTools";
import type { VisualizationEntry } from "./visualizationRegistry";

/** How long a visualization may take to draw before the tool gives up. */
export const VISUALIZATION_WAIT_MS = 15_000;
/** Most characters of view data returned. */
export const VISUALIZATION_DATA_CHARS = 20_000;
/** Left of the call's time for the reply to reach main. */
const REPLY_MARGIN_MS = 2_000;
/** Frames to wait after the view stops moving, for the visualization to repaint. */
const SETTLE_FRAMES = 2;

export const STILL_LOADING_ERROR =
  "The visualization is still loading. Wait for the node to finish computing and try again.";
export const NOT_ON_SCREEN_ERROR =
  "The visualization could not be brought on screen. Use format `data`.";

/** Edges in CSS pixels of the window's client area. */
export interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface VisualizationToolDeps {
  /** The node of that id in the method on screen. */
  readonly findNode: (
    nodeId: string,
  ) => { ok: true; value: string } | { ok: false; error: string };
  readonly lookup: (nodeId: string) => VisualizationEntry | undefined;
  /** Whether the node's visualization is switched on. */
  readonly isShown: (nodeId: string) => boolean;
  /** Switches it on as `set_visualization` does: through the edit session, with its refusals. */
  readonly show: (nodeId: string) => Promise<McpToolResult>;
  /** Where the node's visualization panel is; undefined when it is not in the DOM. */
  readonly panelRect: (nodeId: string) => Edges | undefined;
  /** The graph editor's viewport. */
  readonly viewRect: () => Edges;
  /** The graph's zoom: 1 is 100%. */
  readonly scale: () => number;
  /** Moves the view, without animation, so that the panel is in it at 100% where it fits. */
  readonly reveal: (nodeId: string) => void;
  /** Whether the view is still moving. */
  readonly viewMoving: () => boolean;
  /** Resolves on the next animation frame, or shortly after when the window draws none. */
  readonly nextFrame: () => Promise<void>;
  readonly now: () => number;
  /** When main stops waiting for the reply, in `now()` milliseconds. */
  readonly deadline: number;
}

type Ready =
  | { ok: true; nodeId: string; entry: VisualizationEntry; shown: boolean }
  | { ok: false; error: string };

/** Shows the node's visualization if it is hidden and waits until it has drawn its data. */
async function readyVisualization(
  deps: VisualizationToolDeps,
  nodeId: string,
): Promise<Ready> {
  const found = deps.findNode(nodeId);
  if (!found.ok) return found;
  let shown = false;
  if (!deps.isShown(found.value)) {
    const result = await deps.show(nodeId);
    if (!result.ok) return result;
    shown = true;
  }
  const until = Math.min(
    deps.now() + VISUALIZATION_WAIT_MS,
    deps.deadline - REPLY_MARGIN_MS,
  );
  for (;;) {
    const entry = deps.lookup(found.value);
    const status = entry?.status() ?? "loading";
    if (entry != null && status !== "loading") {
      const failure = failureOf(entry, status === "error");
      return failure != null
        ? { ok: false, error: `The visualization failed: ${failure}` }
        : { ok: true, nodeId: found.value, entry, shown };
    }
    if (deps.now() >= until) return { ok: false, error: STILL_LOADING_ERROR };
    await deps.nextFrame();
  }
}

/** Why the visualization shows an error instead of data; undefined when it shows data. */
function failureOf(
  entry: VisualizationEntry,
  errorView: boolean,
): string | undefined {
  const data = entry.data();
  if (typeof data === "object" && data != null && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (error instanceof Error) return error.message;
  }
  return errorView ? "it could not be loaded." : undefined;
}

/** What the node's visualization was given, capped at {@link VISUALIZATION_DATA_CHARS}. */
export async function getVisualizationData(
  deps: VisualizationToolDeps,
  args: { node_id: string },
): Promise<McpToolResult> {
  const ready = await readyVisualization(deps, args.node_id);
  if (!ready.ok) return toolError(ready.error);
  const data = ready.entry.data();
  let text: string;
  try {
    text = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    return toolError(
      "The data of this visualization cannot be written as JSON. Use format `image`.",
    );
  }
  const truncated = text.length > VISUALIZATION_DATA_CHARS;
  return jsonResult({
    node_id: ready.nodeId,
    visualization: ready.entry.name(),
    shown: ready.shown,
    truncated,
    data: truncated
      ? text.slice(0, VISUALIZATION_DATA_CHARS)
      : parsedOrText(data),
  });
}

/** Text that is JSON as its value, so that it is not quoted a second time; anything else as is. */
function parsedOrText(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/**
 * Gets the node's visualization ready to be captured and answers with its rectangle. The view is
 * moved only when the panel is not wholly in the viewport or the graph is zoomed out.
 */
export async function prepareVisualization(
  deps: VisualizationToolDeps,
  args: { node_id: string },
): Promise<McpToolResult> {
  const ready = await readyVisualization(deps, args.node_id);
  if (!ready.ok) return toolError(ready.error);
  const { nodeId, entry } = ready;
  let moved = false;
  if (!entry.fullscreen()) {
    const before = deps.panelRect(nodeId);
    if (before == null) return toolError(NOT_ON_SCREEN_ERROR);
    if (deps.scale() < 1 || !contains(deps.viewRect(), before)) {
      deps.reveal(nodeId);
      moved = true;
    }
  }
  // Also when nothing moved: a visualization that has just become ready has yet to paint.
  const until = deps.deadline - REPLY_MARGIN_MS;
  for (let still = 0; still < SETTLE_FRAMES;) {
    if (deps.now() >= until) return toolError(STILL_LOADING_ERROR);
    await deps.nextFrame();
    still = deps.viewMoving() ? 0 : still + 1;
  }
  const panel = deps.panelRect(nodeId);
  if (panel == null) return toolError(NOT_ON_SCREEN_ERROR);
  // A panel larger than the viewport even zoomed out is cut to what shows.
  const visible = entry.fullscreen()
    ? panel
    : intersection(panel, deps.viewRect());
  const x = Math.round(visible.left);
  const y = Math.round(visible.top);
  const width = Math.round(visible.right) - x;
  const height = Math.round(visible.bottom) - y;
  if (width <= 0 || height <= 0) return toolError(NOT_ON_SCREEN_ERROR);
  return jsonResult({
    node_id: nodeId,
    visualization: entry.name(),
    shown: ready.shown,
    moved,
    rect: { x, y, width, height },
  });
}

function contains(outer: Edges, inner: Edges): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

function intersection(a: Edges, b: Edges): Edges {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}
```

- [ ] **Step 4: Run the unit tests, expect pass.**

- [ ] **Step 5: Wire it.** In `useProjectMcpTools.ts`, add to `McpEditorDeps`:

```ts
/** The graph editor's viewport, in CSS pixels of the window's client area. */
readonly viewRect: () => Edges
/** The graph's zoom: 1 is 100%. */
readonly scale: () => number
/** Moves the view, without animation, to show this client rectangle at 100% where it fits. */
readonly revealClientRect: (rect: Edges) => void
/** Whether the view is still moving. */
readonly viewMoving: () => boolean
```

Add, beside `viewDeps`:

```ts
function visualizationDeps(
  caller: McpCaller,
  deadline: number,
): VisualizationToolDeps {
  const graph = currentProject.graph.value;
  const panelRect = (nodeId: string) =>
    lookupVisualization(currentProject.id.value, nodeId)
      ?.panel()
      ?.getBoundingClientRect();
  return {
    findNode: (nodeId) => {
      const found = findNode(graph.db, nodeId);
      return found.ok ? { ok: true, value: found.value.id } : found;
    },
    lookup: (nodeId) => lookupVisualization(currentProject.id.value, nodeId),
    isShown: (nodeId) =>
      graph.db.nodeIdToNode.get(nodeId as NodeId)?.vis?.visible ?? false,
    show: (nodeId) =>
      setVisualization(editDeps(caller, deadline), {
        node_id: nodeId,
        visible: true,
      }),
    panelRect,
    viewRect: editor.viewRect,
    scale: editor.scale,
    reveal: (nodeId) => {
      const rect = panelRect(nodeId);
      if (rect != null) editor.revealClientRect(rect);
    },
    viewMoving: editor.viewMoving,
    nextFrame,
    now: () => Date.now(),
    deadline,
  };
}
```

and at module level:

```ts
/** How long to wait for a frame before going on without one: a hidden window draws none. */
const FRAME_FALLBACK_MS = 100;

/** Resolves on the next animation frame, or after {@link FRAME_FALLBACK_MS} without one. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FRAME_FALLBACK_MS);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
```

Two handlers in `handlers`:

```ts
get_visualization_data: async (args, caller, deadline) => {
  const node_id = args.node_id
  if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
  return getVisualizationData(visualizationDeps(caller, deadline), { node_id })
},
prepare_visualization: async (args, caller, deadline) => {
  const node_id = args.node_id
  if (typeof node_id !== 'string') return invalidArgument('node_id', 'a string')
  return prepareVisualization(visualizationDeps(caller, deadline), { node_id })
},
```

Update the doc comment of `useProjectMcpTools` (it counts the tools) and
`viewTools.ts`'s file comment ("the only project tools that … move the view":
`prepare_visualization` now may).

In `GraphEditor.vue`, add to the `useProjectMcpTools({...})` call:

```ts
viewRect: () => viewportElem.value?.getBoundingClientRect() ?? new DOMRect(),
scale: () => graphNavigator.targetScale,
revealClientRect: (rect) =>
  graphNavigator.panAndZoomTo(
    graphNavigator.clientToSceneRect(
      Rect.FromBounds(rect.left, rect.top, rect.right, rect.bottom),
    ),
    0.1,
    1,
    true,
  ),
viewMoving: () => graphNavigator.transformChanging,
```

`panAndZoomTo` centres the rectangle and picks the largest scale in `[0.1, 1]`
at which it fits, so a panel smaller than the viewport ends at 100%.

- [ ] **Step 6: Typecheck** (`corepack pnpm --filter enso-gui run typecheck`).

- [ ] **Step 7: Integration spec against the mock.** Create
      `app/gui/integration-test/project-view/mcpVisualization.spec.ts`. Copy
      `deliver`, `ToolResult` and the project-opening `beforeEach` from
      `mcpEdit.spec.ts` (read it first; reuse its helpers rather than
      re-inventing them, extracting them to a shared file if that is cleaner).
      Find how other specs give a node visualization data in the mock (search
      `integration-test` for `mockExpressionUpdate` and the visualization
      helpers in `mock/lsHandler.ts`). Tests:

  1. `get_visualization_data` on a node whose visualization is hidden: `ok`,
     `shown: true`, the node's visualization is now visible in the DOM
     (`.GraphVisualization` inside `.GraphNode[data-node-id="<id>"]`), and one
     Ctrl+Z hides it again.
  2. `prepare_visualization` on that node: `ok`, and `rect` equals the
     `boundingBox()` of that node's `.VisualizationPanel` within 1 px on each
     edge.
  3. After zooming the graph out (mouse wheel with Ctrl over the graph, as other
     specs do), `prepare_visualization` answers `moved: true` and the panel's
     box is inside the viewport's.
  4. With the project in Live mode (see how `mcpEdit.spec.ts` sets it), a hidden
     visualization is refused and stays hidden; one already shown answers.

  No screenshot assertions.

- [ ] **Step 8: Run the spec three times.**

Run:
`corepack pnpm --filter enso-gui exec playwright test integration-test/project-view/mcpVisualization.spec.ts --repeat-each=3`

Expect all pass. A failure that appears in one run of three is a bug in the
waiting logic, not a flake to retry past: report it.

- [ ] **Step 9: Commit**
      `MCP: the window can ready a visualization and answer with its data`.

---

### Task 4: The tool in main

**Files:**

- Create: `app/electron-client/src/mcp/visualizationTool.ts`
- Test: `app/electron-client/tests/headless/mcpVisualizationTool.test.ts`
- Modify: `app/electron-client/src/electron.ts:99-108`

**Interfaces:**

- Consumes: `WindowBridge.call`, `EDIT_TOOL_TIMEOUT_MS`; the two window handlers
  of Task 3; `McpImage` of Task 1.
- Produces:

```ts
export const VISUALIZATION_TOOL_NAME = "get_visualization";
export const IMAGE_MAX_SIDE = 1200;
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The part of Electron's `NativeImage` the tool uses. */
export interface CapturedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: {
    width: number;
    height: number;
    quality: "best";
  }): CapturedImage;
  toPNG(): Buffer;
}
/** Captures that rectangle (CSS pixels of the client area); null when no window can be captured. */
export type Capture = (rect: CaptureRect) => Promise<CapturedImage | null>;
export function pngSize(
  png: Buffer,
): { width: number; height: number } | undefined;
export function visualizationTool(
  bridge: Pick<WindowBridge, "call">,
  capture: Capture,
): ToolDefinition;
```

- [ ] **Step 1: Write the failing tests.**

```ts
/** @file Tests for the `get_visualization` tool's main half (`src/mcp/visualizationTool.ts`). */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpCaller, McpToolResult } from "enso-common/src/mcp";
import { expect, test } from "vitest";
import {
  IMAGE_MAX_SIDE,
  pngSize,
  visualizationTool,
  type CapturedImage,
  type CaptureRect,
} from "../../src/mcp/visualizationTool";

const CALLER: McpCaller = { kind: "external", name: "test" };

/** A PNG header for an image of that size: the signature, then IHDR. */
function png(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** An image of `pixels` whose `getSize` is in units `factor` times coarser, as on a HiDPI screen. */
function image(width: number, height: number, factor = 1): CapturedImage {
  return {
    isEmpty: () => width === 0,
    getSize: () => ({ width: width / factor, height: height / factor }),
    resize: (options) =>
      image(options.width * factor, options.height * factor, factor),
    toPNG: () => png(width, height),
  };
}

function tool(
  window: (tool: string, args: Record<string, unknown>) => McpToolResult,
  captured: CapturedImage | null = image(200, 150),
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const rects: CaptureRect[] = [];
  const definition = visualizationTool(
    {
      call: async (name, args) => {
        calls.push({ tool: name, args });
        return window(name, args);
      },
    },
    async (rect) => {
      rects.push(rect);
      return captured;
    },
  );
  return { definition, calls, rects };
}

const PREPARED: McpToolResult = {
  ok: true,
  value: JSON.stringify({
    node_id: "n",
    visualization: "Table",
    shown: false,
    moved: true,
    rect: { x: 10, y: 20, width: 200, height: 150 },
  }),
};

test("pngSize reads the IHDR size, and nothing from other bytes", () => {
  expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  expect(pngSize(Buffer.from("not a png"))).toBeUndefined();
});

test("data is forwarded to the window", async () => {
  const data: McpToolResult = { ok: true, value: '{"data":1}' };
  const { definition, calls, rects } = tool(() => data);
  expect(
    await definition.run({ node_id: "n", format: "data" }, CALLER),
  ).toEqual(data);
  expect(calls).toEqual([
    { tool: "get_visualization_data", args: { node_id: "n" } },
  ]);
  expect(rects).toEqual([]);
});

test("image is the default: the prepared rectangle is captured", async () => {
  const { definition, calls, rects } = tool(() => PREPARED);
  const result = await definition.run({ node_id: "n" }, CALLER);
  expect(calls).toEqual([
    { tool: "prepare_visualization", args: { node_id: "n" } },
  ]);
  expect(rects).toEqual([{ x: 10, y: 20, width: 200, height: 150 }]);
  expect(result).toEqual({
    ok: true,
    value: JSON.stringify(
      {
        node_id: "n",
        visualization: "Table",
        shown: false,
        moved: true,
        width: 200,
        height: 150,
      },
      null,
      1,
    ),
    image: { data: png(200, 150).toString("base64"), mimeType: "image/png" },
  });
});

test("the window's refusal is the result, and nothing is captured", async () => {
  const refusal: McpToolResult = { ok: false, error: "No node n" };
  const { definition, rects } = tool(() => refusal);
  expect(await definition.run({ node_id: "n" }, CALLER)).toEqual(refusal);
  expect(rects).toEqual([]);
});

test("a large capture is scaled down to the cap", async () => {
  const { definition } = tool(() => PREPARED, image(2400, 1200));
  const result = await definition.run({ node_id: "n" }, CALLER);
  if (!result.ok) throw new Error(result.error);
  expect(pngSize(Buffer.from(result.image!.data, "base64"))).toEqual({
    width: IMAGE_MAX_SIDE,
    height: 600,
  });
});

test("a HiDPI capture is capped by its pixels, not its logical size", async () => {
  // 1000 x 500 logical at 2x is 2000 x 1000 pixels.
  const { definition } = tool(() => PREPARED, image(2000, 1000, 2));
  const result = await definition.run({ node_id: "n" }, CALLER);
  if (!result.ok) throw new Error(result.error);
  expect(pngSize(Buffer.from(result.image!.data, "base64"))).toEqual({
    width: IMAGE_MAX_SIDE,
    height: 600,
  });
});

test("no capture is an error that names the other format", async () => {
  for (const captured of [null, image(0, 0)]) {
    const { definition } = tool(() => PREPARED, captured);
    const result = await definition.run({ node_id: "n" }, CALLER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("format `data`");
  }
});

test("a reply without a rectangle is an error", async () => {
  const { definition, rects } = tool(() => ({
    ok: true,
    value: '{"rect":{"x":"a"}}',
  }));
  expect((await definition.run({ node_id: "n" }, CALLER)).ok).toBe(false);
  expect(rects).toEqual([]);
});
```

- [ ] **Step 2: Run, expect "Cannot find module".**

Run:
`corepack pnpm --filter enso exec vitest run tests/headless/mcpVisualizationTool.test.ts`

- [ ] **Step 3: Implement `visualizationTool.ts`.**

```ts
/**
 * @file The `get_visualization` tool: what a node's visualization shows, as a picture or as the
 * data the view was given. Unlike the other project tools its `run` does part of the work here in
 * main: the window gets the visualization ready and says where it is, and main captures that
 * rectangle of the window. It does not import `electron`: the caller supplies the capture.
 */
/* eslint-disable camelcase -- tool argument names are snake_case on the wire */
import type { McpToolResult } from "enso-common/src/mcp";
import { z } from "zod";
import type { ToolDefinition } from "./toolRegistry";
import { EDIT_TOOL_TIMEOUT_MS, type WindowBridge } from "./windowBridge";

export const VISUALIZATION_TOOL_NAME = "get_visualization";
/** Most pixels of the image's longer side. */
export const IMAGE_MAX_SIDE = 1200;
/** Most characters of a node id. */
const NAME_CHARS = 200;

const NO_CAPTURE_ERROR =
  "The Enso window could not be captured (it may be minimised or hidden). Use format `data`.";

/** A rectangle in CSS pixels of the window's client area. */
export interface CaptureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The part of Electron's `NativeImage` the tool uses. */
export interface CapturedImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: {
    width: number;
    height: number;
    quality: "best";
  }): CapturedImage;
  toPNG(): Buffer;
}

/** Captures that rectangle of the window; null when there is no window to capture. */
export type Capture = (rect: CaptureRect) => Promise<CapturedImage | null>;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** The pixel size a PNG declares in its IHDR chunk; undefined when the bytes are not a PNG. */
export function pngSize(
  png: Buffer,
): { width: number; height: number } | undefined {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE))
    return undefined;
  if (png.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const preparedSchema = z.object({
  node_id: z.string(),
  visualization: z.string(),
  shown: z.boolean(),
  moved: z.boolean(),
  rect: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

/**
 * The PNG of the capture, at most {@link IMAGE_MAX_SIDE} pixels on its longer side. The size is
 * read from the PNG: `getSize` is in logical units, which are not pixels on a HiDPI screen.
 */
function cappedPng(
  image: CapturedImage,
): { png: Buffer; width: number; height: number } | null {
  let png = image.toPNG();
  let size = pngSize(png);
  if (size == null) return null;
  const longest = Math.max(size.width, size.height);
  if (longest > IMAGE_MAX_SIDE) {
    const logical = image.getSize();
    const ratio = IMAGE_MAX_SIDE / longest;
    png = image
      .resize({
        width: Math.max(1, Math.floor(logical.width * ratio)),
        height: Math.max(1, Math.floor(logical.height * ratio)),
        quality: "best",
      })
      .toPNG();
    size = pngSize(png);
    if (size == null) return null;
  }
  return { png, ...size };
}

/** The `get_visualization` tool over the window (`bridge`) and a way to photograph it. */
export function visualizationTool(
  bridge: Pick<WindowBridge, "call">,
  capture: Capture,
): ToolDefinition {
  return {
    name: VISUALIZATION_TOOL_NAME,
    title: "Look at a visualization",
    description:
      "Look at the visualization of the node `node_id` (from `get_graph`): the table, chart " +
      "or other view the user sees under the node. `format` is `image` (the default): a PNG " +
      "of the visualization as drawn, with `{ node_id, visualization, shown, moved, width, " +
      "height }`; or `data`: `{ node_id, visualization, shown, truncated, data }`, the data " +
      "the view was given (its shape belongs to the view and may change; at most 20,000 " +
      "characters, then `truncated` is true and `data` is the start of the text). A table " +
      "shows at most its first 1,000 rows either way. A hidden visualization is shown " +
      "first (`shown` true), as `set_visualization` does: that is refused in Live mode and " +
      "is part of your undo step; hide it again with `set_visualization` if the user did " +
      "not ask to see it. For `image` the graph view moves when the visualization is not " +
      "wholly on screen at 100% zoom (`moved` true), and the Enso window must not be " +
      "minimised. An error when the visualization is still loading after 15 seconds or " +
      "failed to load. To read values, prefer `get_node` or `evaluate_expression`; use " +
      "this to see what the user sees, such as a chart.",
    inputSchema: {
      node_id: z.string().max(NAME_CHARS),
      format: z.enum(["image", "data"]).optional(),
    },
    run: async (args, caller): Promise<McpToolResult> => {
      const node = { node_id: args.node_id };
      if (args.format === "data") {
        return bridge.call(
          "get_visualization_data",
          node,
          caller,
          EDIT_TOOL_TIMEOUT_MS,
        );
      }
      const prepared = await bridge.call(
        "prepare_visualization",
        node,
        caller,
        EDIT_TOOL_TIMEOUT_MS,
      );
      if (!prepared.ok) return prepared;
      let parsed;
      try {
        parsed = preparedSchema.safeParse(JSON.parse(prepared.value));
      } catch {
        parsed = undefined;
      }
      if (parsed == null || !parsed.success) {
        return {
          ok: false,
          error: "The Enso window did not say where the visualization is.",
        };
      }
      const { rect, ...about } = parsed.data;
      const image = await capture(rect);
      if (image == null || image.isEmpty())
        return { ok: false, error: NO_CAPTURE_ERROR };
      const capped = cappedPng(image);
      if (capped == null) return { ok: false, error: NO_CAPTURE_ERROR };
      return {
        ok: true,
        value: JSON.stringify(
          { ...about, width: capped.width, height: capped.height },
          null,
          1,
        ),
        image: { data: capped.png.toString("base64"), mimeType: "image/png" },
      };
    },
  };
}
```

Check the "first 1,000 rows" claim against the table visualization's
preprocessor before keeping that sentence; drop it if it is not true of the
current code.

- [ ] **Step 4: Run the tests, expect pass.**

- [ ] **Step 5: Register it in `electron.ts`.** In `initMcp`, share the window
      lookup between the bridge and the capture:

```ts
const mcpWindow = () =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
const bridge = new WindowBridge(
  () => mcpWindow()?.webContents ?? null,
  ipcMain,
);
```

and after the app tools:

```ts
registry.register(
  visualizationTool(bridge, async (rect) => {
    const window = mcpWindow();
    if (window == null || window.isDestroyed() || window.isMinimized())
      return null;
    // `capturePage` takes device-independent pixels; a zoomed page's CSS pixels are larger.
    const zoom = window.webContents.getZoomFactor();
    return window.webContents.capturePage({
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    });
  }),
);
```

`NativeImage` must be assignable to `CapturedImage` with no cast. If its
`resize` options type makes that fail, adjust `CapturedImage` to what
`NativeImage` really declares, not the call site.

- [ ] **Step 6: Typecheck** (`corepack pnpm --filter enso run typecheck`) and
      run all headless MCP tests:
      `corepack pnpm --filter enso exec vitest run tests/headless`.

- [ ] **Step 7: Commit** `MCP: get_visualization returns a picture or the data`.

---

### Task 5: Proof in the packaged app, guides and documentation

**Files:**

- Modify: `app/electron-client/tests/mcp.spec.ts`
- Modify: `app/electron-client/src/mcp/guides/overview.md` (and
  `instructions.md` if it lists tools)
- Modify: `app/electron-client/src/mcp/CLAUDE.md`,
  `app/gui/src/project-view/mcp/CLAUDE.md`, `app/gui/src/mcp/CLAUDE.md` if it
  lists handlers
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the finished tool.

- [ ] **Step 1: Extend the packaged-app spec.** Add `'get_visualization'` to the
      expected tool list (among "the project tools that read"). Add a helper
      beside `textOf`:

```ts
/** The image and the text of a tool result that is one image item and one text item. */
function imageOf(result: Awaited<ReturnType<Client["callTool"]>>): {
  png: Buffer;
  text: string;
} {
  const content = result.content as {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }[];
  expect(content.map((item) => item.type)).toEqual(["image", "text"]);
  expect(content[0]?.mimeType).toBe("image/png");
  return {
    png: Buffer.from(content[0]?.data ?? "", "base64"),
    text: content[1]?.text ?? "",
  };
}
```

In the test that builds a project
(`an MCP client builds a project from the dashboard`), after a node with a table
or vector value exists and has settled, add:

```ts
const picture = await call("get_visualization", { node_id: nodeIdOfThatNode });
expect(picture.isError, JSON.stringify(picture.content)).toBeFalsy();
const { png, text } = imageOf(picture);
const about = JSON.parse(text) as {
  shown: boolean;
  width: number;
  height: number;
};
expect(about.shown).toBe(true);
// A PNG: the signature, then the size the text states, within the cap.
expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
expect(png.readUInt32BE(16)).toBe(about.width);
expect(png.readUInt32BE(20)).toBe(about.height);
expect(about.width).toBeGreaterThan(100);
expect(Math.max(about.width, about.height)).toBeLessThanOrEqual(1200);
// Not one flat colour: a blank capture has no more than a handful of distinct bytes.
expect(new Set(png.subarray(33)).size).toBeGreaterThan(32);
await testInfo.attach("visualization.png", {
  body: png,
  contentType: "image/png",
});

const data = await call("get_visualization", {
  node_id: nodeIdOfThatNode,
  format: "data",
});
expect(data.isError, textOf(data)).toBeFalsy();
expect(JSON.parse(textOf(data))).toMatchObject({
  shown: false,
  truncated: false,
});
```

Use the variable the test already has for a node id, and add `testInfo` to that
test's arguments if it lacks it.

- [ ] **Step 2: Run it against a packaged build.** Read
      `app/electron-client/CLAUDE.md` and `tools/build-scripts/CLAUDE.md` for
      how the packaged tests are run locally (`ide-local` builds the installer;
      the Playwright project needs the unpacked app). Run `tests/mcp.spec.ts`
      and open the attached `visualization.png`: it must show the visualization,
      not a blank or black rectangle. The tests run with
      `ENSO_TEST_DISABLE_GPU=1`; whether `capturePage` works under software
      compositing is the open question of this plan. If the capture is blank or
      empty there, stop and report with the image: do not weaken the assertion.

- [ ] **Step 3: Guides.** In `guides/overview.md`, where `set_visualization` is
      described, add `get_visualization` in the same style: what the two formats
      give, that `image` may move the view and show a hidden visualization, and
      that `get_node`/`evaluate_expression` are better for reading values. Run
      `corepack pnpm --filter enso exec vitest run tests/headless/mcpGuides.test.ts`.

- [ ] **Step 4: CLAUDE.md files.** Record: the tool and its two-step image path
      (window readies, main captures); that only main produces images; the
      registry and who writes to it; that the window handlers
      `get_visualization_data` and `prepare_visualization` are not MCP tools;
      the limits (1200 px, 20,000 characters, 15 s); that the capture is cut to
      the graph viewport but a docked panel drawn over the graph is not
      detected.

- [ ] **Step 5: Changelog.** Under `# Next Release` → `#### Enso IDE`, beside
      the other MCP entries, with the PR number once the PR exists:

```md
- [Agents connected over MCP can look at a node's visualization, as a picture or
  as its data.][NNN]
```

and the link definition `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` in
numeric order with the others.

- [ ] **Step 6: Whole-change checks.**

```bash
corepack pnpm --filter enso-gui run typecheck
corepack pnpm --filter enso run typecheck
corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp src/mcp
corepack pnpm --filter enso exec vitest run tests/headless
corepack pnpm exec prettier --check docs/superpowers/plans/2026-11-16-mcp-get-visualization.md CHANGELOG.md app/electron-client/src/mcp app/gui/src/project-view/mcp
corepack pnpm --filter enso-gui exec eslint src/project-view/mcp src/project-view/components/GraphEditor/GraphVisualization.vue
corepack pnpm --filter enso exec eslint src/mcp tests/headless/mcpVisualizationTool.test.ts
```

Then the Linux half in WSL (`. ~/.enso-toolchain.sh`), from a fresh clone of the
branch on the Linux filesystem that is deleted afterwards: the two Vitest
commands and `mcpVisualization.spec.ts` with `--repeat-each=3`.

- [ ] **Step 7: Commit**
      `MCP: get_visualization in the guides and the packaged test`.

---

## Not in this PR

- Restoring the view after an `image` capture.
- Choosing the visualization's size from MCP.
- Detecting a docked panel drawn over the graph viewport.

---

### Task 6: List a node's visualizations and choose one

Added on the owner's request (2026-11-16): "It would be nice if the agent could
ask for a list of available vizzes and then get any specified one."

**Files:**

- Modify: `app/gui/src/project-view/mcp/visualizationTools.ts` and its test
- Create: `app/gui/src/project-view/mcp/panelQuiet.ts` and
  `__tests__/panelQuiet.test.ts` (move `domQuiet`/`openShadowRoots` out of
  `useProjectMcpTools.ts`)
- Modify: `app/gui/src/project-view/mcp/editTools.ts`
  (`EditToolDeps.setVisualization`, `setVisualization`),
  `useProjectMcpTools.ts`, `GraphEditor.vue`
- Modify: `app/electron-client/src/mcp/visualizationTool.ts`, `projectTools.ts`,
  and their headless tests
- Modify: `app/gui/integration-test/project-view/mcpVisualization.spec.ts`,
  `app/electron-client/tests/mcp.spec.ts`
- Modify: `app/electron-client/src/mcp/guides/overview.md`, the two
  `mcp/CLAUDE.md` files, `CHANGELOG.md`

**Behaviour:**

1. **`list_visualizations { node_id }`**, a new MCP tool (a plain forward to the
   window, `WINDOW_TOOL_TIMEOUT_MS`, listed in `VIEW_TOOL_NAMES`). It shows
   nothing, moves nothing and edits nothing, and works in Live mode. It returns
   `{ node_id, shown, visualization, available }`:
   - `available`: the names of the visualizations the node's type offers, in the
     order of the toolbar's dropdown (the visualization store's `byType` for the
     node's type info, the same source as `allVisualizations` in
     `GraphVisualization/visualizationData.ts`).
   - `shown`: whether the node's visualization is switched on.
   - `visualization`: the name of the one on screen (from the registry entry),
     or null when none is mounted.
2. **`get_visualization` gains `visualization?: string`** (at most 100
   characters), a name from `available`, for both formats.
   - A name the node does not offer is refused before anything is shown or
     changed, with the error:
     ``The node has no visualization `X`. Available: A, B, C.``
   - When the name is not the one on screen (or the visualization is hidden),
     the node is switched to it in **one** edit through the `EditSession`
     (visible and identifier together), exactly as choosing it in the toolbar
     writes the node's metadata. It stays switched. Refused in Live mode with
     the edit rules' usual error; in Live a request for the visualization
     already on screen still answers.
   - The wait for "drawn" must then be for **that** visualization: ready only
     when the registry entry's `name()` equals the requested name and its status
     is not `loading`. Without this the old view's `ready` would be answered.
   - Two visualizations of the same name from different modules: take the first
     in `available` order (the dropdown's), and say so in a code comment.
3. **Every `get_visualization` result gains** `available` (as above) and
   `changed` (true when this call switched the visualization type). Main's
   `preparedSchema` accepts and passes them through; the image text becomes
   `{ node_id, visualization, shown, changed, moved, available, width, height }`,
   and the data result
   `{ node_id, visualization, shown, changed, truncated, available, data }`.
4. **Tool descriptions**: `get_visualization` says to call `list_visualizations`
   (or read `available` from a result) for the names, and that naming one
   switches the node to it and it stays switched (part of the undo step; refused
   in Live). `set_visualization` is unchanged.

**How:**

- `VisualizationToolDeps` gains `availableNames(nodeId: string): string[]`, and
  `show` becomes
  `show(nodeId: string, visualization?: string): Promise<McpToolResult>`
  (switches it on, and to that visualization when one is named). The
  name-to-identifier lookup is done in `useProjectMcpTools.ts`.
- `McpEditorDeps` gains
  `visualizationsFor: (nodeId: NodeId) => VisualizationIdentifier[]`, supplied
  by `GraphEditor.vue` from the store it provides (`provideVisualizationStore`)
  and the node's type info (find how `GraphNode.vue` gets
  `expressionInfo.typeInfo`).
- `EditToolDeps.setVisualization(id, visible, identifier?)` passes
  `{ visible, ...(identifier ? { identifier } : {}) }` to
  `graph.setNodeVisualization`; `setVisualization(deps, args)` accepts an
  optional `identifier`. The `set_visualization` MCP tool's behaviour and result
  do not change.

**Carried fixes from Task 5's review (do them here):**

- Bound the quiet wait by the call's deadline: `panelQuiet(nodeId, budgetMs)`
  with `budgetMs = Math.max(0, until - now())`; the cap is
  `Math.min(PANEL_QUIET_CAP_MS, budgetMs)`.
- In the moved `panelQuiet.ts`: also observe a shadow root that appears on a
  node added after observation started.
- Unit-test `panelQuiet.ts` with fake timers: a mutation inside a shadow root
  restarts the quiet period; continuous mutation ends at the cap; a disconnected
  or missing panel resolves at once; the budget caps the wait.
- Re-wrap the over-long string in `projectTools.ts` (`select_nodes` description)
  to the file's ~100 columns.

**Tests (write the failing ones first):**

- `visualizationTools.test.ts`: `listVisualizations` (hidden node: `shown`
  false, `visualization` null, `available` listed, and `show` never called); an
  unknown name is refused with the list and nothing is shown; a named
  visualization that differs from the one on screen calls `show(nodeId, name)`
  once and the result has `changed: true`; the wait does not accept the old view
  (the fake keeps the old name for a few frames after `show`); the same name as
  on screen gives `changed: false` and no `show`; every result carries
  `available`.
- `editTools.test.ts`: `setVisualization` with an identifier passes it on in the
  same edit.
- `mcpVisualizationTool.test.ts`: `visualization` is forwarded to both window
  handlers; `changed` and `available` reach the image text.
- `mcpVisualization.spec.ts` (mock): `list_visualizations` on a hidden node
  lists names and leaves it hidden; `get_visualization_data` with another name
  from that list switches the panel (assert the DOM shows that visualization),
  and one Ctrl+Z restores the previous state; an unknown name is refused and
  nothing changes. Run with `--repeat-each=3`.
- `mcp.spec.ts` (packaged; rebuild with `ide-local`): `list_visualizations` in
  the tool list; on the `[1, 2, 3]` node `available` contains the name the first
  image call reported as `visualization`; pick another name from `available`,
  get the image, and assert `changed` true and that its PNG bytes differ from
  the table picture; a second call for the same name 3 s later returns identical
  bytes. Keep that picture in the sdd folder as `task6-other-viz.png` and look
  at it. Run the spec 3 times.

**Verification:** the Windows commands you ran for Task 5 Step 6, plus the two
Playwright runs above. Commit
`MCP: list a node's visualizations and get a chosen one`.
