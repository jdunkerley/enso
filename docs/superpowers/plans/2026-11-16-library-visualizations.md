# Library Visualizations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A library ships Vue visualizations in a `visualizations/` folder; the
GUI compiles and offers them once the library loads. The Image visualization
moves from the GUI into `Standard.Image` as the pilot.

**Architecture:** Enso gets back `Id.Library library name`, and an `Image`
answers `Id.Library "Standard.Image" "Image"`. The GUI's run-time visualization
compiler (today only for the project's `visualizations/` folder) learns a
general address `enso-root:<rootId>/<path>` so it can read files from any
content root. The visualization store listens to `file/rootAdded`, watches each
library root's `visualizations/` folder through the same code path as the
project's, registers what compiles as
`{ kind: 'Library', name: '<namespace>.<name>' }`, makes a `get` for a library
visualization wait for the library (10 s), and maps the old saved
`Builtin "Image"` id to the library one.

**Tech Stack:** Enso standard library and its test framework (`expect_pinned`
goldens); TypeScript/Vue 3 in `app/gui` (`vue/compiler-sfc`, `sucrase`, web
worker), vitest, `@vue/test-utils`; GitHub Actions path filters.

**Spec:** `docs/superpowers/specs/2026-11-16-library-visualizations-design.md`
(approved by the owner 2026-11-16: approach A, live reload of library folders,
old `Builtin "Image"` ids remapped).

## Global Constraints

- One PR, branch `viz/library-visualizations`, worktree
  `C:\Repos\Enso\ide-libviz`. It is a feature: changelog entry under
  `#### Enso IDE` ("Libraries can provide their own visualizations"), before and
  after screenshots of an image node on the orphan `pr-screenshots` branch, and
  merge only on the owner's OK after an installer test. Never
  `gh pr merge --delete-branch` (the branch is checked out in a worktree).
- Never `git stash`. Never commit `.superpowers/`.
- Never run pnpm from WSL inside a Windows path. Enso builds run in WSL from a
  Linux-filesystem clone (`~/vizwork`), after `. ~/.enso-toolchain.sh`, synced
  with
  `git fetch -q /mnt/c/Repos/Enso/ide refs/heads/viz/library-visualizations:refs/remotes/local/viz/library-visualizations`.
- Avoid new Vector allocation in Enso wherever possible.
- GUI gate (from `app/gui`): `CI=true corepack pnpm exec vitest run <paths>`
  (without `CI=true` missing snapshots are written silently), then
  `corepack pnpm run typecheck` and `corepack pnpm run lint`.
- Enso lint:
  `enso --enable-static-analysis --hide-progress -Werror --compile <lib dir>`.
- A changed public Enso API needs its `docs/api` regenerated
  (`sbt "runEngineDistribution --no-ir-caches --docs=api --in-project <lib>"`)
  or written by hand to the same format; the Stdlib API check fails otherwise.
- `ENSO_UPDATE_PINNED=1` rewrites every golden a run reaches: copy back only the
  intended ones.
- Python on Windows writes CRLF in text mode: use `newline=''`.

## File map

| File                                                                                      | Change                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`                           | `Id.Library`, JSON for both constructors; delete `Id.image`                |
| `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/Id.md`                        | API snapshot                                                               |
| `distribution/lib/Standard/Image/0.0.0-dev/src/Image.enso`                                | `Id.from (that:Image) = Id.Library "Standard.Image" "Image"`               |
| `distribution/lib/Standard/Image/0.0.0-dev/visualizations/Image.vue`                      | moved from `app/gui/.../ImageBase64Visualization.vue`                      |
| `distribution/lib/Standard/{Visualization,Image}/0.0.0-dev/CLAUDE.md`                     | describe the library visualization                                         |
| `test/Visualization_Tests/src/Id_Spec.enso`, `data/pinned/default_image.json`             | new expectations                                                           |
| `app/ydoc-shared/src/languageServerTypes.ts`                                              | type `file/rootAdded`'s params                                             |
| `app/gui/src/project-view/stores/visualization/rootAddress.ts` (new)                      | `enso-root:` address build and parse                                       |
| `app/gui/src/project-view/stores/visualization/compileSfc.ts` (new)                       | the pure SFC → JS step, shared by the worker and the shipped-files test    |
| `app/gui/src/project-view/stores/visualization/compiler.ts`                               | use `compileSfc`                                                           |
| `app/gui/src/project-view/stores/visualization/compilerMessaging.ts`                      | read any root; one data reader per root                                    |
| `app/gui/src/project-view/stores/visualization/folderLoader.ts` (new)                     | watch one root's `visualizations/`, compile, register, unregister          |
| `app/gui/src/project-view/stores/visualization/movedVisualizations.ts` (new)              | old id → new id                                                            |
| `app/gui/src/project-view/stores/visualization/index.ts`                                  | use the loader for the project and each library; `get` waits for a library |
| `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts` | canonical id for the node's saved choice                                   |
| `app/gui/src/project-view/components/visualizations/ImageBase64Visualization.vue`         | deleted                                                                    |
| `.github/workflows/gui-changed-files.yml`                                                 | `distribution/lib/**/visualizations/**` in the first list                  |
| `CHANGELOG.md`                                                                            | entry                                                                      |

---

### Task 1: Enso — `Id.Library`, and an Image asks for the library's view

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/Id.md`
- Modify: `distribution/lib/Standard/Image/0.0.0-dev/src/Image.enso:582-587`
- Modify: `distribution/lib/Standard/Image/0.0.0-dev/CLAUDE.md:54`,
  `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md` (any mention of
  `Id.image` or "only builtin")
- Test: `test/Visualization_Tests/src/Id_Spec.enso`,
  `test/Visualization_Tests/data/pinned/default_image.json`

**Interfaces:**

- Produces: `Id.Library library:Text name:Text`; its `to_js_object` is
  `{"library": {"name": <library>}, "name": <name>}`. The GUI already parses
  this shape (`visualizationData.ts`, `raw.value.library.name`).

- [ ] **Step 1: Write the failing tests.** In `Id_Spec.enso` replace the
      `Visualization.Id.image` line of the first spec and the Image spec:

```enso
    group_builder.specify "serializes a library visualization with its library" <|
        expected = JS_Object.from_pairs [["library", JS_Object.from_pairs [["name", "Standard.Image"]]], ["name", "Image"]]
        (Id.Library "Standard.Image" "Image").to_json . should_equal expected.to_text

    group_builder.specify "converts an Image to the Image visualization of Standard.Image" <|
        Id.from (Image.from_vector [0, 0, 0, 0] rows=2 channels=1) . should_equal (Id.Library "Standard.Image" "Image")
```

and delete
`Visualization.Id.image.to_json . should_equal (json_for_name "Image")`.

- [ ] **Step 2: Run, expect failure.** In WSL (`~/vizwork`, synced, distribution
      built):
      `cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" "Serializable"`.
      Expected: the two new specs fail (`Id.Library` does not exist). Check
      tests actually ran (a filter matching nothing exits 0).

- [ ] **Step 3: Implement.** In `Id.enso`, add the constructor after `Builtin`
      and make `to_js_object` cover both; delete the `image` method and fix the
      doc of `to_js_object` (it no longer says `library` is always null):

```enso
    ## ---
       private: true
       ---
       A visualization shipped by a library in its `visualizations/` folder.
       `library` is the library's qualified name (`Standard.Image`); `name` is
       the visualization's `name` export.
    Library library name

    ## ---
       private: true
       ---
       Serializes this ID to a JSON format understandable by the graphical
       interface: `library` is `null` for a builtin, else `{"name": library}`.
    to_js_object : JS_Object
    to_js_object self = case self of
        Id.Builtin name -> JS_Object.from_pairs [["library", Nothing], ["name", name]]
        Id.Library library name ->
            JS_Object.from_pairs [["library", JS_Object.from_pairs [["name", library]]], ["name", name]]
```

In `Image.enso`:

```enso
## ---
   private: true
   ---
   An image opens in the Image visualization that Standard.Image ships.
Id.from (that:Image) =
    _ = that
    Id.Library "Standard.Image" "Image"
```

- [ ] **Step 4: Update the golden and the API snapshot.** Run `Pinned_Spec` with
      `ENSO_UPDATE_PINNED=1`, copy back only `default_image.json` (expected:
      `{"library":{"name":"Standard.Image"},"name":"Image"}`). In `Id.md`
      replace `- image -> Standard.Base.Any.Any` with
      `- Library library:Standard.Base.Any.Any name:Standard.Base.Any.Any`,
      keeping the list sorted as the generator sorts it (constructors first, as
      `Builtin` is); regenerate with the sbt command if unsure.

- [ ] **Step 5: Run, expect pass.** `Visualization_Tests` whole (Id, Pinned) and
      `Image_Tests`; lint both libraries with the static-analysis command. Grep
      for leftovers: `git grep -n "Id\.image" -- distribution test engine` must
      be empty. Check `RuntimeVisualizationsTest.scala` ("be able to use
      external libraries…") does not use `Id.image`.

- [ ] **Step 6: Commit**
      `Visualization: Id.Library; an Image asks for Standard.Image's view`.

---

### Task 2: GUI — the compiler reads any content root

**Files:**

- Create: `app/gui/src/project-view/stores/visualization/rootAddress.ts`
- Create: `app/gui/src/project-view/stores/visualization/compileSfc.ts`
- Modify: `app/gui/src/project-view/stores/visualization/compiler.ts`
  (`importVue`, `importTS` use `compileSfc`/`compileTs`)
- Modify: `app/gui/src/project-view/stores/visualization/compilerMessaging.ts`
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/rootAddress.test.ts`,
  `__tests__/compileSfc.test.ts`

**Interfaces:**

- Produces:
  - `rootAddressProtocol = 'enso-root:'`
  - `rootAddress(rootId: Uuid, segments: readonly string[]): string` →
    `enso-root:<rootId>/<segments joined by '/'>`
  - `parseRootAddress(address: string): { rootId: Uuid; segments: string[] } | undefined`
  - `compileSfc(source: string, filename: string): { code: string; styles: string[]; id: string }`
    (throws on a compile error) and `compileTs(source: string): string`
  - `compile(address: string, data: DataServer): Promise<VisualizationModule>` —
    the `projectRoot` argument goes away; the root comes from the address, and
    the data reader is remembered per root id (a module-level
    `Map<Uuid, DataServer>` set on each call), fixing today's closure over the
    first call's root and reader.

- [ ] **Step 1: Write the failing tests.**

```ts
// rootAddress.test.ts
import { expect, test } from "vitest";
import { parseRootAddress, rootAddress } from "../rootAddress";

const ROOT = "6f9d2c1e-0000-4000-8000-000000000001" as Uuid;

test("an address round-trips", () => {
  const address = rootAddress(ROOT, ["visualizations", "Image.vue"]);
  expect(address).toBe(`enso-root:${ROOT}/visualizations/Image.vue`);
  expect(parseRootAddress(address)).toEqual({
    rootId: ROOT,
    segments: ["visualizations", "Image.vue"],
  });
});

test("a relative import resolves inside the same root", () => {
  const resolved = new URL(
    "./util/helper.ts",
    rootAddress(ROOT, ["visualizations", "Image.vue"]),
  ).href;
  expect(parseRootAddress(resolved)).toEqual({
    rootId: ROOT,
    segments: ["visualizations", "util", "helper.ts"],
  });
});

test("other addresses are not root addresses", () => {
  expect(parseRootAddress("https://example.com/a.vue")).toBeUndefined();
  expect(parseRootAddress("enso-root:not-a-uuid/a.vue")).toBeUndefined();
});
```

(Add `import type { Uuid } from 'ydoc-shared/languageServerTypes'`.) The worker
resolves imports with `new URL(dir + path, location.href)` (`compiler.ts:412`);
check the second test against that exact code and adapt the test to it rather
than the other way round. A non-special scheme needs a path that starts with `/`
for `./` resolution to work, so the address may need to be
`enso-root:/<rootId>/…`; pick whichever form makes both tests pass and use it
everywhere.

```ts
// compileSfc.test.ts
import { expect, test } from "vitest";
import { compileSfc } from "../compileSfc";

const SFC = `<script lang="ts">
export const name = 'Probe'
export const inputType = 'Standard.Base.Any.Any'
</script>
<script setup lang="ts">
const props = defineProps<{ data: { x: number } }>()
</script>
<template><span class="Probe">{{ props.data.x }}</span></template>
<style scoped>.Probe { color: red; }</style>`;

test("a visualization SFC compiles to JavaScript with its exports and scoped style", () => {
  const { code, styles } = compileSfc(SFC, "Probe.vue");
  expect(code).toContain("export const name = 'Probe'");
  expect(code).not.toContain("defineProps<");
  expect(styles).toHaveLength(1);
  expect(styles[0]).toMatch(/\.Probe\[data-v-[0-9a-f]+\]/);
});

test("a broken SFC throws", () => {
  expect(() =>
    compileSfc('<script setup lang="ts">const = </script>', "Bad.vue"),
  ).toThrow();
});
```

- [ ] **Step 2: Run, expect failure**
      (`CI=true corepack pnpm exec vitest run src/project-view/stores/visualization`):
      modules not found.

- [ ] **Step 3: Implement.** `compileSfc` is `importVue`'s middle lifted out
      unchanged in behaviour (`parse`, `hash(raw)` as the scope id,
      `compileStyle` per style, `compileScript` with `inlineTemplate: true`,
      then sucrase `transforms: ['typescript']`, `disableESTransforms: true`);
      `compileTs` is `importTS`'s sucrase call. `compiler.ts` calls them and
      keeps posting the same notifications. In `compilerMessaging.ts` replace
      the `currentProjectProtocol` case with a `rootAddressProtocol` case that
      uses `parseRootAddress` and the per-root reader; an unknown root posts the
      existing `fetch-worker-error`. Keep `stylePathAttribute` tagging with the
      full address. Remove `currentProjectProtocol` and update its users (Task 3
      changes `index.ts`; here, make `index.ts` compile with
      `rootAddress(projectRoot, ['visualizations', ...segments])` so the project
      folder keeps working).

- [ ] **Step 4: Run, expect pass**, plus `typecheck` and `lint`.

- [ ] **Step 5: Commit**
      `GUI: the visualization compiler reads any content root`.

---

### Task 3: GUI — library folders, waiting for a library, moved ids

**Files:**

- Modify: `app/ydoc-shared/src/languageServerTypes.ts:373` —
  `'file/rootAdded': (param: { root: ContentRoot }) => void`
- Create: `app/gui/src/project-view/stores/visualization/folderLoader.ts`
- Create: `app/gui/src/project-view/stores/visualization/movedVisualizations.ts`
- Modify: `app/gui/src/project-view/stores/visualization/index.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts`
  (where `selectedVis` is read)
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/folderLoader.test.ts`,
  `__tests__/movedVisualizations.test.ts`

**Interfaces:**

- Consumes: `rootAddress`, `compile(address, data)` from Task 2.
- Produces:
  - `watchVisualizationFolder(options: { ls: Pick<LanguageServer, 'watchFiles'>; rootId: Uuid; module: VisualizationIdentifier['module']; compile: (address: string) => Promise<VisualizationModule>; register: (id: VisualizationIdentifier, viz: Promise<VisualizationModule>, meta: VisualizationMetadata | undefined) => void; unregister: (id: VisualizationIdentifier) => void; quietIfMissing: boolean }): { unsubscribe(): void }`
    — the body of today's `onFileEvent`, generalised: per-path abort controllers
    and path → name map live inside one call; `.vue` files only;
    `Added`/`Modified` compile and register (re-keying when the `name` export
    changes), `Removed` unregisters and removes the file's style elements; a
    missing folder is silent when `quietIfMissing` (libraries) and logs today's
    info message otherwise (project).
  - `canonicalVisualizationId(id: VisualizationIdentifier): VisualizationIdentifier`
    — maps `{ module: { kind: 'Builtin' }, name: 'Image' }` to
    `{ module: { kind: 'Library', name: 'Standard.Image' }, name: 'Image' }`;
    anything else is returned as is.
  - `LIBRARY_WAIT_MS = 10_000`, exported from `index.ts` for tests.

- [ ] **Step 1: Write the failing tests.** `movedVisualizations.test.ts`:

```ts
import { expect, test } from "vitest";
import { canonicalVisualizationId } from "../movedVisualizations";

test("the old builtin Image id is read as the library one", () => {
  expect(
    canonicalVisualizationId({ module: { kind: "Builtin" }, name: "Image" }),
  ).toEqual({
    module: { kind: "Library", name: "Standard.Image" },
    name: "Image",
  });
});

test("other ids are unchanged", () => {
  const table = { module: { kind: "Builtin" }, name: "Table" } as const;
  expect(canonicalVisualizationId(table)).toBe(table);
});
```

`folderLoader.test.ts` drives `watchVisualizationFolder` with a fake
`watchFiles` that captures the callback, a `compile` stub that resolves to
`{ default: {}, name, inputType }` per address, and `register`/`unregister`
spies. Cases:

1. an `Added` event for `Image.vue` compiles
   `rootAddress(root, ['visualizations', 'Image.vue'])` and registers
   `{ module: { kind: 'Library', name: 'Standard.Image' }, name: 'Image' }` with
   its metadata;
2. a non-`.vue` file and an event for another root are ignored;
3. `Modified` recompiles; if the `name` export changed, the old id is
   unregistered and the new one registered;
4. `Removed` unregisters;
5. a second `Modified` arriving before the first compile finishes wins (the
   first is aborted and does not register);
6. a failing compile does not register and does not throw.

Before writing case 1, check what `path.segments` a later `file/event` carries
(the initial walk in `watchFiles` slices the watched prefix off,
`languageServer.ts:497-505`; a live event from the engine may carry the full
root-relative path). Write the test for what the code really receives, and
normalise in the loader so both shapes give the same file.

A store-level test (`__tests__/libraryVisualizations.test.ts`) with a mock
`ProjectStore` whose `lsRpcConnection` is an `ObservableV2` exposing
`watchFiles` and `contentRoots`: 7. a `file/rootAdded` with
`{ root: { type: 'Library', id, namespace: 'Standard', name: 'Image', version: '0.0.0-dev' } }`
starts a watch on that root; 8.
`get({ module: { kind: 'Library', name: 'Standard.Image' }, name: 'Image' })`
called before the root arrives resolves once it registers; 9. with fake timers,
the same `get` with no library rejects after `LIBRARY_WAIT_MS`; 10. `get` of the
old `Builtin "Image"` id resolves to the library module, and `icon` of it gives
the library's icon.

If a store-level mock is impractical, say so in the task report and cover 7–10
by extracting the waiting into a small pure helper
(`waitForRegistration(key, ms)`) with its own test.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement.** In `index.ts`:
  - replace `onFileEvent` and the project `watchFiles` call with
    `watchVisualizationFolder({ …, rootId: projectRoot, module: { kind: 'CurrentProject' }, quietIfMissing: false })`;
  - for every `Library` root in `await ls.contentRoots` and every later
    `file/rootAdded`, start one watcher (keyed by root id, so a repeated
    notification does not start two) with
    `module: { kind: 'Library', name: \`${root.namespace}.${root.name}\`
    }`and`quietIfMissing: true`; unsubscribe all watchers when the store's
    project connection is disposed, as the project watch is today;
  - `register`/`unregister` update `cache` and `metadata` exactly as today's
    `onFileEvent` does, and resolve any pending waiter for that id;
  - `get(meta)` first applies `canonicalVisualizationId`; the `Library` branch
    returns the cached promise if there is one, otherwise caches a waiter that
    resolves with the registered module or rejects after `LIBRARY_WAIT_MS` with
    `new Error(\`The library '${name}' has no visualization '${vizName}'.\`)`;
  - `icon` also applies `canonicalVisualizationId`. In `visualizationData.ts`,
    apply `canonicalVisualizationId` where the node's saved `selectedVis` is
    read, so the selector shows the library entry as the current one; the node's
    metadata is rewritten only when the user picks a visualization.

- [ ] **Step 4: Run, expect pass**, then the whole
      `src/project-view/stores/visualization` and
      `src/project-view/components/GraphEditor` unit folders, `typecheck`,
      `lint`.

- [ ] **Step 5: Commit**
      `GUI: library visualizations load from each library's visualizations/ folder`.

---

### Task 4: Move the Image visualization into Standard.Image

**Files:**

- Create (git mv):
  `distribution/lib/Standard/Image/0.0.0-dev/visualizations/Image.vue` from
  `app/gui/src/project-view/components/visualizations/ImageBase64Visualization.vue`
- Modify: `app/gui/src/project-view/stores/visualization/index.ts` (built-in
  list), `__tests__/availability.test.ts` if it imports the file
- Modify: `.github/workflows/gui-changed-files.yml` (first `files:` list only,
  beside `test/Visualization_Tests/data/pinned/tree_*.json`, with the comment
  extended to say why)
- Test:
  `app/gui/src/project-view/stores/visualization/__tests__/shippedVisualizations.test.ts`

**Interfaces:**

- Consumes: `compileSfc` (Task 2).

- [ ] **Step 1: Write the failing test.** It finds every shipped library
      visualization and checks it the way the IDE will load it:

```ts
import { mount } from "@vue/test-utils";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { compileSfc } from "../compileSfc";

const STANDARD = path.resolve(
  __dirname,
  "../../../../../../../distribution/lib/Standard",
);
const shipped = readdirSync(STANDARD).flatMap((lib) => {
  const dir = path.join(STANDARD, lib, "0.0.0-dev", "visualizations");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".vue"))
        .map((f) => ({ lib, file: path.join(dir, f) }))
    : [];
});

describe("visualizations shipped by the standard libraries", () => {
  test("Standard.Image ships the Image visualization", () => {
    expect(shipped.map((s) => `${s.lib}/${path.basename(s.file)}`)).toContain(
      "Image/Image.vue",
    );
  });

  test.each(shipped)(
    "$lib/$file compiles with the run-time compiler",
    ({ file }) => {
      expect(() =>
        compileSfc(readFileSync(file, "utf8"), path.basename(file)),
      ).not.toThrow();
    },
  );
});

test("the Image visualization shows the image it is given", async () => {
  const Image =
    (await import("../../../../../../../distribution/lib/Standard/Image/0.0.0-dev/visualizations/Image.vue")) as any;
  expect(Image.name).toBe("Image");
  expect(Image.inputType).toBe("Standard.Image.Image.Image");
  const wrapper = mount(Image.default, {
    props: { data: { mediaType: "image/png", base64: "AAAA" } },
  });
  expect(wrapper.find("img").attributes("src")).toBe(
    "data:image/png;base64,AAAA",
  );
});
```

If vite refuses the import from outside `app/gui` (`server.fs.allow`), add the
repository's `distribution/lib` to the vitest config's `fs.allow`, not a copy of
the file. If a shipped visualization imports `builtins`, add a vitest alias
`builtins` → `@/util/visualizationBuiltins` so the mount works.

- [ ] **Step 2: Run, expect failure** (no shipped file yet).

- [ ] **Step 3: Move the file** with `git mv`, unchanged except its header
      comment if any; remove the import and list entry in `index.ts`; adjust any
      test that imported the old path. Add the workflow path.

- [ ] **Step 4: Run, expect pass**: the whole `src/project-view` unit suite,
      `typecheck`, `lint`, and `node tools/ci/check-workflows.mjs` (Workflow
      Lint).

- [ ] **Step 5: Commit**
      `Image: the Image visualization ships with Standard.Image`.

---

### Task 5: Docs, changelog, end-to-end proof, PR

**Files:**

- Modify: `CHANGELOG.md` (`# Next Release` → `#### Enso IDE`,
  `- [Libraries can provide their own visualizations][NNN]` plus link
  definition)
- Modify: `app/gui/src/project-view/stores/visualization/` CLAUDE.md if present
  (else create one per the project-structure skill) describing project and
  library folders, the address, the wait, moved ids
- Modify: `distribution/lib/Standard/Image/0.0.0-dev/CLAUDE.md` (the
  `visualizations/` folder and how the GUI loads it)

- [ ] **Step 1: Real-engine check in WSL.** Build the distribution in
      `~/vizwork` from the branch; confirm the built
      `built-distribution/.../lib/Standard/Image/0.0.0-dev/visualizations/Image.vue`
      exists (packaging keeps it). Start the IDE's GUI dev server against it
      only if a quick check is possible; otherwise rely on step 3.
- [ ] **Step 2: Docs and changelog**; `prettier --check` on the Markdown.
- [ ] **Step 3: Open the PR** (body: what moves, how a library ships a
      visualization, test evidence, "Closes" nothing unless a ticket exists),
      link it, wait for CI green. Use the CI IDE packaging artifact as the
      installer (the PR changes the engine side, so CI builds its own backend).
- [ ] **Step 4: Screenshots**: an image node before (develop) and after (PR),
      pushed to `pr-screenshots`, embedded in the PR.
- [ ] **Step 5: Hand to the owner** with the installer link and checklist:
  1. an image node opens in the Image view, and the view picker lists Image;
  2. a project saved before the change (image node with the old view) opens it;
  3. a local library under `~/enso/libraries` with a `visualizations/` folder:
     its visualization appears once imported, and editing the `.vue` file
     updates the open view. Merge only on the owner's OK, without
     `--delete-branch`.

## After this PR (owner: "if all works well with the image")

Separate plans, same route: SQL Query view → `Standard.Database` (`SQL_Viz.enso`
data stays in Visualization or moves with it — decide in that plan), Geo Map →
`Standard.Geo` (it loads deck.gl through `scripts`; check the run-time compiler
handles its imports and the `d3` built-in module).
