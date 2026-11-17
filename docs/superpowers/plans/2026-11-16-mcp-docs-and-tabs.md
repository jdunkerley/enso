# MCP documentation, images and tab switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent connected over MCP can switch between open projects, read and
replace the documentation of the function on screen, and add an image to the
project for that documentation to show.

**Architecture:** Four new tools on the existing registry. `switch_project` is
an app tool in the window. `get_documentation` and `set_documentation` are
project tools in the window; the edit goes through the `EditSession`.
`add_image` runs in Electron main like `get_visualization`: main obtains the
image bytes (a file it reads and checks, or a capture of a visualization) and
hands them to the window, which stores them in the project's `images` folder the
way the documentation editor's own upload does.

**Tech Stack:** TypeScript, Vue 3, Electron, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`, section
"Amendment, 2026-11-16: no chat panel".

## Global Constraints

- `corepack pnpm` only. Work in `C:\Repos\Enso\ide-mcp`, branch
  `feature/mcp-docs-and-tabs` (stacked on `feature/mcp-get-visualization`, pull
  request #809).
- Tool argument names are snake_case on the wire.
- The Write button is never reachable from MCP. These tools add no way to run
  code: they must not call `evaluate`, `executeExpression` or
  `updatePreprocessor`.
- Every edit to the module goes through the `EditSession` (refused in Live mode,
  part of the caller's undo step, a version saved first), as `set_node_comment`
  does.
- Tools answer only for the project tab on screen.
- A tool result is JSON text made with `jsonResult`; errors are plain sentences
  made with `toolError`, saying what the agent can do next.
- An agent can never delete a project or a file, and `add_image` can never
  overwrite one.
- Every exported symbol has a doc comment. No `as unknown as` on Electron or SDK
  types.
- Each commit message ends with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- One writer in the worktree at a time.

---

### Task 1: `switch_project`

**Files:**

- Modify: `app/gui/src/mcp/appTools.ts`, `app/gui/src/mcp/useAppMcpTools.ts`,
  `app/gui/src/mcp/__tests__/appTools.test.ts`
- Modify: `app/electron-client/src/mcp/appTools.ts` (`APP_TOOL_NAMES`, the
  definition)
- Modify: `app/gui/integration-test/dashboard/mcpApp.spec.ts`

**Behaviour:**

- `switch_project { path }` (`path` at most 1,000 characters): brings the tab of
  an **already open** project on screen and answers `{ name, path }` once its
  project tools answer (reuse `openAndWait` / `whenProjectToolsActive`, with
  `WINDOW_TOOL_TIMEOUT_MS` in main).
- `path` is matched against the open projects exactly as `get_app_state` reports
  them (`open_projects[].path`). A path that is not an open project is refused:
  ``No open project has the path `X`. Open projects: A, B. Use `open_project` to open one that is closed.``
  (with "No project is open." when there are none).
- A project already on screen answers at once.
- It opens nothing and creates nothing: the path is only compared with the open
  projects, never resolved against the disk.
- The agent's open undo step in the project it leaves ends, as when the user
  changes tab (this already happens on deactivation; assert it stays true).
- Description: says to read `open_projects` from `get_app_state`, and that the
  project tools then work on the project switched to. `open_project`'s
  description keeps saying it also brings an open project on screen.

**Tests (failing first):** unit tests in `appTools.test.ts` for each bullet; one
integration test in `mcpApp.spec.ts` with two projects open (see how that spec
opens projects): switch to the other, `get_app_state.project` is it, and
`get_graph` answers for it.

- [ ] Write the failing tests, run them, implement, run them, typecheck both
      packages, commit `MCP: switch_project brings an open project on screen`.

---

### Task 2: `get_documentation` and `set_documentation`

**Files:**

- Create: `app/gui/src/project-view/mcp/documentationTools.ts` and
  `__tests__/documentationTools.test.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts`
- Modify: `app/electron-client/src/mcp/projectTools.ts` (`VIEW_TOOL_NAMES` gains
  `get_documentation`, `EDIT_TOOL_NAMES` gains `set_documentation`)
- Create: `app/gui/integration-test/project-view/mcpDocumentation.spec.ts`

**What the documentation is:** the Markdown the documentation panel in the right
dock shows: `graph.currentMethod.ast` →
`FunctionDef.mutableDocumentationMarkdown()`
(`OpenedProjectDocumentationEditor.vue:25-27`). At the top level that is the
workflow's documentation; after `open_method` it is that user-defined
function's.

**Behaviour:**

- `get_documentation {}` → `{ method, text, truncated }`. `method` is the name
  of the function on screen. `text` is the Markdown, at most 50,000 characters;
  beyond that `truncated` is true and `text` is the start. Works in Live mode.
  An error when the editor shows no method (reuse `viewTools.ts`'s
  `NO_METHOD_ERROR` wording).
- `set_documentation { text }` (`text` at most 100,000 characters; `""` clears
  it) replaces the whole text in **one** edit through the `EditSession`, as
  `setNodeComment` does (`module().edit`, `edit.getVersion(methodAst)`,
  `mutableDocumentationMarkdown()`, delete all, insert). It answers
  `{ method, characters, settled: true }` (documentation changes nothing the
  engine runs; follow how `set_node_comment` settles). Refused in Live and when
  the method on screen changed before the edit ran, like every edit
  (`EDIT_RULES` in the description).
- Text equal to the current text makes no edit and answers
  `{ method, characters, settled: true, unchanged: true }`.
- The description of `set_documentation` says: it replaces all of it, so call
  `get_documentation` first and send the full new text; it is Markdown; images
  are added with `add_image`, whose result gives the Markdown to include; the
  user sees it in the documentation panel.
- If the user has the documentation panel open while the edit runs, the panel
  must show the new text (it is bound to the same `Y.Text`); the integration
  spec asserts this.

**Tests (failing first):**

- Unit (`documentationTools.test.ts`, pure functions over a deps object in the
  style of `editTools.test.ts`): read; truncation; no method; replace; clear;
  unchanged; refusal passed through from the session; the edit is one session
  run.
- Integration (`mcpDocumentation.spec.ts`, helpers as in `mcpEdit.spec.ts`):
  `set_documentation` then `get_documentation` round-trips; the documentation
  panel shows the new text (open it the way an existing spec does; search the
  integration tests for the documentation panel); one Ctrl+Z restores the old
  text; after `open_method` on a node that calls a function of the project, the
  two tools read and write that function's documentation and the main function's
  is untouched; refused in Live (reuse `setMockExecutionMode` from
  `mcpVisualization.spec.ts`). Run with `--repeat-each=3`.

- [ ] Write the failing tests, implement, run, typecheck, commit
      `MCP: read and replace the documentation of the function on screen`.

---

### Task 3: `add_image`

**Files:**

- Create: `app/electron-client/src/mcp/imageTool.ts` and
  `tests/headless/mcpImageTool.test.ts`
- Modify: `app/electron-client/src/electron.ts` (registration; a file reader is
  injected, as the capture is for `visualizationTool`)
- Modify: `app/electron-client/src/mcp/visualizationTool.ts` only to export what
  `imageTool.ts` reuses (the prepare-and-stable-capture step), without changing
  its behaviour
- Create: `app/gui/src/project-view/mcp/imageTools.ts` and its test; modify
  `useProjectMcpTools.ts` (window handler `store_image`, not an MCP tool)

**Behaviour:**

- `add_image { path?, node_id?, name? }`: exactly one of `path` and `node_id`
  (otherwise an error saying so).
  - `path` (at most 1,000 characters): an absolute path of an image file on the
    user's machine. Main reads it. Accepted only when **both** hold: the
    extension is one of `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `avif`,
    `apng` (the documentation editor's own list, `asyncResources/upload.ts`),
    and the content is that kind of image by its leading bytes (PNG, JPEG, GIF,
    WebP `RIFF….WEBP`, AVIF `ftyp` brand; SVG: text whose first non-blank
    content, after an optional XML declaration or comment, is `<svg`). A regular
    file only (no directory, no device); at most 10 MB, checked from `stat`
    before reading. Each refusal says which rule failed. A relative path is
    refused. The file is not required to be in the Drive: an agent's chart is
    usually in its own working folder. This check on content is what stops the
    tool copying an arbitrary file into the project.
  - `node_id`: a picture of that node's visualization, taken exactly as
    `get_visualization` takes it (same readying, same stable capture, same 1200
    px cap), stored as PNG. It may show a hidden visualization and move the
    view, as `get_visualization` does, and its result carries `shown` and
    `moved` then.
  - `name` (optional, at most 100 characters): the file name to store under,
    without folders. Characters outside `A-Z a-z 0-9 . _ -` and spaces are
    refused, as is a name that is only dots; the extension is forced to match
    the image's kind. Default: the source file's name, or
    `<node name or "visualization">.png` for a capture.
- The window stores the bytes in the project's `images` folder through the same
  functions the documentation editor's upload uses (`uploadResourceToProject` /
  `useProjectFiles`: create the folder if missing, `pickUniqueName` so nothing
  is ever overwritten, `writeFileBinary`). Main sends the bytes to the window as
  base64 in the `store_image` call's arguments; the window validates that it is
  base64 and at most 10 MB decoded.
- Result: `{ path, markdown, bytes }` (plus `shown`, `moved` for a capture),
  where `path` is the project-relative URL the editor writes (`/images/<name>`)
  and `markdown` is `![<alt>](/images/<name>)` with `alt` the stored name
  without its extension, `[` and `]` replaced by `_` (the editor's rule,
  `MarkdownEditorImpl.vue:77-100`).
- It does not edit the documentation: the description tells the agent to put
  `markdown` into the text it sends to `set_documentation`.
- Storing a file is not a module edit: nothing is added to the undo stack, and
  the description says an image that ends up unused stays in the `images` folder
  for the user to delete. It works in Live mode for `path`; for `node_id` the
  Live rules of `get_visualization` apply.
- Timeouts: `EDIT_TOOL_TIMEOUT_MS` for each window call.

**Tests (failing first):**

- `mcpImageTool.test.ts` with an injected file reader and capture: each accepted
  kind by extension and bytes; an extension that does not match the bytes (a
  text file named `.png`; a PNG named `.jpg` — decide and document: refuse a
  mismatch); over 10 MB refused from `stat` without reading; a directory; a
  relative path; both or neither of `path`/`node_id`; bad names; the forced
  extension; a capture's result carries `shown`/`moved`; the window's refusal is
  passed through; the bytes reach `store_image` as base64.
- Window unit test: unique-name behaviour is delegated to the existing functions
  (assert they are called, do not re-implement); markdown and alt rule; bad
  base64 and oversize refused.
- Integration (in `mcpDocumentation.spec.ts`): through `store_image` directly
  (the mock has no main process), then `set_documentation` with the returned
  Markdown, and the documentation panel renders an `<img>` that has loaded
  (`naturalWidth > 0`). A second image of the same name gets a different stored
  name and both exist.

- [ ] Write the failing tests, implement, run, typecheck, commit
      `MCP: add_image stores a picture for the documentation`.

---

### Task 4: Packaged proof, guide and documentation

**Files:** `app/electron-client/tests/mcp.spec.ts`,
`app/electron-client/src/mcp/guides/overview.md`, the `mcp/CLAUDE.md` files
(`app/electron-client/src/mcp`, `app/gui/src/mcp`,
`app/gui/src/project-view/mcp`), `CHANGELOG.md`.

- [ ] Packaged spec: the four tools in the expected tool list. In the test that
      builds a project: `set_documentation` then `get_documentation` round-trips
      against the real engine; `add_image` with `node_id` of the `[1, 2, 3]`
      node answers Markdown and the file exists in the project's `images` folder
      on disk with a PNG signature; `add_image` with `path` of a small PNG the
      test writes to a temp folder stores it, and with `path` of a text file
      renamed `.png` is refused; `switch_project` to an unknown path is refused
      with the list. Rebuild with `ide-local` and run the spec 3 times (see
      `app/electron-client/CLAUDE.md`; never run the installer).
- [ ] Guide: a short item for documentation and images, and `switch_project`
      beside the app tools, in the style of the existing items. State that
      `set_documentation` replaces everything.
- [ ] `CLAUDE.md` files: the tools, where each runs, the image checks and
      limits, and that `store_image` is a window handler, not an MCP tool.
- [ ] Changelog: one entry under `#### Enso IDE` with the placeholder `NNN`:
      "Agents connected over MCP can switch between open projects, read and
      rewrite a workflow's or a function's documentation, and add images to it."
- [ ] Run the focused unit suites, both typechecks, prettier and eslint on
      changed files, and the two GUI integration specs with `--repeat-each=3`.
      Commit
      `MCP: documentation, images and tab switching in the guide and the packaged test`.

## Not in this PR

- Undo and redo, saving a version, a picture of the graph, problems across the
  graph, and refresh: the next PR.
- Editing part of the documentation (find and replace).
- Deleting or renaming an image.
- Removing the AI prompt and AI nodes; the activity icon.
