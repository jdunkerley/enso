# User Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user documentation site for the fork, the successor of
help.enso.org, built from `develop` and published to GitHub Pages at
`https://jdunkerley.github.io/enso/`: hand-written guides plus a Components
reference generated from every standard library's `catalogue.json`, one page per
function, each function drawn as the graph editor draws it.

**Architecture:** A new top-level pnpm workspace package, `docs-site/`
(Docusaurus 3, React confined to it). A TypeScript generator in
`docs-site/generator/` reads the catalogues of a built distribution, runs every
doc comment through the GUI's own code (`documentationData`, the Lezer
`ensoMarkdownParser`, the group colours, the icon rule), imported from the
workspace under `vite-node`, and writes MDX pages, sidebars, a group-colour
stylesheet and the IDE's icon sprite into git-ignored places. The page path
function, `apiPath`, lives in `app/common` so the IDE's links (a follow-up) use
the same code. CI builds the site from the engine build's distribution on pull
requests and deploys it from `develop` with `actions/deploy-pages`.

**Tech Stack:** Docusaurus 3 (`@docusaurus/core`, `preset-classic`), React 19,
`@easyops-cn/docusaurus-search-local`, TypeScript 6 (the catalog's), `vite-node`
and Vitest (Node environment), Playwright with `@axe-core/playwright`, GitHub
Actions (`actions/upload-pages-artifact`, `actions/deploy-pages`).

**Spec:** `docs/superpowers/specs/2026-11-04-user-docs-site-design.md` (merged
as 3ace2363fa, PR #577; binding). The owner's decisions are in its "Decisions"
section; the rulings on its open questions, and those made while planning, are
below. Executors read both documents.

## Global Constraints

- Read the root `CLAUDE.md`, `.github/CLAUDE.md`, `app/gui/CLAUDE.md`,
  `app/common/CLAUDE.md` and the `CLAUDE.md` of every directory you touch before
  editing. `docs-site/` gets its own `CLAUDE.md` in Task 14.
- Use `corepack pnpm`, never bare `pnpm` or `npm`.
- The code blocks below are formatted by Prettier's Markdown defaults
  (semicolons, double quotes). Write the files in the repository's style
  (`.prettierrc.yaml`: no semicolons, single quotes, width 100); the pre-commit
  hook formats staged files anyway.
- Nothing is copied from upstream help.enso.org: no content, styles or code. Its
  page structure and node design are re-implemented from the spec.
- The generator imports the GUI's code; it never copies it. When a GUI module
  will not load in Node, move the needed code into a module that does, re-export
  it from the old place, and make the GUI import it from the new place.
- React only inside `docs-site/`. Every new dependency is pinned exactly, at a
  release at least two weeks old (`corepack pnpm view <pkg> time --json`). At
  the time of writing: `@docusaurus/*` 3.10.2 (2026-07-10),
  `@easyops-cn/docusaurus-search-local` 0.55.3 (2026-07-29), `@mdx-js/react`
  3.1.1; `react`/`react-dom` the newest 19.x that is two weeks old.
- Actions are pinned by major tag: `actions/upload-pages-artifact@v5`,
  `actions/deploy-pages@v5` (their current majors, both older than two weeks),
  `actions/download-artifact@v5` and `actions/upload-artifact@v5` (as every
  other workflow here).
- Node is the repository's (`.node-version`, 24.21.0).
- Verify on Linux (WSL) as well as Windows: source `~/.enso-toolchain.sh` first,
  work in a clone under `~/`, and delete that clone when done (root `CLAUDE.md`,
  "Verify on Linux"). Paths with dots and case differences are where the two
  hosts differ.
- Unset the credential environment variables before any test run:
  `for v in $(env | cut -d= -f1 | grep -E '^(ENSO_|AWS_|SNOWFLAKE|GOOGLE|AZURE)|_TOKEN$'); do unset "$v"; done`.
- Never run `git stash` in any form, `git reset --hard`, a force-push,
  `--no-verify` or `HUSKY=0`; never amend a pushed commit; leave
  `.claude/settings*.json` out of commits and stage paths explicitly.
- Commit messages end with exactly these two lines:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

- PR bodies are written with the Write tool to a file and passed with
  `gh pr create --body-file <file>`, and end with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

- Each PR below is one branch from `origin/develop` in its own worktree
  (`git worktree add C:\Repos\Enso\ide\.claude\worktrees\<name> -b <branch> origin/develop`),
  removed with its local branch after merge.
- Merge gate: PR 1 and PR 2 are not published, but each needs the owner's review
  (named in its task); PR 3 is the user-visible one and merges only after the
  owner's OK on the preview artifact. Do not merge any of them without it.

## Rulings

### On the spec's open questions (the controller's, 2026-11-04)

1. **Pages setup (OQ 1):** GitHub Pages is not enabled yet; enabling it is the
   owner's action. PR 3 must merge green without it. **Ruling (planning):** the
   deploy job runs only when the repository variable `DOCS_SITE_DEPLOY` is
   `true`; until the owner enables Pages (source "GitHub Actions"), restricts
   the `github-pages` environment to `develop` and sets the variable, the job is
   skipped, not failed. The PR checks only build the site, so nothing else needs
   Pages. The PR body of PR 3 lists the three owner steps.
2. **React (OQ 2):** Docusaurus, accepting React inside `docs-site/` only
   (versioning later needs Docusaurus's).
3. **Errors in the return-type tooltip (OQ 3):** the name's tooltip shows the
   return type without errors (the catalogue drops them); the Errors section
   covers them. No catalogue format change now. Possible follow-up: carry
   `Type.Error`'s errors in a catalogue format 2.
4. **Default values (OQ 4):** an explicit verification step in Task 13, with a
   fallback.
5. **Release links (OQ 5):** deferred to the versioning follow-up.
6. **Search (OQ 6):** `@easyops-cn/docusaurus-search-local`, accepted; Task 13
   measures the index on the full reference and records it.
7. **Build scale (OQ 7), dotted paths (OQ 8), collisions (OQ 9), indented result
   tables (OQ 10):** explicit verification steps in PR 1 (Task 13), each with a
   stated fallback; OQ 8's GitHub Pages half is checked after PR 3's first
   deploy (Task 25).
8. **Ungrouped components (OQ 11):** colour from the declared return type,
   `--group-color-fallback` for `Any` and unions. Accepted.
9. **docs/CLAUDE.md (OQ 12):** PR 1 adds a pointer to `docs-site/`.

### Made while planning (the code differs from the spec's reading, or the spec left it open)

- **R1. More moves than the spec's three.** `@/util/projectPath` imports
  `@/util/qualifiedName`, which imports `@/util/ast/abstract` and so the WASM
  parser; `nodeColors.ts` imports `ProjectPath` as a value, and `entry.ts` (home
  of `SuggestionKind` and `isRequiredArgument`) imports `projectPath` too. So PR
  1 moves, each re-exported from its old place: `prerenderMarkdown` to
  `app/ydoc-shared/src/ast/prerenderMarkdown.ts`; `GroupInfo` to
  `suggestionDatabase/groupInfo.ts`; `isRequiredArgument` to
  `suggestionDatabase/argument.ts`; `groupColorVar`, `groupColorStyle` and the
  new `groupColor` to `project-view/util/groupColors.ts`; the icon rule and
  `DEFAULT_ICON` to `project-view/util/entryIcon.ts`; and the key rule of
  `ProjectPath.key()` to `project-view/util/projectPathKey.ts`, so the generator
  computes a type's colour key exactly as `computeNodeColor` does.
- **R2. A small catalogue artifact for route B.** The generator needs only each
  library's `catalogue.json` and `package.yaml`. Route A's build job extracts
  them from the distribution tar and uploads them as `docs-site-catalogues` (a
  few MB); route B downloads that from the newest suitable `develop` run instead
  of the whole distribution, falling back to the distribution artifact while no
  `develop` run has the small one yet (the first PR 3 runs). Route B's finder
  job re-uploads what it found into its own run, so the reusable build workflow
  only ever downloads from its own run and needs no `actions: read`: the engine
  workflows' permissions do not change.
- **R3. The `Main` module.** A library's page is its `Main` module's page
  (`Standard.Table/`); `Main`'s own types and functions keep `Main` as a path
  segment (`Standard.Table/Main/<member>/`). The old
  `suggestionDocumentationUrl` returned nothing for `Main`, so no old link
  changes.
- **R4. Files.** Each page is written as
  `docs-site/docs/api/<apiPath>/index.mdx` with an explicit `slug`; the front
  matter has no `id` (the file path gives `api/<apiPath>/index`, which the
  generated sidebars use).
- **R5. Aliases.** The generator's Vite config states the GUI's three aliases
  itself (three lines, commented with their source) rather than importing
  `app/gui/vite.config.ts`, which loads the GUI's Vue, Tailwind and WASM
  plugins.
- **R6. The Components intro** does not list the libraries in its text: its
  sidebar, generated, does.
- **R7. Extension methods** are listed on their self type's page (spec) and also
  on their defining module's page, so the sidebar and the module page reach
  them.
- **R8. No logo or favicon in PR 1.** The navbar shows the title "Enso"; the
  owner can supply a logo later. Nothing of upstream's branding is copied.
- **R9. The accessibility tests are written in PR 1** and run there on a fixture
  build; PR 3 runs them in CI on the real build.
- **R10. Colours in Node.** `colorFromString` formats with `formatRgb` when
  `CSS.supports` is unavailable, so in Node a derived colour is `rgb(…)` where
  the IDE writes `oklch(…)`: the same colour, written differently. Declared
  group colours (all of `Standard.Base`'s) are copied as written.
- **R11. #240 is already closed.** PR 2 says "Refs #240", not "Closes".
- **R12. Samples.** The IDE downloads its samples on first start from
  `https://github.com/enso-org/project-templates` into `<projects>/Samples`
  (`downloadSamples`, `app/project-manager-shim/src/projectManagement.ts`, from
  `app/electron-client/src/index.ts`). The `samples` guide documents that as it
  is; the PR 2 body flags to the owner that it is an upstream URL (#566 does not
  touch it).
- **R13. `.tsx` formatting.** `.prettierrc.yaml`'s first override gains
  `"*.tsx"`, so the node component is formatted like the rest of the TypeScript.

## Delivery

| PR  | Branch                     | What                                                                                                        | Visible?                    | Gate                                    |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------- |
| 1   | `docs/docs-site-generator` | `docs-site/` skeleton, node component, generator and tests, the moves, `apiPath`, GUI gate, CLAUDE.md files | No (nothing published)      | Owner's preview review; label           |
| 2   | `docs/docs-site-guides`    | The seven guides with screenshots                                                                           | No (not yet published)      | Owner's review of the text; label       |
| 3   | `ci/docs-site-deploy`      | `docs-site-build.yml`, `docs-site.yml`, `docs-site-deploy.yml`, gate entries, accessibility tests in CI     | **Yes** (the site goes out) | Owner's OK on the preview; CHANGELOG    |
| 4   | `gui/docs-site-links`      | IDE links to the site (spec section 7)                                                                      | **Yes**                     | Waits for #566 and the live site; owner |

PR 2 and PR 3 can be developed in parallel after PR 1 merges; PR 3 merges after
PR 2 so the first deploy has the guides. Every PR is independently green: PR 1
builds without a distribution (fixtures), PR 2 is Markdown and images, PR 3's
deploy is inert until the owner's setup.

## File map

PR 1 creates:

- `app/common/src/docsSite/apiPath.ts`,
  `app/common/src/docsSite/__test__/apiPath.test.ts`
- `app/ydoc-shared/src/ast/prerenderMarkdown.ts`,
  `app/ydoc-shared/src/ast/__tests__/prerenderMarkdown.test.ts`
- `app/gui/src/providers/openedProjects/suggestionDatabase/groupInfo.ts`,
  `…/argument.ts`
- `app/gui/src/project-view/util/groupColors.ts`, `entryIcon.ts`,
  `projectPathKey.ts`, and `__tests__/groupColors.test.ts`, `entryIcon.test.ts`,
  `projectPathKey.test.ts` beside them
- `docs-site/`: `package.json`, `tsconfig.json`, `vitest.config.ts`,
  `playwright.config.ts`, `docusaurus.config.ts`, `sidebars.ts`, `.gitignore`,
  `CLAUDE.md`, `docs/intro.md`, `docs/api/index.md`, `src/css/custom.css`,
  `src/pages/index.tsx`, `src/theme/MDXComponents.tsx`,
  `src/components/ComponentNode.tsx`, `src/components/ComponentNode.module.css`,
  `e2e/node.spec.ts`, `e2e/axe.spec.ts`
- `docs-site/generator/src/`: `gui.ts` (the only module importing GUI or ydoc
  code), `catalogue.ts`, `groups.ts`, `typeText.ts`, `model.ts`, `sections.ts`,
  `mdx.ts`, `componentNode.ts`, `pages.ts`, `sidebarData.ts`, `output.ts`,
  `report.ts`, `main.ts`, and a `*.test.ts` beside each that has logic
- `docs-site/generator/fixtures/lib/Standard/Fixture/0.0.0-dev/{package.yaml,catalogue.json}`,
  `…/Fixture_Ext/0.0.0-dev/{package.yaml,catalogue.json}`,
  `docs-site/generator/fixtures/golden/lib/Standard/Table/0.0.0-dev/{package.yaml,catalogue.json}`,
  `docs-site/generator/fixtures/golden/Table.filter.mdx`

PR 1 modifies: `app/ydoc-shared/src/ast/documentation.ts`,
`app/gui/src/providers/openedProjects/suggestionDatabase/{index.ts,entry.ts,documentation.ts}`,
`app/gui/src/project-view/composables/nodeColors.ts`,
`app/gui/src/project-view/util/getIconName.ts`,
`app/gui/src/project-view/util/projectPath.ts`,
`app/gui/src/components/WithCurrentProject.vue`, `pnpm-workspace.yaml`,
`pnpm-lock.yaml`, `eslint.config.mjs`, `.prettierignore`, `.prettierrc.yaml`,
`.github/workflows/gui-changed-files.yml`, `CLAUDE.md`, `docs/CLAUDE.md`.

PR 2 creates `docs-site/docs/<guide>/index.md` and its screenshots for each of
`getting-started`, `installing-and-updating`, `local-versioning`, `secrets`,
`engine-logs`, `samples`; modifies `docs-site/docs/intro.md`,
`docs-site/sidebars.ts`.

PR 3 creates `.github/workflows/docs-site-build.yml`, `docs-site.yml`,
`docs-site-deploy.yml`, `docs-site/scripts/extract-catalogues.sh`,
`docs-site/generator/src/workflowPaths.test.ts`; modifies
`.github/workflows/engine-checks-platform.yml`, `engine-changed-files.yml`,
`.github/CLAUDE.md`, `docs-site/CLAUDE.md`, `CHANGELOG.md`.

---

# PR 1: Generator and skeleton

Worktree:
`git fetch origin && git worktree add C:\Repos\Enso\ide\.claude\worktrees\docs-site-generator -b docs/docs-site-generator origin/develop`,
then `corepack pnpm install` in it (the root `postinstall` builds the WASM
parser, runs `generate-ast` and `generate-icons`, which the GUI's own tests
need).

### Task 1: `apiPath` in `app/common`

The one function that turns an entry into its page path. The generator calls it
now; the IDE calls it in PR 4.

**Files:**

- Create: `app/common/src/docsSite/apiPath.ts`
- Test: `app/common/src/docsSite/__test__/apiPath.test.ts`

**Interfaces:**

- Produces: `type ApiEntryKind = 'module' | 'type' | 'constructor' | 'method'`;
  `interface ApiPathEntry { kind; module: string; name?: string; owner?: string }`;
  `apiPath(entry: ApiPathEntry): string` (no leading or trailing slash, e.g.
  `Standard.Table/Table/Table.filter`); `memberSegment(name: string): string`.
  Imported as `enso-common/src/docsSite/apiPath`.

- [ ] **Step 1: Write the failing test**

```ts
// app/common/src/docsSite/__test__/apiPath.test.ts
import { describe, expect, test } from "vitest";
import { apiPath, memberSegment, type ApiPathEntry } from "../apiPath";

const table = "Standard.Table.Table.Table";

describe("apiPath", () => {
  // The cases `suggestionDocumentationUrl` (entry.ts, removed by #566) handled: the library, the
  // module path one segment per name, then the definition path with the module path removed.
  test.each<[string, ApiPathEntry, string]>([
    [
      "instance method",
      {
        kind: "method",
        module: "Standard.Table.Table",
        name: "filter",
        owner: table,
      },
      "Standard.Table/Table/Table.filter",
    ],
    [
      "static method",
      {
        kind: "method",
        module: "Standard.Table.Table",
        name: "new",
        owner: table,
      },
      "Standard.Table/Table/Table.new",
    ],
    [
      "module function",
      {
        kind: "method",
        module: "Standard.Base.Data",
        name: "read",
        owner: "Standard.Base.Data",
      },
      "Standard.Base/Data/read",
    ],
    [
      "extension method",
      {
        kind: "method",
        module: "Standard.Table.Extensions.Table_Conversions",
        name: "parse_to_table",
        owner: "Standard.Base.Data.Text.Text",
      },
      "Standard.Table/Extensions/Table_Conversions/Text.parse_to_table",
    ],
  ])("matches the old IDE link: %s", (_, entry, expected) => {
    expect(apiPath(entry)).toBe(expected);
  });

  test.each<[string, ApiPathEntry, string]>([
    [
      "constructor",
      {
        kind: "constructor",
        module: "Standard.Base.Data.Filter_Condition",
        name: "Equal",
        owner: "Standard.Base.Data.Filter_Condition.Filter_Condition",
      },
      "Standard.Base/Data/Filter_Condition/Filter_Condition.Equal",
    ],
    [
      "type",
      { kind: "type", module: "Standard.Table.Table", name: "Table" },
      "Standard.Table/Table/Table",
    ],
    [
      "module",
      { kind: "module", module: "Standard.Table.Table" },
      "Standard.Table/Table",
    ],
    [
      "Main module is the library page",
      { kind: "module", module: "Standard.Table.Main" },
      "Standard.Table",
    ],
    [
      "a member of Main keeps the Main segment",
      {
        kind: "method",
        module: "Standard.Table.Main",
        name: "f",
        owner: "Standard.Table.Main",
      },
      "Standard.Table/Main/f",
    ],
    [
      "operator",
      {
        kind: "method",
        module: "Standard.Base.Data.Numbers",
        name: "+",
        owner: "Standard.Base.Data.Numbers.Integer",
      },
      "Standard.Base/Data/Numbers/Integer.op-2b",
    ],
  ])("%s", (_, entry, expected) => {
    expect(apiPath(entry)).toBe(expected);
  });

  test("a member without a name is an error", () => {
    expect(() =>
      apiPath({
        kind: "method",
        module: "Standard.Base.Data",
        owner: "Standard.Base.Data",
      }),
    ).toThrow();
  });
  test("a module that is not fully qualified is an error", () => {
    expect(() => apiPath({ kind: "module", module: "Main" })).toThrow();
  });
});

describe("memberSegment", () => {
  test.each([
    ["filter", "filter"],
    ["Value", "Value"],
    ["+", "op-2b"],
    ["<=", "op-3c3d"],
    ["==", "op-3d3d"],
    ["||", "op-7c7c"],
    ["→", "op-e28692"],
  ])("%s → %s", (name, segment) => {
    expect(memberSegment(name)).toBe(segment);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `corepack pnpm --filter enso-common exec vitest run src/docsSite` Expected:
FAIL, `Failed to resolve import "../apiPath"`.

- [ ] **Step 3: Implement**

```ts
// app/common/src/docsSite/apiPath.ts
/**
 * @file The path of a library entry's page on the user documentation site (`docs-site/`), relative
 * to its Components root (`<base>/docs/api/`). The site's generator and the IDE's documentation
 * links both call {@link apiPath}, so the two cannot disagree. Rule and examples:
 * `docs/superpowers/specs/2026-11-04-user-docs-site-design.md`, "URLs".
 */

/** What a page documents. A getter, a module function and an extension method are all `method`. */
export type ApiEntryKind = "module" | "type" | "constructor" | "method";

/** The fields of a catalogue (or suggestion database) entry that decide its page's path. */
export interface ApiPathEntry {
  readonly kind: ApiEntryKind;
  /** The defining module, fully qualified (`Standard.Table.Table`); for a module, the module. */
  readonly module: string;
  /** The type's or member's name. Unused for a module. */
  readonly name?: string | undefined;
  /**
   * A constructor's type, or a method's self type, fully qualified. A method whose self type is
   * its own module is a module-level function and gets a bare name.
   */
  readonly owner?: string | undefined;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A member's name as a path segment: an identifier as it is, anything else (an operator) as `op-`
 * and its UTF-8 bytes in hex, since `*`, `<`, `>` and `|` are not allowed in Windows file names.
 */
export function memberSegment(name: string): string {
  if (IDENTIFIER.test(name)) return name;
  const bytes = new TextEncoder().encode(name);
  return (
    "op-" +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

function lastSegment(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);
}

function required(
  value: string | undefined,
  what: string,
  entry: ApiPathEntry,
): string {
  if (value == null || value === "")
    throw new Error(`${entry.kind} in ${entry.module} has no ${what}`);
  return value;
}

/** The page path of `entry`: `<library>/<module path>/<member>`, with no leading or trailing slash. */
export function apiPath(entry: ApiPathEntry): string {
  const segments = entry.module.split(".");
  if (segments.length < 3)
    throw new Error(`Not a fully qualified module: ${entry.module}`);
  const library = segments.slice(0, 2).join(".");
  const modulePath = segments.slice(2);
  const isMain = modulePath.length === 1 && modulePath[0] === "Main";
  const base = [library, ...modulePath];
  switch (entry.kind) {
    case "module":
      return isMain ? library : base.join("/");
    case "type":
      return [...base, required(entry.name, "name", entry)].join("/");
    case "constructor": {
      const owner = lastSegment(required(entry.owner, "type", entry));
      return [
        ...base,
        `${owner}.${memberSegment(required(entry.name, "name", entry))}`,
      ].join("/");
    }
    case "method": {
      const name = memberSegment(required(entry.name, "name", entry));
      const owner = required(entry.owner, "self type", entry);
      return [
        ...base,
        owner === entry.module ? name : `${lastSegment(owner)}.${name}`,
      ].join("/");
    }
  }
}
```

- [ ] **Step 4: Run the tests and the package's checks**

Run: `corepack pnpm --filter enso-common exec vitest run src/docsSite` Expected:
PASS (all cases). Run:
`corepack pnpm --filter enso-common run typecheck && corepack pnpm --filter enso-common run lint`
Expected: no errors. (`TextEncoder` is a global in Node and browsers, so the
module keeps `app/common`'s isomorphism rule.)

- [ ] **Step 5: Commit**

```bash
git add app/common/src/docsSite
git commit -m "docs-site: apiPath, the shared page path of a library entry"
```

(Every commit in this plan ends with the two trailer lines of Global
Constraints.)

### Task 2: `prerenderMarkdown` in its own module

`ydoc-shared/src/ast/documentation.ts` imports `./ffi` (the WASM parser and
`hash-wasm`) and `./token` (the generated AST); `prerenderMarkdown` needs
neither.

**Files:**

- Create: `app/ydoc-shared/src/ast/prerenderMarkdown.ts`
- Modify: `app/ydoc-shared/src/ast/documentation.ts` (remove
  `requiresNewlineBeforeFollowingParagraph` and `prerenderMarkdown`, import and
  re-export the latter)
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts`
  (import from the new module)
- Test: `app/ydoc-shared/src/ast/__tests__/prerenderMarkdown.test.ts`

**Interfaces:**

- Produces: `prerenderMarkdown(markdown: string): string`, importable as
  `ydoc-shared/ast/prerenderMarkdown`; still re-exported from
  `ydoc-shared/ast/documentation`.

- [ ] **Step 1: Write the failing test**

```ts
// app/ydoc-shared/src/ast/__tests__/prerenderMarkdown.test.ts
import { expect, test } from "vitest";
import { prerenderMarkdown as reexported } from "../documentation";
import { prerenderMarkdown } from "../prerenderMarkdown";

test("joins hard-wrapped lines of a paragraph and keeps the blocks", () => {
  const source =
    "First line\nsecond line.\n\n## Arguments\n- `a`: the\n  first.\n";
  expect(prerenderMarkdown(source)).toBe(
    "First line second line.\n## Arguments\n- `a`: the first.\n",
  );
});

test("documentation.ts re-exports the same function", () => {
  expect(reexported).toBe(prerenderMarkdown);
});
```

Run:
`corepack pnpm --filter ydoc-shared exec vitest run src/ast/__tests__/prerenderMarkdown.test.ts`
Expected: FAIL, `Failed to resolve import "../prerenderMarkdown"`.

If the first assertion's expected string differs from what the current
`prerenderMarkdown` returns once the module exists, the function is right and
the expectation is wrong: correct the expectation to the current output (this
test pins behaviour; it must not change it).

- [ ] **Step 2: Move the code**

Create `app/ydoc-shared/src/ast/prerenderMarkdown.ts` with the file comment
`@file The "prerendered" form of documentation Markdown, which the documentation editor and the docs site parse. Imports only the Markdown dialect, so it loads in Node without the WASM parser.`,
`import { ensoStandardMarkdownParser } from './ensoMarkdown'`, and, moved
verbatim from `documentation.ts` (the `// === Markdown ===` section),
`requiresNewlineBeforeFollowingParagraph` (unexported) and
`export function prerenderMarkdown`.

In `documentation.ts`: delete those two functions; change the import to
`import { ensoMarkdownParser } from './ensoMarkdown'` (`standardizeMarkdown`
still uses it); add `import { prerenderMarkdown } from './prerenderMarkdown'`
(used by `abstractMarkdown`) and
`export { prerenderMarkdown } from './prerenderMarkdown'`.

In the GUI's `suggestionDatabase/documentation.ts`, replace
`import { prerenderMarkdown } from 'ydoc-shared/ast/documentation'` with
`import { prerenderMarkdown } from 'ydoc-shared/ast/prerenderMarkdown'`.

Then find every other importer, and leave them alone (the re-export serves
them): `Grep pattern "prerenderMarkdown" path app --glob "!**/node_modules/**"`.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter ydoc-shared exec vitest run src/ast` Expected:
PASS, including the existing `documentation.test.ts` and `ensoMarkdown.test.ts`.
Run: `corepack pnpm --filter ydoc-shared run typecheck` Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/ydoc-shared/src/ast/prerenderMarkdown.ts app/ydoc-shared/src/ast/documentation.ts app/ydoc-shared/src/ast/__tests__/prerenderMarkdown.test.ts app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts
git commit -m "ydoc-shared: prerenderMarkdown in a module without the WASM parser"
```

### Task 3: The GUI's colour, icon, group and argument rules in Node-loadable modules

Ruling R1. Each new module imports nothing that reaches `@/util/ast/abstract`,
`vue` (as a value), a `.vue` file, or the graph store.

**Files:**

- Create: `app/gui/src/providers/openedProjects/suggestionDatabase/groupInfo.ts`
- Create: `app/gui/src/providers/openedProjects/suggestionDatabase/argument.ts`
- Create: `app/gui/src/project-view/util/groupColors.ts`
- Create: `app/gui/src/project-view/util/entryIcon.ts`
- Create: `app/gui/src/project-view/util/projectPathKey.ts`
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts:223-227`
  (the `GroupInfo` interface)
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/entry.ts:229-232`
  (`isRequiredArgument`)
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts:1`
  (the `GroupInfo` import)
- Modify: `app/gui/src/project-view/composables/nodeColors.ts:78-87`
- Modify: `app/gui/src/project-view/util/getIconName.ts:28,40-46`
- Modify: `app/gui/src/project-view/util/projectPath.ts:110-114` (`key()`)
- Modify: `app/gui/src/components/WithCurrentProject.vue:4,9,126`
- Test: `app/gui/src/project-view/util/__tests__/groupColors.test.ts`,
  `entryIcon.test.ts`, `projectPathKey.test.ts` (check the folder exists with
  `Glob app/gui/src/project-view/util/__tests__/*`; create it if not)

**Interfaces:**

- Produces (GUI aliases):
  `$/providers/openedProjects/suggestionDatabase/groupInfo` →
  `interface GroupInfo { color?: string; name: string; project: QualifiedName }`;
  `$/providers/openedProjects/suggestionDatabase/argument` →
  `isRequiredArgument(info: SuggestionEntryArgument): boolean`;
  `@/util/groupColors` → `groupColorVar(group: GroupInfo | undefined): string`,
  `groupColorStyle(group: GroupInfo | undefined): string`,
  `groupColor(group: GroupInfo): string`; `@/util/entryIcon` →
  `DEFAULT_ICON: 'enso_logo'`,
  `entryIcon(entry: { readonly iconName?: Icon | undefined; readonly kind: string }): Icon`;
  `@/util/projectPathKey` →
  `projectPathKey(project: string | undefined, path: string | undefined): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/gui/src/project-view/util/__tests__/groupColors.test.ts
import type { GroupInfo } from "$/providers/openedProjects/suggestionDatabase/groupInfo";
import { colorFromString } from "@/util/colors";
import { groupColor, groupColorStyle, groupColorVar } from "@/util/groupColors";
import type { QualifiedName } from "@/util/qualifiedName";
import { expect, test } from "vitest";

const selections: GroupInfo = {
  name: "Selections",
  project: "Standard.Base" as QualifiedName,
  color: "oklch(0.464 0.14 325)",
};

test("the CSS variable name replaces non-word characters", () => {
  expect(groupColorVar(selections)).toBe(
    "--group-color-Standard-Base-Selections",
  );
  expect(groupColorVar({ ...selections, name: "Date Time" })).toBe(
    "--group-color-Standard-Base-Date-Time",
  );
  expect(groupColorVar(undefined)).toBe("--group-color-fallback");
  expect(groupColorStyle(selections)).toBe(
    "var(--group-color-Standard-Base-Selections)",
  );
});

test("a group is coloured by its declared colour, else from its name", () => {
  expect(groupColor(selections)).toBe("oklch(0.464 0.14 325)");
  const { color: _, ...uncoloured } = selections;
  expect(groupColor(uncoloured)).toBe(colorFromString("Selections"));
});
```

```ts
// app/gui/src/project-view/util/__tests__/entryIcon.test.ts
import { SuggestionKind } from "$/providers/openedProjects/suggestionDatabase/entry";
import { DEFAULT_ICON, entryIcon } from "@/util/entryIcon";
import { expect, test } from "vitest";

test.each([
  [
    { iconName: "preparation" as const, kind: SuggestionKind.Method },
    "preparation",
  ],
  [{ kind: SuggestionKind.Module }, "collection"],
  [{ kind: SuggestionKind.Local }, "local_scope"],
  [{ kind: SuggestionKind.Method }, DEFAULT_ICON],
  [{ kind: SuggestionKind.Constructor }, "enso_logo"],
])("%o → %s", (entry, icon) => {
  expect(entryIcon(entry)).toBe(icon);
});
```

```ts
// app/gui/src/project-view/util/__tests__/projectPathKey.test.ts
import { ProjectPath } from "@/util/projectPath";
import { projectPathKey } from "@/util/projectPathKey";
import type { QualifiedName } from "@/util/qualifiedName";
import { expect, test } from "vitest";

test.each<[string | undefined, string | undefined]>([
  ["Standard.Table", "Table.Table"],
  ["Standard.Table", "Main"],
  ["Standard.Table", "Main.Foo"],
  ["Standard.Table", undefined],
  [undefined, "Main.Foo"],
  [undefined, undefined],
])("projectPathKey(%s, %s) is ProjectPath.key()", (project, path) => {
  const key = ProjectPath.create(
    project as QualifiedName | undefined,
    path as QualifiedName | undefined,
  ).key();
  expect(projectPathKey(project, path)).toBe(key);
});
```

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/util/__tests__/groupColors.test.ts src/project-view/util/__tests__/entryIcon.test.ts src/project-view/util/__tests__/projectPathKey.test.ts`
Expected: FAIL, the three new modules do not resolve.

- [ ] **Step 2: Create the modules**

```ts
// app/gui/src/providers/openedProjects/suggestionDatabase/groupInfo.ts
import type { QualifiedName } from "@/util/qualifiedName";

/**
 * A component group, as the language server reports it from a library's `package.yaml`
 * (`component-groups`). Its own module so code outside the suggestion database (the docs site's
 * generator) can use it without loading the database.
 */
export interface GroupInfo {
  color?: string;
  name: string;
  project: QualifiedName;
}
```

```ts
// app/gui/src/providers/openedProjects/suggestionDatabase/argument.ts
import type { SuggestionEntryArgument } from "ydoc-shared/languageServerTypes/suggestions";

/** `true` if calling the function without providing a value for this argument will result in an error. */
export function isRequiredArgument(info: SuggestionEntryArgument) {
  return !!info.defaultValue?.startsWith("Missing_Argument.");
}
```

```ts
// app/gui/src/project-view/util/groupColors.ts
/**
 * @file The colours of component groups. Every node of a group is drawn in `var(<groupColorVar>)`,
 * which `WithCurrentProject.vue` sets to {@link groupColor}. The docs site's generator writes the
 * same variables, so a component looks the same on the site.
 */
import type { GroupInfo } from "$/providers/openedProjects/suggestionDatabase/groupInfo";
import { colorFromString } from "@/util/colors";

/** The CSS variable holding a group's colour; `--group-color-fallback` for no group. */
export function groupColorVar(group: GroupInfo | undefined): string {
  const name = group
    ? `${group.project}-${group.name}`.replace(/[^\w]/g, "-")
    : "fallback";
  return `--group-color-${name}`;
}

/** A CSS reference to a group's colour. */
export function groupColorStyle(group: GroupInfo | undefined): string {
  return `var(${groupColorVar(group)})`;
}

/** The colour a group's variable is set to: the one `package.yaml` declares, else one derived from its name. */
export function groupColor(group: GroupInfo): string {
  return group.color ?? colorFromString(group.name);
}
```

```ts
// app/gui/src/project-view/util/entryIcon.ts
/**
 * @file The icon of a suggestion entry, from its documentation's `icon:` and its kind. Kept free of
 * the suggestion database and Vue so the docs site's generator applies the same rule.
 */
import type { Icon } from "@/util/iconMetadata/iconName";

/** The icon of an entry whose documentation names none. */
export const DEFAULT_ICON = "enso_logo" satisfies Icon;

/** The icon of an entry; `kind` is a `SuggestionKind` value (`'Module'`, `'Local'`, …). */
export function entryIcon(entry: {
  readonly iconName?: Icon | undefined;
  readonly kind: string;
}): Icon {
  if (entry.iconName) return entry.iconName;
  if (entry.kind === "Local") return "local_scope";
  if (entry.kind === "Module") return "collection";
  return DEFAULT_ICON;
}
```

```ts
// app/gui/src/project-view/util/projectPathKey.ts
/**
 * The key `ProjectPath.key()` gives a project path, from its parts: a path of `Main` or
 * `Main.<rest>` is the project's own (`Main` dropped). Its own module so the docs site's generator
 * can compute a type's colour key (`computeNodeColor` hashes it) without the AST.
 */
export function projectPathKey(
  project: string | undefined,
  path: string | undefined,
): string {
  const main = path?.match(/^Main(?:\.(.+))?$/);
  const normalizedPath = main ? main[1] : path;
  const projectKey = project ?? "$";
  return normalizedPath ? `${projectKey}.${normalizedPath}` : projectKey;
}
```

- [ ] **Step 3: Point the old places at the new modules**

- `suggestionDatabase/index.ts`: replace the `GroupInfo` interface (lines
  223-227) with `export type { GroupInfo } from './groupInfo'`, and add
  `import type { GroupInfo } from './groupInfo'` to its imports (the file uses
  the type).
- `suggestionDatabase/documentation.ts`: import `GroupInfo` from
  `'$/providers/openedProjects/suggestionDatabase/groupInfo'`.
- `entry.ts`: replace `isRequiredArgument` (lines 229-232) with
  `export { isRequiredArgument } from './argument'`. (#566 also edits
  `entry.ts`; whichever PR merges second resolves a one-hunk conflict.)
- `nodeColors.ts`: delete `groupColorVar` and `groupColorStyle`; add
  `import { groupColorStyle } from '@/util/groupColors'` (for
  `computeNodeColor`) and
  `export { groupColorStyle, groupColorVar } from '@/util/groupColors'`.
- `getIconName.ts`: delete `export const DEFAULT_ICON = 'enso_logo'`; add
  `import { DEFAULT_ICON, entryIcon } from '@/util/entryIcon'` and
  `export { DEFAULT_ICON } from '@/util/entryIcon'`; make
  `suggestionEntryToIcon` `return entryIcon(entry)`; drop the `SuggestionKind`
  value import if nothing else in the file uses it (keep
  `type SuggestionEntry`).
- `projectPath.ts`: `key()` becomes
  `return projectPathKey(this.project, this.path)`, with
  `import { projectPathKey } from '@/util/projectPathKey'`.
- `WithCurrentProject.vue`: line 126 becomes
  `styles[groupColorVar(group)] = groupColor(group)`; import both from
  `'@/util/groupColors'` and drop the `colorFromString` import if it has no
  other use in the file
  (`Grep pattern "colorFromString" path app/gui/src/components/WithCurrentProject.vue`).

- [ ] **Step 4: Run the tests and the GUI's checks**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/util src/providers/openedProjects/suggestionDatabase src/project-view/composables`
Expected: PASS, the new tests and the existing ones (`documentation.test.ts`,
the node colour and icon tests). Run:
`corepack pnpm --filter enso-gui run typecheck` and
`corepack pnpm --filter enso-gui run lint` Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/providers/openedProjects/suggestionDatabase/groupInfo.ts app/gui/src/providers/openedProjects/suggestionDatabase/argument.ts app/gui/src/providers/openedProjects/suggestionDatabase/index.ts app/gui/src/providers/openedProjects/suggestionDatabase/entry.ts app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts app/gui/src/project-view/util/groupColors.ts app/gui/src/project-view/util/entryIcon.ts app/gui/src/project-view/util/projectPathKey.ts app/gui/src/project-view/util/__tests__ app/gui/src/project-view/composables/nodeColors.ts app/gui/src/project-view/util/getIconName.ts app/gui/src/project-view/util/projectPath.ts app/gui/src/components/WithCurrentProject.vue
git commit -m "GUI: group colours, icon rule, group info and argument rule in Node-loadable modules"
```

### Task 4: The `docs-site/` package skeleton

A Docusaurus site that builds with no distribution: the guides intro, the
Components intro, an empty Components sidebar.

**Files:**

- Create: `docs-site/package.json`, `docs-site/tsconfig.json`,
  `docs-site/vitest.config.ts`, `docs-site/docusaurus.config.ts`,
  `docs-site/sidebars.ts`, `docs-site/.gitignore`, `docs-site/docs/intro.md`,
  `docs-site/docs/api/index.md`, `docs-site/src/css/custom.css`,
  `docs-site/src/pages/index.tsx`
- Modify: `pnpm-workspace.yaml` (add `- docs-site` after `- app/ydoc-shared`'s
  block, before `- lib/js/runner`), `pnpm-lock.yaml` (by `pnpm install`),
  `eslint.config.mjs` (ignores), `.prettierignore`, `.prettierrc.yaml` (R13)

**Interfaces:**

- Produces: the package `docs-site` with scripts `generate`, `start`, `build`,
  `serve`, `typecheck`, `lint`, `test:unit`, `test:e2e` (no `compile`);
  `sidebars.ts` reads `docs-site/generated/apiSidebars.json` when it exists;
  `docusaurus.config.ts` adds `src/css/groups.generated.css` when it exists.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "docs-site",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "generate": "vite-node --config vitest.config.ts generator/src/main.ts --",
    "start": "docusaurus start",
    "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 docusaurus build",
    "serve": "docusaurus serve --dir build --port 3210 --no-open",
    "clear": "docusaurus clear",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint generator src e2e docusaurus.config.ts sidebars.ts vitest.config.ts playwright.config.ts --cache --max-warnings=0",
    "test:unit": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@docusaurus/core": "3.10.2",
    "@docusaurus/preset-classic": "3.10.2",
    "@easyops-cn/docusaurus-search-local": "0.55.3",
    "@mdx-js/react": "3.1.1",
    "react": "<newest 19.x at least two weeks old, exact>",
    "react-dom": "<same as react>"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.13.0",
    "@docusaurus/module-type-aliases": "3.10.2",
    "@docusaurus/plugin-content-docs": "3.10.2",
    "@docusaurus/theme-classic": "3.10.2",
    "@docusaurus/types": "3.10.2",
    "@lezer/common": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "<matching major, exact>",
    "cross-env": "^7.0.3",
    "enso-common": "workspace:*",
    "playwright": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vite-node": "3.0.3",
    "vitest": "catalog:",
    "yaml": "^2.9.1",
    "ydoc-shared": "workspace:*"
  }
}
```

Fill the two React placeholders with real versions before saving
(`corepack pnpm view react time --json`; the newest 19.x published at least two
weeks ago; `@types/react` the newest of that major). `vite-node` 3.0.3 is
`ydoc-shared`'s; `cross-env` and `yaml` are `app/gui`'s ranges;
`@axe-core/playwright` is the GUI's exact pin. The `@docusaurus/*` type packages
are direct dependencies because `.npmrc` has `hoist=false`: nothing reaches a
package it does not declare.

- [ ] **Step 2: Write `tsconfig.json` and `vitest.config.ts`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [
      "node",
      "@docusaurus/module-type-aliases",
      "@docusaurus/theme-classic"
    ],
    "customConditions": ["source"],
    "paths": {
      "@site/*": ["./*"],
      "@/*": ["../app/gui/src/project-view/*"],
      "$/*": ["../app/gui/src/*"],
      "#/*": ["../app/gui/src/dashboard/*"]
    }
  },
  "include": ["generator", "src", "e2e", "*.ts"]
}
```

`composite: false` matters: the root config is composite, and a composite
project must list every file it reaches in `include`, which the GUI files
reached through the aliases are not (the `TS6307` trap in `app/gui/CLAUDE.md`).
`customConditions: ["source"]` makes `ydoc-shared/*` and `enso-common/src/*`
resolve to their TypeScript sources, as the GUI's own build does.

```ts
// docs-site/vitest.config.ts
/**
 * @file Vite config for the generator, used both by `vitest` (its tests) and by `vite-node` (the
 * `generate` script). It loads the GUI's TypeScript sources as the GUI's tests do: the `source`
 * export condition, and the GUI's three path aliases, restated from `app/gui/vite.config.ts`
 * (`resolve.alias`) rather than imported, since that config loads the GUI's Vue and WASM plugins.
 */
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import nodeVitestConfig from "../app/vitest.node.base";

const guiSrc = (path: string) =>
  fileURLToPath(new URL(`../app/gui/src${path}`, import.meta.url));

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
    resolve: {
      conditions: ["source"],
      alias: {
        "@": guiSrc("/project-view"),
        "#": guiSrc("/dashboard"),
        $: guiSrc(""),
      },
    },
    test: {
      environment: "node",
      include: ["generator/**/*.test.ts"],
    },
  }),
);
```

- [ ] **Step 3: Write the Docusaurus config, sidebars and pages**

```ts
// docs-site/docusaurus.config.ts
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { existsSync } from "node:fs";

/** Written by the generator (`generator/src/output.ts`); absent before the first `generate`. */
const GROUP_COLOURS = "./src/css/groups.generated.css";

const config: Config = {
  title: "Enso",
  tagline: "Visual data preparation and analysis",
  url: "https://jdunkerley.github.io",
  baseUrl: "/enso/",
  // Every page is `<path>/index.html`: a segment like `Table.filter` never looks like a file
  // extension to GitHub Pages, and `…/Table.filter` (no slash) redirects to it.
  trailingSlash: true,
  organizationName: "jdunkerley",
  projectName: "enso",
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  markdown: { hooks: { onBrokenMarkdownLinks: "throw" } },
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      {
        docs: { routeBasePath: "docs", sidebarPath: "./sidebars.ts" },
        blog: false,
        theme: {
          customCss: [
            "./src/css/custom.css",
            ...(existsSync(GROUP_COLOURS) ? [GROUP_COLOURS] : []),
          ],
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    [
      "@easyops-cn/docusaurus-search-local",
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: "docs",
        language: ["en"],
      },
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: "Enso",
      items: [
        {
          type: "docSidebar",
          sidebarId: "guides",
          label: "Guides",
          position: "left",
        },
        {
          type: "docSidebar",
          sidebarId: "api",
          label: "Components",
          position: "left",
        },
        {
          href: "https://github.com/jdunkerley/enso/wiki",
          label: "Developer",
          position: "left",
        },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
```

If the pinned Docusaurus rejects `markdown.hooks` (added in 3.9; 3.10.2 has it),
use the top-level `onBrokenMarkdownLinks: 'throw'` instead.

```ts
// docs-site/sidebars.ts
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";
import { existsSync, readFileSync } from "node:fs";

/** Written by the generator: `api` (the Components intro and the libraries) and one per library. */
const API_SIDEBARS = "./generated/apiSidebars.json";

const apiSidebars: SidebarsConfig = existsSync(API_SIDEBARS)
  ? (JSON.parse(readFileSync(API_SIDEBARS, "utf8")) as SidebarsConfig)
  : { api: [{ type: "doc", id: "api/index", label: "Components" }] };

const sidebars: SidebarsConfig = {
  guides: ["intro"],
  ...apiSidebars,
};

export default sidebars;
```

```tsx
// docs-site/src/pages/index.tsx
import { Redirect } from "@docusaurus/router";
import useBaseUrl from "@docusaurus/useBaseUrl";
import type { JSX } from "react";

/** The site's root sends readers to the guides. */
export default function Home(): JSX.Element {
  return <Redirect to={useBaseUrl("/docs/intro/")} />;
}
```

`docs-site/src/css/custom.css`: the site's own colour tokens for both modes,
nothing copied from upstream:

```css
/* Site colours. Component nodes do not use these: they keep the graph editor's colours. */
:root {
  --ifm-color-primary: #006b8a;
  --ifm-color-primary-dark: #00607c;
  --ifm-color-primary-darker: #005b75;
  --ifm-color-primary-darkest: #004b61;
  --ifm-color-primary-light: #007698;
  --ifm-color-primary-lighter: #007b9f;
  --ifm-color-primary-lightest: #008bb3;
}

[data-theme="dark"] {
  --ifm-color-primary: #4fb7d6;
  --ifm-color-primary-dark: #35acd0;
  --ifm-color-primary-darker: #2ea4c7;
  --ifm-color-primary-darkest: #2687a4;
  --ifm-color-primary-light: #69c2dc;
  --ifm-color-primary-lighter: #73c6df;
  --ifm-color-primary-lightest: #9ad6e8;
}
```

(`#006b8a` is the IDE's `--group-color-fallback`,
`app/gui/src/project-view/assets/base.css:66`; the ramps are Docusaurus's usual
5/7.5/15 % steps. The axe run in Task 12 checks the link contrast in both modes;
darken the dark ramp if it fails.)

`docs-site/docs/intro.md` (placeholder until PR 2):

```md
---
title: Enso documentation
slug: /intro/
---

# Enso documentation

This site documents Enso, the visual environment for preparing and analysing
data. The guides, coming soon, explain how to use the IDE; the
[Components](./api/index.md) reference describes every component of the standard
libraries.

The developer documentation (the engine, the language server, building Enso) is
in the project's [wiki](https://github.com/jdunkerley/enso/wiki).
```

`docs-site/docs/api/index.md` (the Components intro, hand-written, kept by the
generator):

```md
---
title: Components
slug: /api/
---

# Components

This reference describes every component of Enso's standard libraries: what it
does, its arguments and what it returns, with examples. Each page shows the
component as the graph editor draws it; hover over, focus or tap its name or a
parameter to see its type.

The IDE shows the same text in its help panel, next to your work, which is
usually the quickest place to read it. The libraries are listed in the sidebar.
```

- [ ] **Step 4: Ignores**

`docs-site/.gitignore`:

```
/node_modules/
/build/
/.docusaurus/
/generated/
/docs/api/*
!/docs/api/index.md
/src/css/groups.generated.css
/static/img/icons.svg
/test-results/
/playwright-report/
/.eslintcache
/eslint_report.json
```

`.prettierignore`, under `# Generated files`:

```
docs-site/build/
docs-site/.docusaurus/
docs-site/generated/
docs-site/docs/api/
!docs-site/docs/api/index.md
docs-site/src/css/groups.generated.css
docs-site/static/img/icons.svg
docs-site/generator/fixtures/golden/*.mdx
```

`eslint.config.mjs`: add to the first `ignores` list `'docs-site/build/'`,
`'docs-site/.docusaurus/'`, `'docs-site/docs/'`.

`.prettierrc.yaml`: add `- "*.tsx"` after `- "*.ts"` in the first override's
`files` (R13).

- [ ] **Step 5: Install and build the empty site**

```bash
corepack pnpm install
corepack pnpm --filter docs-site run typecheck
corepack pnpm --filter docs-site run build
corepack pnpm --filter docs-site run serve
```

Expected: install resolves (a peer warning for `open-ask-ai` is expected: the
search plugin marks it optional); typecheck clean; the build finishes with no
broken-link error; `http://localhost:3210/enso/` redirects to
`/enso/docs/intro/`, and the navbar shows Guides, Components and Developer, a
search box and the colour-mode switch. Stop the server.

If the build fails to resolve a module from inside a Docusaurus package
(`Module not found: Can't resolve '<x>'`), `hoist=false` is hiding a dependency
the package forgot to declare: add `<x>` to `docs-site`'s own `dependencies` at
the version the lockfile already has, and note it in `docs-site/CLAUDE.md` (Task
14). Do not change `.npmrc`.

- [ ] **Step 6: Lint**

Run: `corepack pnpm --filter docs-site run lint` Expected: no errors. If ESLint
reports parsing errors on `.tsx` files (the root config's TypeScript block not
applying to them), add to `eslint.config.mjs`, after the main rules block:

```js
  {
    files: ['docs-site/**/*.tsx'],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
```

and run the lint again.

- [ ] **Step 7: Commit**

```bash
git add docs-site/package.json docs-site/tsconfig.json docs-site/vitest.config.ts docs-site/docusaurus.config.ts docs-site/sidebars.ts docs-site/.gitignore docs-site/docs/intro.md docs-site/docs/api/index.md docs-site/src/css/custom.css docs-site/src/pages/index.tsx pnpm-workspace.yaml pnpm-lock.yaml eslint.config.mjs .prettierignore .prettierrc.yaml
git commit -m "docs-site: Docusaurus skeleton (guides intro, Components intro)"
```

### Task 5: The generator's view of the GUI, and the Node smoke test

The proof the spec's reading could not give: the GUI's parser, metadata, colour
and icon code load in Node, with no DOM and no WASM, and parse a real doc
comment.

**Files:**

- Create: `docs-site/generator/src/gui.ts`
- Test: `docs-site/generator/src/gui.test.ts`

**Interfaces:**

- Produces (`generator/src/gui.ts`, the only generator module that imports GUI,
  `ydoc-shared` or `enso-common` code; PR 3's path whitelist is checked against
  it): re-exports `documentationData`, `type DocumentationData`,
  `extractMetadata`, `type DocumentationMetadata`, `ensoMarkdownParser`,
  `prerenderMarkdown`, `type GroupInfo`, `groupColor`, `groupColorVar`,
  `colorFromString`, `entryIcon`, `DEFAULT_ICON`, `isIconName`, `type Icon`,
  `isRequiredArgument`, `projectPathKey`, `apiPath`, `memberSegment`,
  `type ApiPathEntry`, `type SuggestionEntryArgument`, `type SuggestionEntry`
  (as `LsSuggestionEntry`).

- [ ] **Step 1: Write the smoke test**

```ts
// docs-site/generator/src/gui.test.ts
// @vitest-environment node
import { expect, test } from "vitest";
import {
  apiPath,
  colorFromString,
  documentationData,
  ensoMarkdownParser,
  entryIcon,
  extractMetadata,
  groupColor,
  groupColorVar,
  isIconName,
  isRequiredArgument,
  prerenderMarkdown,
  projectPathKey,
  type GroupInfo,
  type QualifiedName,
} from "./gui";

// The front matter and the start of `Table.filter`'s doc comment
// (distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso), as the catalogue carries it.
const FILTER_DOC = [
  "---",
  "aliases: [filter rows, where]",
  "group: Standard.Base.Selections",
  "icon: preparation",
  "suggested: 2",
  "---",
  "Creates a new table with a filtered subset of rows.",
  "",
  "The rows are selected from the input table using a condition.",
  "",
  "## Arguments",
  "- ``column``: The column our condition is tested against.",
  "",
  "## Errors",
  "- If a column name cannot be found, a `No_Such_Column` dataflow error is",
  "  raised.",
].join("\n");

const groups: GroupInfo[] = [
  {
    project: "Standard.Base" as QualifiedName,
    name: "Selections",
    color: "oklch(0.464 0.14 325)",
  },
];

test("the GUI modules load without a DOM", () => {
  expect(typeof document).toBe("undefined");
});

test("documentationData reads Table.filter's doc comment as the help panel does", () => {
  const data = documentationData(
    FILTER_DOC,
    "Standard.Table" as QualifiedName,
    groups,
  );
  expect(data.documentationSummary).toBe(
    "Creates a new table with a filtered subset of rows.",
  );
  expect(data.iconName).toBe("preparation");
  expect(data.groupIndex).toBe(0);
  expect(data.aliasesAndMacros).toEqual(["filter rows", "where"]);
  expect(data.documentation).toContain(
    "- If a column name cannot be found, a `No_Such_Column` dataflow error is raised.",
  );
});

test("the parser finds the level-2 headings", () => {
  const text = prerenderMarkdown(FILTER_DOC);
  const headings: string[] = [];
  ensoMarkdownParser.parse(text).iterate({
    enter: (node) => {
      if (node.name === "ATXHeading2")
        headings.push(text.slice(node.from, node.to));
    },
  });
  expect(headings).toEqual(["## Arguments", "## Errors"]);
});

test("metadata, colours, icons, arguments and paths", () => {
  const tree = ensoMarkdownParser.parse(prerenderMarkdown(FILTER_DOC));
  const metadata = extractMetadata(
    prerenderMarkdown(FILTER_DOC),
    tree.cursor().node,
  );
  expect(metadata.ok && metadata.value?.suggested).toBe(2);
  expect(groupColorVar(groups[0])).toBe(
    "--group-color-Standard-Base-Selections",
  );
  expect(groupColor(groups[0]!)).toBe("oklch(0.464 0.14 325)");
  expect(colorFromString("Standard.Table.Table.Table")).toMatch(
    /^(rgb|oklch)\(/,
  );
  expect(entryIcon({ kind: "Method" })).toBe("enso_logo");
  expect(isIconName("preparation")).toBe(true);
  expect(
    isRequiredArgument({
      name: "column",
      reprType: "Any",
      isSuspended: false,
      hasDefault: true,
      defaultValue: 'Missing_Argument.throw "column"',
    }),
  ).toBe(true);
  expect(projectPathKey("Standard.Table", "Table.Table")).toBe(
    "Standard.Table.Table.Table",
  );
  expect(
    apiPath({ kind: "type", module: "Standard.Table.Table", name: "Table" }),
  ).toBe("Standard.Table/Table/Table");
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL, `./gui`
does not exist.

- [ ] **Step 2: Write `gui.ts`**

```ts
// docs-site/generator/src/gui.ts
/**
 * @file Everything the generator takes from the IDE's code, in one place: the doc-comment parser
 * and its metadata, the group colours, the icon rule, the argument rule and the page paths. The
 * site and the IDE's help panel agree because these are the IDE's functions, not copies. PR 3's
 * workflow path list (`.github/workflows/docs-site.yml`) is checked against the imports below; add
 * a path there when adding one here.
 */
export {
  documentationData,
  type DocumentationData,
} from "$/providers/openedProjects/suggestionDatabase/documentation";
export { isRequiredArgument } from "$/providers/openedProjects/suggestionDatabase/argument";
export type { GroupInfo } from "$/providers/openedProjects/suggestionDatabase/groupInfo";
export {
  extractMetadata,
  type DocumentationMetadata,
} from "@/components/ComponentHelp/metadata";
export { colorFromString } from "@/util/colors";
export { DEFAULT_ICON, entryIcon } from "@/util/entryIcon";
export { groupColor, groupColorVar } from "@/util/groupColors";
export { isIconName, type Icon } from "@/util/iconMetadata/iconName";
export { projectPathKey } from "@/util/projectPathKey";
export type { QualifiedName } from "@/util/qualifiedName";
export {
  apiPath,
  memberSegment,
  type ApiPathEntry,
} from "enso-common/src/docsSite/apiPath";
export { ensoMarkdownParser } from "ydoc-shared/ast/ensoMarkdown";
export { prerenderMarkdown } from "ydoc-shared/ast/prerenderMarkdown";
export type {
  SuggestionEntry as LsSuggestionEntry,
  SuggestionEntryArgument,
} from "ydoc-shared/languageServerTypes/suggestions";
```

- [ ] **Step 3: Run the smoke test**

Run: `corepack pnpm --filter docs-site run test:unit` Expected: PASS. A failure
that names `ffi`, `rust-ffi`, `hash-wasm`, `generated/ast`,
`document is not defined`, `window is not defined` or a `.vue` file means a
module still drags in browser or WASM code: find which import brings it
(`vite-node --config vitest.config.ts -e "import('./generator/src/gui.ts')"`
prints the chain in its stack), and move the needed code out of that module as
Task 3 did, re-exporting it from the old place. Never copy it.

- [ ] **Step 4: Check what the type checker reaches**

Run:
`corepack pnpm --filter docs-site exec tsc --noEmit -p tsconfig.json --listFilesOnly > ../scratch-files.txt`
(from `docs-site/`; the file goes to the worktree root, delete it afterwards)
and search it:
`Grep pattern "app[/\\\\]gui[/\\\\].*\\.vue|suggestionDatabase[/\\\\]index\\.ts" path <that file>`.
Expected: no match. Type-only imports still make `tsc` load and check a file, so
a GUI module that reaches the suggestion database's `index.ts` or a `.vue` file
would make `docs-site`'s typecheck check the GUI app (and fail on `.vue`
imports). If one appears, find the importer in the list and move the type it
needs, as `GroupInfo` was moved. `@/util/qualifiedName` reaching
`@/util/ast/abstract` and `ydoc-shared/ast` is expected and harmless: they are
`.ts`, and the GUI checks (where `typecheck` runs in CI) have the generated AST.
Then: `corepack pnpm --filter docs-site run typecheck` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add docs-site/generator/src/gui.ts docs-site/generator/src/gui.test.ts
git commit -m "docs-site: the generator's imports of the GUI, proven to load in Node"
```

### Task 6: Reading catalogues and component groups; the fixture libraries

**Files:**

- Create: `docs-site/generator/src/catalogue.ts`,
  `docs-site/generator/src/groups.ts`
- Create:
  `docs-site/generator/fixtures/lib/Standard/Fixture/0.0.0-dev/package.yaml`,
  `…/catalogue.json`,
  `docs-site/generator/fixtures/lib/Standard/Fixture_Ext/0.0.0-dev/package.yaml`,
  `…/catalogue.json`
- Test: `docs-site/generator/src/catalogue.test.ts`,
  `docs-site/generator/src/groups.test.ts`

**Interfaces:**

- Consumes: `GroupInfo`, `QualifiedName`, `LsSuggestionEntry` from `./gui`.
- Produces:
  - `type CatalogueEntry = LsSuggestionEntry & { reexports?: string[] }`
  - `interface Catalogue { format: 1; library: string; version: string; engineVersion: string; sourceHash: string; entries: CatalogueEntry[] }`
  - `interface LibraryInput { name: string; dir: string; groups: GroupInfo[]; catalogue: Catalogue | undefined }`
  - `CATALOGUE_FORMAT = 1`
  - `readCatalogue(file: string): Catalogue` (throws `Error` naming the library
    and format when `format !== 1`)
  - `findLibraryDirs(root: string): string[]` (every
    `<root>/<namespace>/<name>/<version>` holding a `package.yaml`)
  - `readLibraries(roots: string[]): LibraryInput[]` (each `root` is a
    distribution's `lib` directory or one library's directory)
  - `readGroups(packageYaml: string): { library: string; groups: GroupInfo[] }`
    (`library` is `<namespace>.<name>`)
  - `FIXTURES_LIB: string` (absolute path of `generator/fixtures/lib`, exported
    from `catalogue.ts` for tests and `--fixtures`)

- [ ] **Step 1: Write the fixtures**

The entries follow `SuggestionJson` exactly (spec, "Where things are today"):
methods list `self` first; a conversion is a non-static method named `from`
whose first argument is `that`, with `selfType` and `returnType` both the target
type (`SuggestionBuilder.buildConversion`); getters are plain methods.

`docs-site/generator/fixtures/lib/Standard/Fixture/0.0.0-dev/package.yaml`:

```yaml
name: Fixture
namespace: Standard
version: 0.0.0-dev
component-groups:
  new:
    - Selections: { color: oklch(0.464 0.14 325) }
    - Shaping
```

`docs-site/generator/fixtures/lib/Standard/Fixture/0.0.0-dev/catalogue.json`
(one entry per case the spec's testing section lists):

````json
{
  "format": 1,
  "library": "Standard.Fixture",
  "version": "0.0.0-dev",
  "engineVersion": "0.0.0-dev",
  "sourceHash": "fixture",
  "entries": [
    {
      "type": "module",
      "module": "Standard.Fixture.Main",
      "documentation": "The fixture library.",
      "reexports": []
    },
    {
      "type": "module",
      "module": "Standard.Fixture.Shapes",
      "documentation": "Shapes and what to do with them.",
      "reexports": []
    },
    {
      "type": "type",
      "module": "Standard.Fixture.Shapes",
      "name": "Shape",
      "params": [],
      "parentType": "Standard.Base.Any.Any",
      "documentation": "A shape.\n\nUse `Square` for squares.",
      "reexport": "Standard.Fixture.Main",
      "reexports": ["Standard.Fixture.Main"]
    },
    {
      "type": "type",
      "module": "Standard.Fixture.Shapes",
      "name": "Square",
      "params": [],
      "parentType": "Standard.Fixture.Shapes.Shape",
      "documentation": "A square.",
      "reexports": []
    },
    {
      "type": "constructor",
      "module": "Standard.Fixture.Shapes",
      "name": "Value",
      "arguments": [
        {
          "name": "side",
          "reprType": "Standard.Base.Data.Numbers.Float",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "returnType": "Standard.Fixture.Shapes.Square",
      "documentation": "A square of the given side.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "unit",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Fixture.Shapes.Square",
      "isStatic": true,
      "documentation": "---\ngroup: Shaping\n---\nThe unit square.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "area",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        },
        {
          "name": "units",
          "reprType": "Standard.Base.Data.Text.Text | Standard.Base.Nothing.Nothing",
          "isSuspended": false,
          "hasDefault": true,
          "defaultValue": "Nothing",
          "tagValues": ["'cm'", "'m'"]
        },
        {
          "name": "scale",
          "reprType": "Standard.Base.Data.Numbers.Float",
          "isSuspended": true,
          "hasDefault": true,
          "defaultValue": "Missing_Argument.throw \"scale\""
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Base.Data.Numbers.Float",
      "isStatic": false,
      "documentation": "---\naliases: [size, extent]\nmacros:\n  - doubled: scale=2\ngroup: Standard.Fixture.Selections\nicon: preparation\nadvanced: true\ndeprecated: true\nunstable: true\nadded: '2026.1'\nmodified: '2026.2'\nremoved: '2026.3'\n---\nThe area of a shape. Uses {braces} and <angles>.\n\nMore text, see `Square` and `Square.side`.\n\n## Arguments\n- `units`: The units.\n- ``scale``: How much to scale by.\n- `extra`: Not an argument.\n\n## Returns\nThe area as a `Float`.\n\n## Examples\n### Area of a unit square.\n\n```\nShape.unit.area\n```\nReturns\n\n        | Area |\n        |------|\n        | 1    |\n\n## Errors\n- `Illegal_Argument` when the scale is negative.\n\n## Remarks\n### Precision\nFloats are approximate.\n\n## Implementation Notes\nNot for users.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "side",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Square",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Square",
      "returnType": "Standard.Base.Data.Numbers.Float",
      "isStatic": false,
      "documentation": "The side of the square.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "from",
      "arguments": [
        {
          "name": "that",
          "reprType": "Standard.Base.Data.Numbers.Integer",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Square",
      "returnType": "Standard.Fixture.Shapes.Square",
      "isStatic": false,
      "documentation": "A square with an integer side.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "from",
      "arguments": [
        {
          "name": "that",
          "reprType": "Standard.Base.Data.Text.Text",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Square",
      "returnType": "Standard.Fixture.Shapes.Square",
      "isStatic": false,
      "documentation": "A square parsed from text.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "+",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        },
        {
          "name": "that",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Fixture.Shapes.Shape",
      "isStatic": false,
      "documentation": "Two shapes side by side.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "make_shape",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes",
      "returnType": "Standard.Base.Any.Any",
      "isStatic": false,
      "documentation": "Makes some shape.",
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "undocumented",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Fixture.Shapes.Square",
      "isStatic": false,
      "annotations": [],
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture.Shapes",
      "name": "odd_icon",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Fixture.Shapes.Shape | Standard.Base.Nothing.Nothing",
      "isStatic": false,
      "documentation": "---\nicon: not_an_icon\n---\nHas an icon the IDE does not know.",
      "annotations": [],
      "reexports": []
    }
  ]
}
````

`docs-site/generator/fixtures/lib/Standard/Fixture_Ext/0.0.0-dev/package.yaml`:

```yaml
name: Fixture_Ext
namespace: Standard
version: 0.0.0-dev
```

`…/Fixture_Ext/0.0.0-dev/catalogue.json`:

```json
{
  "format": 1,
  "library": "Standard.Fixture_Ext",
  "version": "0.0.0-dev",
  "engineVersion": "0.0.0-dev",
  "sourceHash": "fixture",
  "entries": [
    {
      "type": "module",
      "module": "Standard.Fixture_Ext.Main",
      "documentation": "Extensions of the fixture.",
      "reexports": []
    },
    {
      "type": "module",
      "module": "Standard.Fixture_Ext.Describe",
      "reexports": []
    },
    {
      "type": "method",
      "module": "Standard.Fixture_Ext.Describe",
      "name": "describe",
      "arguments": [
        {
          "name": "self",
          "reprType": "Standard.Fixture.Shapes.Shape",
          "isSuspended": false,
          "hasDefault": false
        }
      ],
      "selfType": "Standard.Fixture.Shapes.Shape",
      "returnType": "Standard.Base.Data.Text.Text",
      "isStatic": false,
      "documentation": "---\ngroup: Standard.Fixture.Shaping\n---\nDescribes a shape in words.",
      "annotations": [],
      "reexports": []
    }
  ]
}
```

Run `corepack pnpm exec prettier --write docs-site/generator/fixtures` after
writing them (the JSON is formatted like any other).

- [ ] **Step 2: Write the failing tests**

```ts
// docs-site/generator/src/groups.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { expect, test } from "vitest";
import { readGroups } from "./groups";

test("groups of a fixture library: declared colour or none", () => {
  const yaml =
    "name: Fixture\nnamespace: Standard\ncomponent-groups:\n  new:\n    - Selections: { color: oklch(0.464 0.14 325) }\n    - Shaping\n";
  expect(readGroups(yaml)).toEqual({
    library: "Standard.Fixture",
    groups: [
      {
        project: "Standard.Fixture",
        name: "Selections",
        color: "oklch(0.464 0.14 325)",
      },
      { project: "Standard.Fixture", name: "Shaping" },
    ],
  });
});

test("a library without component groups has none; `extends` adds no group", () => {
  expect(readGroups("name: X\nnamespace: Standard\n").groups).toEqual([]);
  expect(
    readGroups(
      "name: X\nnamespace: Standard\ncomponent-groups:\n  extends:\n    - Standard.Base.Input:\n        exports: [a]\n",
    ).groups,
  ).toEqual([]);
});

test("parity: Standard.Base's groups and colours are package.yaml's", () => {
  const file = fileURLToPath(
    new URL(
      "../../../distribution/lib/Standard/Base/0.0.0-dev/package.yaml",
      import.meta.url,
    ),
  );
  const text = readFileSync(file, "utf8");
  const declared = (
    parse(text)["component-groups"].new as Record<string, { color?: string }>[]
  ).map((group) => Object.entries(group)[0]!);
  const { library, groups } = readGroups(text);
  expect(library).toBe("Standard.Base");
  expect(groups.map((group) => [group.name, group.color])).toEqual(
    declared.map(([name, value]) => [name, value.color]),
  );
});
```

```ts
// docs-site/generator/src/catalogue.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  FIXTURES_LIB,
  findLibraryDirs,
  readCatalogue,
  readLibraries,
} from "./catalogue";

test("finds every library directory under a lib root", () => {
  expect(
    findLibraryDirs(FIXTURES_LIB).map((dir) =>
      dir.replaceAll("\\", "/").split("/").slice(-3).join("/"),
    ),
  ).toEqual(["Standard/Fixture/0.0.0-dev", "Standard/Fixture_Ext/0.0.0-dev"]);
});

test("reads the fixture libraries with their groups and catalogues", () => {
  const libraries = readLibraries([FIXTURES_LIB]);
  expect(libraries.map((library) => library.name)).toEqual([
    "Standard.Fixture",
    "Standard.Fixture_Ext",
  ]);
  expect(libraries[0]!.groups.map((group) => group.name)).toEqual([
    "Selections",
    "Shaping",
  ]);
  expect(libraries[0]!.catalogue?.entries.length).toBe(14);
});

test("a library without a catalogue is kept for its groups, with no catalogue", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-site-"));
  writeFileSync(
    join(dir, "package.yaml"),
    "name: Nocat\nnamespace: Standard\n",
  );
  expect(readLibraries([dir])).toEqual([
    { name: "Standard.Nocat", dir, groups: [], catalogue: undefined },
  ]);
});

test("a catalogue of another format fails, naming the library", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-site-"));
  const file = join(dir, "catalogue.json");
  writeFileSync(
    file,
    JSON.stringify({ format: 2, library: "Standard.Future", entries: [] }),
  );
  expect(() => readCatalogue(file)).toThrow(/Standard\.Future.*format 2/);
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL, `./groups`
and `./catalogue` do not exist.

- [ ] **Step 3: Implement**

```ts
// docs-site/generator/src/groups.ts
import { parse } from "yaml";
import type { GroupInfo, QualifiedName } from "./gui";

/**
 * A library's name and its component groups, from its `package.yaml`, as the language server gives
 * them to the GUI (`loadGroups` in the suggestion database): each entry of `component-groups.new`
 * is `Name` or `Name: { color: … }`. `extends` adds components to other libraries' groups and
 * creates none, so it plays no part in colours.
 */
export function readGroups(packageYaml: string): {
  library: string;
  groups: GroupInfo[];
} {
  const config = parse(packageYaml) as {
    name: string;
    namespace: string;
    "component-groups"?: {
      new?: (string | Record<string, { color?: string } | null>)[];
    };
  };
  const library = `${config.namespace}.${config.name}`;
  const groups = (config["component-groups"]?.new ?? []).map(
    (group): GroupInfo => {
      const [name, settings] =
        typeof group === "string" ? [group, null] : Object.entries(group)[0]!;
      return {
        project: library as QualifiedName,
        name,
        ...(settings?.color ? { color: settings.color } : {}),
      };
    },
  );
  return { library, groups };
}
```

```ts
// docs-site/generator/src/catalogue.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGroups } from "./groups";
import type { GroupInfo, LsSuggestionEntry } from "./gui";

/** The catalogue format this generator reads (`LibraryCatalogue.Format`). */
export const CATALOGUE_FORMAT = 1;

/** A catalogue entry: the language server's `SuggestionEntry`, plus the full reexport set. */
export type CatalogueEntry = LsSuggestionEntry & { reexports?: string[] };

/** A library's `catalogue.json` (`LibraryCatalogue.toJson`). */
export interface Catalogue {
  format: 1;
  library: string;
  version: string;
  engineVersion: string;
  sourceHash: string;
  entries: CatalogueEntry[];
}

/** One library directory: its name, groups and, unless it has none, its catalogue. */
export interface LibraryInput {
  name: string;
  dir: string;
  groups: GroupInfo[];
  catalogue: Catalogue | undefined;
}

/** The fixture libraries, for tests and `generate --fixtures`. */
export const FIXTURES_LIB = fileURLToPath(
  new URL("../fixtures/lib", import.meta.url),
);

/** Read a `catalogue.json`; a format this generator does not know fails the run. */
export function readCatalogue(file: string): Catalogue {
  const catalogue = JSON.parse(readFileSync(file, "utf8")) as Catalogue;
  if (catalogue.format !== CATALOGUE_FORMAT) {
    throw new Error(
      `${catalogue.library}: catalogue format ${catalogue.format as number}, expected ${CATALOGUE_FORMAT} (${file})`,
    );
  }
  return catalogue;
}

const isDir = (path: string) =>
  existsSync(path) && statSync(path).isDirectory();
const subdirs = (path: string) =>
  readdirSync(path)
    .sort()
    .map((name) => join(path, name))
    .filter(isDir);

/** Every `<root>/<namespace>/<name>/<version>` directory that holds a `package.yaml`. */
export function findLibraryDirs(root: string): string[] {
  return subdirs(root)
    .flatMap(subdirs)
    .flatMap(subdirs)
    .filter((dir) => existsSync(join(dir, "package.yaml")));
}

/**
 * The libraries under each root, which is a distribution's `lib` directory or one library's own
 * directory. Libraries without a catalogue (`catalogue: false` in `package.yaml`) keep their groups,
 * which other libraries' entries may name, and get no pages.
 */
export function readLibraries(roots: string[]): LibraryInput[] {
  const dirs = roots.flatMap((root) =>
    existsSync(join(root, "package.yaml")) ? [root] : findLibraryDirs(root),
  );
  return dirs.map((dir) => {
    const { library, groups } = readGroups(
      readFileSync(join(dir, "package.yaml"), "utf8"),
    );
    const file = join(dir, "catalogue.json");
    return {
      name: library,
      dir,
      groups,
      catalogue: existsSync(file) ? readCatalogue(file) : undefined,
    };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter docs-site run test:unit` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs-site/generator/src/catalogue.ts docs-site/generator/src/groups.ts docs-site/generator/src/catalogue.test.ts docs-site/generator/src/groups.test.ts docs-site/generator/fixtures/lib
git commit -m "docs-site: read catalogues and component groups; fixture libraries"
```

### Task 7: The site model: classification, paths, the type index, collisions

**Files:**

- Create: `docs-site/generator/src/typeText.ts`,
  `docs-site/generator/src/model.ts`
- Test: `docs-site/generator/src/typeText.test.ts`,
  `docs-site/generator/src/model.test.ts`

**Interfaces:**

- Consumes: `LibraryInput`, `CatalogueEntry` (Task 6); `apiPath`,
  `documentationData`, `extractMetadata`, `prerenderMarkdown`,
  `ensoMarkdownParser`, `type DocumentationData`, `type DocumentationMetadata`,
  `type GroupInfo` from `./gui`.
- Produces (`typeText.ts`):
  - `QUALIFIED_NAME: RegExp` (global)
  - `simpleName(qualifiedName: string): string`
  - `unqualifiedType(type: string): string`
    (`Standard.Table.Column.Column | Standard.Base.Data.Text.Text` →
    `Column | Text`)
- Produces (`model.ts`):
  - `type PageKind = 'library' | 'module' | 'type' | 'constructor' | 'staticMethod' | 'instanceMethod' | 'moduleFunction' | 'extensionMethod'`
  - `type FunctionKind = Exclude<PageKind, 'library' | 'module' | 'type'>`
  - `interface Page { kind: PageKind; library: string; path: string; title: string; nodeName: string; entry: CatalogueEntry | undefined; doc: DocumentationData; metadata: DocumentationMetadata | undefined; module: string }`
    (`title` is the `h1`: `Table.filter`, `Filter_Condition.Equal`, `read`,
    `Table`, `Standard.Table.Table`; `nodeName` the node's label: `filter`,
    `Table.new`, `Filter_Condition.Equal`, `read`)
  - `interface Conversion { target: string; source: string; doc: DocumentationData; library: string }`
  - `interface SiteModel { libraries: string[]; groups: GroupInfo[]; pages: Page[]; byPath: Map<string, Page>; types: Map<string, Page>; conversions: Map<string, Conversion[]>; extensions: Map<string, Page[]>; skipped: string[]; caseCollisions: [string, string][] }`
  - `isFunctionPage(page: Page): page is Page & { kind: FunctionKind; entry: CatalogueEntry }`
  - `buildModel(libraries: LibraryInput[]): SiteModel` — throws on two entries
    with one path; records (does not throw on) case-only collisions, for Task
    13's ruling.

- [ ] **Step 1: Write the failing tests**

```ts
// docs-site/generator/src/typeText.test.ts
import { expect, test } from "vitest";
import { simpleName, unqualifiedType } from "./typeText";

test.each([
  ["Standard.Table.Table.Table & Standard.Base.Any.Any", "Table & Any"],
  [
    "Standard.Table.Column.Column | Standard.Table.Expression.Expression | Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer",
    "Column | Expression | Text | Integer",
  ],
  [
    "Standard.Base.Data.Filter_Condition.Filter_Condition | (Standard.Base.Any.Any -> Standard.Base.Data.Boolean.Boolean)",
    "Filter_Condition | (Any -> Boolean)",
  ],
  [
    "Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text",
    "Vector Text",
  ],
  ["Any", "Any"],
])("%s → %s", (type, expected) => {
  expect(unqualifiedType(type)).toBe(expected);
});

test("simpleName", () => {
  expect(simpleName("Standard.Table.Table.Table")).toBe("Table");
  expect(simpleName("Table")).toBe("Table");
});
```

```ts
// docs-site/generator/src/model.test.ts
import { expect, test } from "vitest";
import { FIXTURES_LIB, readLibraries, type LibraryInput } from "./catalogue";
import { buildModel, isFunctionPage } from "./model";

const model = buildModel(readLibraries([FIXTURES_LIB]));
const page = (path: string) => model.byPath.get(path);

test("classification and paths", () => {
  expect([...model.byPath.keys()].sort()).toEqual([
    "Standard.Fixture",
    "Standard.Fixture/Shapes",
    "Standard.Fixture/Shapes/Shape",
    "Standard.Fixture/Shapes/Shape.area",
    "Standard.Fixture/Shapes/Shape.odd_icon",
    "Standard.Fixture/Shapes/Shape.op-2b",
    "Standard.Fixture/Shapes/Shape.undocumented",
    "Standard.Fixture/Shapes/Shape.unit",
    "Standard.Fixture/Shapes/Square",
    "Standard.Fixture/Shapes/Square.Value",
    "Standard.Fixture/Shapes/Square.side",
    "Standard.Fixture/Shapes/make_shape",
    "Standard.Fixture_Ext",
    "Standard.Fixture_Ext/Describe",
    "Standard.Fixture_Ext/Describe/Shape.describe",
  ]);
  expect(page("Standard.Fixture")?.kind).toBe("library");
  expect(page("Standard.Fixture/Shapes")?.kind).toBe("module");
  expect(page("Standard.Fixture/Shapes/Square.Value")?.kind).toBe(
    "constructor",
  );
  expect(page("Standard.Fixture/Shapes/Shape.unit")?.kind).toBe("staticMethod");
  expect(page("Standard.Fixture/Shapes/Shape.area")?.kind).toBe(
    "instanceMethod",
  );
  expect(page("Standard.Fixture/Shapes/Square.side")?.kind).toBe(
    "instanceMethod",
  );
  expect(page("Standard.Fixture/Shapes/make_shape")?.kind).toBe(
    "moduleFunction",
  );
  expect(page("Standard.Fixture_Ext/Describe/Shape.describe")?.kind).toBe(
    "extensionMethod",
  );
});

test("titles and node names", () => {
  expect(page("Standard.Fixture/Shapes/Shape.area")).toMatchObject({
    title: "Shape.area",
    nodeName: "area",
  });
  expect(page("Standard.Fixture/Shapes/Shape.unit")).toMatchObject({
    title: "Shape.unit",
    nodeName: "Shape.unit",
  });
  expect(page("Standard.Fixture/Shapes/Square.Value")).toMatchObject({
    title: "Square.Value",
    nodeName: "Square.Value",
  });
  expect(page("Standard.Fixture/Shapes/make_shape")).toMatchObject({
    title: "make_shape",
    nodeName: "make_shape",
  });
  expect(page("Standard.Fixture/Shapes/Shape.op-2b")).toMatchObject({
    title: "Shape.+",
    nodeName: "+",
  });
  expect(page("Standard.Fixture")?.title).toBe("Standard.Fixture");
});

test("conversions get no page and are listed on the target type", () => {
  expect(
    model.conversions
      .get("Standard.Fixture.Shapes.Square")
      ?.map((c) => c.source),
  ).toEqual([
    "Standard.Base.Data.Numbers.Integer",
    "Standard.Base.Data.Text.Text",
  ]);
});

test("extension methods are indexed by their self type", () => {
  expect(
    model.extensions.get("Standard.Fixture.Shapes.Shape")?.map((p) => p.path),
  ).toEqual(["Standard.Fixture_Ext/Describe/Shape.describe"]);
});

test("the type index", () => {
  expect(model.types.get("Standard.Fixture.Shapes.Square")?.path).toBe(
    "Standard.Fixture/Shapes/Square",
  );
  expect(model.types.has("Standard.Base.Any.Any")).toBe(false);
});

test("the groups of every library, with or without a catalogue", () => {
  expect(model.groups.map((group) => `${group.project}.${group.name}`)).toEqual(
    ["Standard.Fixture.Selections", "Standard.Fixture.Shaping"],
  );
});

test("function pages", () => {
  expect(model.pages.filter(isFunctionPage).length).toBe(9);
});

test("two entries with one path fail the run", () => {
  const libraries = readLibraries([FIXTURES_LIB]);
  const fixture = libraries[0]!;
  const duplicate = fixture.catalogue!.entries.find(
    (entry) => entry.type === "method" && entry.name === "area",
  )!;
  const doubled: LibraryInput = {
    ...fixture,
    catalogue: {
      ...fixture.catalogue!,
      entries: [...fixture.catalogue!.entries, duplicate],
    },
  };
  expect(() => buildModel([doubled, libraries[1]!])).toThrow(
    /Standard\.Fixture\/Shapes\/Shape\.area/,
  );
});

test("paths that differ only in case are recorded", () => {
  const libraries = readLibraries([FIXTURES_LIB]);
  const fixture = libraries[0]!;
  const side = fixture.catalogue!.entries.find(
    (entry) => entry.type === "method" && entry.name === "side",
  )!;
  const upper = { ...side, name: "Side" };
  const withUpper: LibraryInput = {
    ...fixture,
    catalogue: {
      ...fixture.catalogue!,
      entries: [...fixture.catalogue!.entries, upper],
    },
  };
  expect(buildModel([withUpper, libraries[1]!]).caseCollisions).toEqual([
    [
      "Standard.Fixture/Shapes/Square.side",
      "Standard.Fixture/Shapes/Square.Side",
    ],
  ]);
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL, the
modules do not exist.

- [ ] **Step 2: Implement `typeText.ts`**

```ts
// docs-site/generator/src/typeText.ts
/** A fully qualified name inside a type expression (`Standard.Base.Data.Text.Text`). */
export const QUALIFIED_NAME =
  /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g;

/** The last segment of a qualified name. */
export function simpleName(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);
}

/** A type expression with every qualified name shortened, as the graph editor shows types. */
export function unqualifiedType(type: string): string {
  return type.replace(QUALIFIED_NAME, simpleName);
}
```

- [ ] **Step 3: Implement `model.ts`**

```ts
// docs-site/generator/src/model.ts
/**
 * @file The site's pages, from the catalogues: what each entry is (spec, "The generator", step 3),
 * its path (`apiPath`), the GUI's reading of its doc comment, and the indexes the pages link
 * through.
 */
import type { CatalogueEntry, LibraryInput } from "./catalogue";
import {
  apiPath,
  documentationData,
  ensoMarkdownParser,
  extractMetadata,
  prerenderMarkdown,
  type ApiPathEntry,
  type DocumentationData,
  type DocumentationMetadata,
  type GroupInfo,
  type QualifiedName,
} from "./gui";
import { simpleName } from "./typeText";

export type PageKind =
  | "library"
  | "module"
  | "type"
  | "constructor"
  | "staticMethod"
  | "instanceMethod"
  | "moduleFunction"
  | "extensionMethod";
export type FunctionKind = Exclude<PageKind, "library" | "module" | "type">;

/** One page of the Components reference. */
export interface Page {
  kind: PageKind;
  library: string;
  /** The defining module, fully qualified (for a library page, its `Main`). */
  module: string;
  path: string;
  /** The page's `h1`. */
  title: string;
  /** The label of the component node; the title's last part for instance methods. */
  nodeName: string;
  entry: CatalogueEntry | undefined;
  doc: DocumentationData;
  metadata: DocumentationMetadata | undefined;
}

/** A conversion, listed on its target type's page. */
export interface Conversion {
  target: string;
  source: string;
  library: string;
  doc: DocumentationData;
}

export interface SiteModel {
  libraries: string[];
  groups: GroupInfo[];
  pages: Page[];
  byPath: Map<string, Page>;
  /** Every documented type's qualified name to its page. */
  types: Map<string, Page>;
  /** Conversions by target type. */
  conversions: Map<string, Conversion[]>;
  /** Extension methods by self type. */
  extensions: Map<string, Page[]>;
  /** Libraries with no catalogue. */
  skipped: string[];
  /** Pairs of paths that differ only in case (Task 13 decides what to do with any). */
  caseCollisions: [string, string][];
}

const FUNCTION_KINDS = new Set<PageKind>([
  "constructor",
  "staticMethod",
  "instanceMethod",
  "moduleFunction",
  "extensionMethod",
]);

export function isFunctionPage(
  page: Page,
): page is Page & { kind: FunctionKind; entry: CatalogueEntry } {
  return FUNCTION_KINDS.has(page.kind) && page.entry != null;
}

/** `SuggestionJson.isConversion`: `from`, not static, first argument `that`. */
function isConversion(entry: CatalogueEntry & { type: "method" }): boolean {
  return (
    entry.name === "from" &&
    !entry.isStatic &&
    entry.arguments[0]?.name === "that"
  );
}

function metadataOf(
  documentation: string | undefined,
): DocumentationMetadata | undefined {
  const text = prerenderMarkdown(documentation ?? "");
  const result = extractMetadata(
    text,
    ensoMarkdownParser.parse(text).cursor().node,
  );
  return result.ok ? (result.value ?? undefined) : undefined;
}

export function buildModel(libraries: LibraryInput[]): SiteModel {
  const groups = libraries.flatMap((library) => library.groups);
  const model: SiteModel = {
    libraries: [],
    groups,
    pages: [],
    byPath: new Map(),
    types: new Map(),
    conversions: new Map(),
    extensions: new Map(),
    skipped: libraries
      .filter((library) => !library.catalogue)
      .map((library) => library.name),
    caseCollisions: [],
  };
  const lowerCase = new Map<string, string>();

  const add = (page: Page) => {
    const existing = model.byPath.get(page.path);
    if (existing)
      throw new Error(
        `Two pages at ${page.path}: ${existing.title} and ${page.title}`,
      );
    const folded = lowerCase.get(page.path.toLowerCase());
    if (folded) model.caseCollisions.push([folded, page.path]);
    else lowerCase.set(page.path.toLowerCase(), page.path);
    model.byPath.set(page.path, page);
    model.pages.push(page);
    return page;
  };
  const docOf = (entry: CatalogueEntry | undefined, library: string) =>
    documentationData(entry?.documentation, library as QualifiedName, groups);

  for (const library of libraries) {
    const catalogue = library.catalogue;
    if (!catalogue) continue;
    model.libraries.push(library.name);
    const main = catalogue.entries.find(
      (entry) =>
        entry.type === "module" && entry.module === `${library.name}.Main`,
    );
    add({
      kind: "library",
      library: library.name,
      module: `${library.name}.Main`,
      path: apiPath({ kind: "module", module: `${library.name}.Main` }),
      title: library.name,
      nodeName: library.name,
      entry: main,
      doc: docOf(main, library.name),
      metadata: metadataOf(main?.documentation),
    });
    const typeNames = new Set(
      catalogue.entries.flatMap((entry) =>
        entry.type === "type" ? [`${entry.module}.${entry.name}`] : [],
      ),
    );
    for (const entry of catalogue.entries) {
      const base = {
        library: library.name,
        entry,
        doc: docOf(entry, library.name),
        metadata: metadataOf(entry.documentation),
      };
      switch (entry.type) {
        case "module":
          if (entry.module === `${library.name}.Main`) break;
          add({
            ...base,
            kind: "module",
            module: entry.module,
            path: apiPath({ kind: "module", module: entry.module }),
            title: entry.module,
            nodeName: entry.module,
          });
          break;
        case "type": {
          const page = add({
            ...base,
            kind: "type",
            module: entry.module,
            path: apiPath({
              kind: "type",
              module: entry.module,
              name: entry.name,
            }),
            title: entry.name,
            nodeName: entry.name,
          });
          model.types.set(`${entry.module}.${entry.name}`, page);
          break;
        }
        case "constructor": {
          const owner = simpleName(entry.returnType);
          const name = `${owner}.${entry.name}`;
          add({
            ...base,
            kind: "constructor",
            module: entry.module,
            path: apiPath({
              kind: "constructor",
              module: entry.module,
              name: entry.name,
              owner: entry.returnType,
            }),
            title: name,
            nodeName: name,
          });
          break;
        }
        case "method": {
          if (isConversion(entry)) {
            const conversions = model.conversions.get(entry.selfType) ?? [];
            conversions.push({
              target: entry.selfType,
              source: entry.arguments[0]!.reprType,
              library: library.name,
              doc: base.doc,
            });
            model.conversions.set(entry.selfType, conversions);
            break;
          }
          const pathEntry: ApiPathEntry = {
            kind: "method",
            module: entry.module,
            name: entry.name,
            owner: entry.selfType,
          };
          const isModuleFunction = entry.selfType === entry.module;
          const isExtension =
            !isModuleFunction && !typeNames.has(entry.selfType);
          const owner = simpleName(entry.selfType);
          const kind: FunctionKind = isModuleFunction
            ? "moduleFunction"
            : isExtension
              ? "extensionMethod"
              : entry.isStatic
                ? "staticMethod"
                : "instanceMethod";
          const page = add({
            ...base,
            kind,
            module: entry.module,
            path: apiPath(pathEntry),
            title: isModuleFunction ? entry.name : `${owner}.${entry.name}`,
            nodeName:
              isModuleFunction || !entry.isStatic
                ? entry.name
                : `${owner}.${entry.name}`,
          });
          if (isExtension) {
            const extensions = model.extensions.get(entry.selfType) ?? [];
            extensions.push(page);
            model.extensions.set(entry.selfType, extensions);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return model;
}
```

"Extension" here is "self type not defined in this library's catalogue", which
covers both the spec's cases (a type of another module, often another library)
except a method defined in one module of a library on a type of another module
of the same library: that is listed as a static or instance method of the type,
as the component browser shows it, while its page still lives under its defining
module (`apiPath`'s rule). The `undocumented` fixture entry is how "an entry
with no documentation" is covered: `documentationData(undefined, …)` gives an
empty documentation.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter docs-site run test:unit` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs-site/generator/src/typeText.ts docs-site/generator/src/typeText.test.ts docs-site/generator/src/model.ts docs-site/generator/src/model.test.ts
git commit -m "docs-site: the site model (classification, paths, type index, collisions)"
```

### Task 8: Doc-comment sections, argument bullets and MDX

**Files:**

- Create: `docs-site/generator/src/sections.ts`,
  `docs-site/generator/src/mdx.ts`
- Test: `docs-site/generator/src/sections.test.ts`,
  `docs-site/generator/src/mdx.test.ts`

**Interfaces:**

- Consumes: `ensoMarkdownParser` from `./gui`; `QUALIFIED_NAME`, `simpleName`
  from `./typeText`.
- Produces (`sections.ts`):
  - `interface DocSections { body: string; sections: { heading: string; text: string }[] }`
  - `splitSections(prerendered: string): DocSections` (front matter dropped;
    `heading` without `## `)
  - `KNOWN_SECTIONS = ['Arguments', 'Returns', 'Examples', 'Errors', 'Remarks'] as const`
  - `argumentDescriptions(sectionText: string, names: readonly string[]): { byName: Map<string, string>; unmatched: string[] }`
- Produces (`mdx.ts`):
  - `interface MdxOptions { linkCode?: (code: string) => string | undefined }`
  - `markdownToMdx(markdown: string, options?: MdxOptions): string`
  - `escapeMdxText(text: string): string`
  - `escapeTableCell(mdx: string): string`
  - `linkedType(type: string, link: (qualifiedName: string) => string | undefined): string`

- [ ] **Step 1: Write the failing tests**

```ts
// docs-site/generator/src/sections.test.ts
import { expect, test } from "vitest";
import { argumentDescriptions, splitSections } from "./sections";

const DOC = [
  "---",
  "icon: preparation",
  "---",
  "Summary sentence. More.",
  "- `action`: an argument-like bullet in the body.",
  "## Arguments",
  "- ``column``: The column.",
  "- `filter`: The filter.",
  "- `nope`: Not an argument.",
  "## Returns",
  "- A table.",
  "## Implementation Notes",
  "Inside.",
].join("\n");

test("splits at level-2 headings and drops the front matter", () => {
  const { body, sections } = splitSections(DOC);
  expect(body).toBe(
    "Summary sentence. More.\n- `action`: an argument-like bullet in the body.",
  );
  expect(sections.map((section) => section.heading)).toEqual([
    "Arguments",
    "Returns",
    "Implementation Notes",
  ]);
  expect(sections[1]!.text).toBe("- A table.");
});

test("a doc without headings is all body", () => {
  expect(splitSections("Just text.")).toEqual({
    body: "Just text.",
    sections: [],
  });
});

test("argument bullets are matched by the code span that opens them", () => {
  const { sections } = splitSections(DOC);
  const { byName, unmatched } = argumentDescriptions(sections[0]!.text, [
    "column",
    "filter",
    "on_problems",
  ]);
  expect(Object.fromEntries(byName)).toEqual({
    column: "The column.",
    filter: "The filter.",
  });
  expect(unmatched).toEqual(["- `nope`: Not an argument."]);
});
```

````ts
// docs-site/generator/src/mdx.test.ts
import { expect, test } from "vitest";
import { escapeTableCell, linkedType, markdownToMdx } from "./mdx";

test("escapes the characters MDX gives meaning to, outside code", () => {
  expect(markdownToMdx("Uses {braces} and <angles> but `{not} <here>`.")).toBe(
    "Uses \\{braces\\} and &lt;angles&gt; but `{not} <here>`.",
  );
});

test("separates blocks with blank lines and labels unlabelled code blocks enso", () => {
  expect(markdownToMdx("Text.\n```\na = {b}\n```\nMore.")).toBe(
    "Text.\n\n```enso\na = {b}\n```\n\nMore.",
  );
  expect(markdownToMdx("```python\nx\n```")).toBe("```python\nx\n```");
});

test("an indented block of table rows becomes a table", () => {
  expect(
    markdownToMdx("Returns\n\n        | A |\n        |---|\n        | 1 |"),
  ).toBe("Returns\n\n| A |\n|---|\n| 1 |");
});

test("an indented code block becomes a fenced enso block", () => {
  expect(markdownToMdx("Text.\n\n    x = 1\n    y = 2")).toBe(
    "Text.\n\n```enso\nx = 1\ny = 2\n```",
  );
});

test("code spans that name a type link to it", () => {
  const link = (code: string) =>
    code === "Square" ? "../Square/index.mdx" : undefined;
  expect(markdownToMdx("See `Square` and `Other`.", { linkCode: link })).toBe(
    "See [`Square`](../Square/index.mdx) and `Other`.",
  );
});

test("autolinks become Markdown links (MDX has no autolinks)", () => {
  expect(markdownToMdx("See <https://example.com>.")).toBe(
    "See [https://example.com](https://example.com).",
  );
});

test("type expressions: shortened, linked where known, pipes escaped in table cells", () => {
  const link = (name: string) =>
    name === "Standard.Table.Column.Column" ? "../Column/index.mdx" : undefined;
  expect(
    linkedType(
      "Standard.Table.Column.Column | Standard.Base.Data.Text.Text",
      link,
    ),
  ).toBe("[Column](../Column/index.mdx) | Text");
  expect(escapeTableCell("[Column](x) | Text")).toBe("[Column](x) \\| Text");
});
````

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL.

- [ ] **Step 2: Implement `sections.ts`**

````ts
// docs-site/generator/src/sections.ts
/**
 * @file The sections of a doc comment, found on the Lezer tree of the GUI's `ensoMarkdownParser`
 * (the `ATXHeading2` nodes the help panel sees), never by regular expressions on the text.
 */
import type { SyntaxNode } from "@lezer/common";
import { ensoMarkdownParser } from "./gui";

/** The sections a function page shows in this order; any other follows them. */
export const KNOWN_SECTIONS = [
  "Arguments",
  "Returns",
  "Examples",
  "Errors",
  "Remarks",
] as const;

export interface DocSections {
  /** Everything before the first `##` heading, the front matter left out. */
  body: string;
  sections: { heading: string; text: string }[];
}

const children = (node: SyntaxNode) => {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    result.push(child);
  return result;
};

/** Split prerendered Markdown (`DocumentationData.documentation`) at its level-2 headings. */
export function splitSections(prerendered: string): DocSections {
  const blocks = children(ensoMarkdownParser.parse(prerendered).topNode);
  let start = 0;
  const headings: { heading: string; from: number; to: number }[] = [];
  for (const block of blocks) {
    if (block.name === "YAMLFrontMatter") start = block.to;
    if (block.name === "ATXHeading2") {
      headings.push({
        heading: prerendered
          .slice(block.from, block.to)
          .replace(/^##\s*/, "")
          .trim(),
        from: block.from,
        to: block.to,
      });
    }
  }
  const body = prerendered
    .slice(start, headings[0]?.from ?? prerendered.length)
    .trim();
  const sections = headings.map(({ heading, to }, i) => ({
    heading,
    text: prerendered
      .slice(to, headings[i + 1]?.from ?? prerendered.length)
      .trim(),
  }));
  return { body, sections };
}

/**
 * The description of each argument from an `## Arguments` section: the bullet that opens with that
 * argument's name in a code span (`` `name` `` or ``` ``name`` ```), its text after the span and a
 * colon. Bullets that name no argument, and any other blocks, are returned unchanged in order.
 */
export function argumentDescriptions(
  sectionText: string,
  names: readonly string[],
): { byName: Map<string, string>; unmatched: string[] } {
  const byName = new Map<string, string>();
  const unmatched: string[] = [];
  const known = new Set(names);
  for (const block of children(ensoMarkdownParser.parse(sectionText).topNode)) {
    if (block.name !== "BulletList") {
      unmatched.push(sectionText.slice(block.from, block.to));
      continue;
    }
    for (const item of children(block).filter(
      (child) => child.name === "ListItem",
    )) {
      const itemText = sectionText.slice(item.from, item.to);
      const paragraph = item.getChild("Paragraph");
      const code = paragraph?.firstChild;
      const name =
        code?.name === "InlineCode" && code.from === paragraph!.from
          ? sectionText.slice(code.from, code.to).replace(/^`+\s*|\s*`+$/g, "")
          : undefined;
      if (name != null && known.has(name) && !byName.has(name)) {
        byName.set(
          name,
          sectionText
            .slice(code!.to, item.to)
            .replace(/^\s*:?\s*/, "")
            .trim(),
        );
      } else {
        unmatched.push(itemText);
      }
    }
  }
  return { byName, unmatched };
}
````

- [ ] **Step 3: Implement `mdx.ts`**

````ts
// docs-site/generator/src/mdx.ts
/**
 * @file Doc-comment Markdown to MDX. Text is copied from the source, block by block, separated by
 * blank lines (the prerendered form uses single newlines). In text the characters MDX gives meaning
 * to are escaped; code spans and code blocks are copied as they are. The CI build compiles every
 * page, so a doc comment that defeats this fails the build, not the deploy.
 */
import type { SyntaxNode } from "@lezer/common";
import { ensoMarkdownParser } from "./gui";
import { QUALIFIED_NAME, simpleName } from "./typeText";

export interface MdxOptions {
  /** A link (a relative doc path) for the text of an inline code span, or nothing. */
  linkCode?: (code: string) => string | undefined;
}

const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "URL"]);

/** Escape text (not code) for MDX. */
export function escapeMdxText(text: string): string {
  return text
    .replace(/[{}]/g, (char) => `\\${char}`)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a cell's MDX for a GFM table: `|` must not end the cell, even inside code. */
export function escapeTableCell(mdx: string): string {
  return mdx.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** A type expression, shortened, each qualified name linked when `link` knows it. */
export function linkedType(
  type: string,
  link: (qualifiedName: string) => string | undefined,
): string {
  let result = "";
  let last = 0;
  for (const match of type.matchAll(QUALIFIED_NAME)) {
    result += escapeMdxText(type.slice(last, match.index));
    const target = link(match[0]);
    result += target
      ? `[${simpleName(match[0])}](${target})`
      : simpleName(match[0]);
    last = match.index + match[0].length;
  }
  return result + escapeMdxText(type.slice(last));
}

function dedent(lines: string[]): string[] {
  const indent = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.match(/^ */)![0].length),
  );
  return lines.map((line) => line.slice(indent));
}

function emit(node: SyntaxNode, source: string, options: MdxOptions): string {
  const text = source.slice(node.from, node.to);
  switch (node.name) {
    case "InlineCode": {
      const code = text.replace(/^`+\s*|\s*`+$/g, "");
      const target = options.linkCode?.(code);
      return target ? `[${text}](${target})` : text;
    }
    case "FencedCode": {
      const fence = text.match(/^\s*(`{3,}|~{3,})(.*)$/m);
      if (fence && !fence[2]!.trim())
        return text.replace(fence[1]!, `${fence[1]}enso`);
      return text;
    }
    case "CodeBlock": {
      const lines = dedent(text.split("\n"));
      // Result tables in doc comments are indented more deeply than their text, so CommonMark reads
      // them as code (spec, open question 10); the help panel's reading decides (Task 13).
      if (lines.every((line) => !line.trim() || line.trim().startsWith("|")))
        return lines.join("\n");
      return ["```enso", ...lines, "```"].join("\n");
    }
    case "Autolink": {
      const url = text.slice(1, -1);
      return `[${url}](${url})`;
    }
    case "URL":
      return text;
    default: {
      let result = "";
      let position = node.from;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        result += escapeMdxText(source.slice(position, child.from));
        result +=
          CODE.has(child.name) || child.firstChild || child.name === "Autolink"
            ? emit(child, source, options)
            : escapeMdxText(source.slice(child.from, child.to));
        position = child.to;
      }
      return result + escapeMdxText(source.slice(position, node.to));
    }
  }
}

/** Convert doc-comment Markdown (prerendered or standard) to MDX. */
export function markdownToMdx(
  markdown: string,
  options: MdxOptions = {},
): string {
  const blocks: string[] = [];
  for (
    let block = ensoMarkdownParser.parse(markdown).topNode.firstChild;
    block;
    block = block.nextSibling
  ) {
    if (block.name === "YAMLFrontMatter") continue;
    blocks.push(emit(block, markdown, options));
  }
  return blocks.join("\n\n");
}
````

If the indented-table test fails because `ensoMarkdownParser` (the prerendered
dialect, whose `newlineEndsBlock` ends a block at every newline except inside a
`|…|` row) does not produce a `CodeBlock` for the indented rows, write down
which node it produces (`console.log(tree.toString())` in the test), handle that
node in `emit` the same way, and keep the test. That is Task 13's open question
10 answered early on a fixture; Task 13 confirms it on the real catalogue.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter docs-site run test:unit` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs-site/generator/src/sections.ts docs-site/generator/src/sections.test.ts docs-site/generator/src/mdx.ts docs-site/generator/src/mdx.test.ts
git commit -m "docs-site: doc-comment sections, argument bullets and MDX conversion"
```

### Task 9: The component node

The function drawn as a graph-editor node: icon, group colour, name and
parameter pills, with keyboard-, touch- and hover-accessible tooltips.

**Files:**

- Create: `docs-site/src/components/ComponentNode.tsx`,
  `docs-site/src/components/ComponentNode.module.css`,
  `docs-site/src/theme/MDXComponents.tsx`,
  `docs-site/generator/src/componentNode.ts`
- Test: `docs-site/generator/src/componentNode.test.ts`

**Interfaces:**

- Consumes: `Page`, `SiteModel`, `isFunctionPage` (Task 7); `unqualifiedType`
  (Task 7); `groupColorVar`, `colorFromString`, `projectPathKey`, `entryIcon`,
  `isRequiredArgument`, `DEFAULT_ICON` from `./gui`.
- Produces (`ComponentNode.tsx`, used from MDX as `<ComponentNode … />` without
  an import, through `MDXComponents`):
  `interface NodeParam { name: string; tooltip: string; optional: boolean }`,
  `interface ComponentNodeProps { name: string; icon: string; color: string; returns: string; params: NodeParam[]; label: string; size?: 'large' | 'small' }`.
- Produces (`componentNode.ts`):
  `nodeProps(page: Page & { entry: CatalogueEntry }, model: SiteModel): ComponentNodeProps`,
  `nodeColor(page, model): string`,
  `nodeJsx(props: ComponentNodeProps): string`, and `unknownIcons` (a
  `Set<string>` of icon names no symbol matched, which the report prints).
  `ComponentNodeProps`/`NodeParam` are declared in `componentNode.ts` and
  imported by `ComponentNode.tsx` as types
  (`import type { … } from '@site/generator/src/componentNode'`), so the two
  cannot drift.

- [ ] **Step 1: Write the failing test**

```ts
// docs-site/generator/src/componentNode.test.ts
import { expect, test } from "vitest";
import { FIXTURES_LIB, readLibraries } from "./catalogue";
import { nodeColor, nodeJsx, nodeProps, unknownIcons } from "./componentNode";
import { colorFromString } from "./gui";
import { buildModel, type Page } from "./model";

const model = buildModel(readLibraries([FIXTURES_LIB]));
const fn = (path: string) =>
  model.byPath.get(path) as Page & { entry: NonNullable<Page["entry"]> };

test("a grouped function: the group's colour, its icon, every argument but self", () => {
  const props = nodeProps(fn("Standard.Fixture/Shapes/Shape.area"), model);
  expect(props).toEqual({
    name: "area",
    icon: "preparation",
    color: "var(--group-color-Standard-Fixture-Selections)",
    returns: "Returns Float",
    params: [
      { name: "units", tooltip: "Text | Nothing = Nothing", optional: true },
      {
        name: "scale",
        tooltip: '~Float = Missing_Argument.throw "scale"',
        optional: false,
      },
    ],
    label:
      'area(units: Text | Nothing = Nothing, scale: ~Float = Missing_Argument.throw "scale") -> Float',
  });
});

test("a bare group name resolves against the entry's own library; another library's by its full name", () => {
  expect(nodeColor(fn("Standard.Fixture/Shapes/Shape.unit"), model)).toBe(
    "var(--group-color-Standard-Fixture-Shaping)",
  );
  expect(
    nodeColor(fn("Standard.Fixture_Ext/Describe/Shape.describe"), model),
  ).toBe("var(--group-color-Standard-Fixture-Shaping)");
});

test("ungrouped: coloured from the declared return type, as computeNodeColor does", () => {
  expect(
    nodeColor(fn("Standard.Fixture/Shapes/Shape.undocumented"), model),
  ).toBe(colorFromString("Standard.Fixture.Shapes.Square"));
});

test("ungrouped returning Any or a union: the fallback colour", () => {
  expect(nodeColor(fn("Standard.Fixture/Shapes/make_shape"), model)).toBe(
    "var(--group-color-fallback)",
  );
  expect(nodeColor(fn("Standard.Fixture/Shapes/Shape.odd_icon"), model)).toBe(
    "var(--group-color-fallback)",
  );
});

test("an unknown icon falls back to the logo and is counted", () => {
  expect(
    nodeProps(fn("Standard.Fixture/Shapes/Shape.odd_icon"), model).icon,
  ).toBe("enso_logo");
  expect(unknownIcons.has("not_an_icon")).toBe(true);
});

test("static methods and constructors are labelled Type.name", () => {
  expect(nodeProps(fn("Standard.Fixture/Shapes/Shape.unit"), model).name).toBe(
    "Shape.unit",
  );
  expect(
    nodeProps(fn("Standard.Fixture/Shapes/Square.Value"), model).params,
  ).toEqual([{ name: "side", tooltip: "Float", optional: false }]);
});

test("the JSX is one self-closing element with JSON props", () => {
  const jsx = nodeJsx({
    name: "a",
    icon: "b",
    color: "c",
    returns: "d",
    params: [],
    label: "e",
  });
  expect(jsx).toBe(
    '<ComponentNode name={"a"} icon={"b"} color={"c"} returns={"d"} params={[]} label={"e"} />',
  );
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL.

- [ ] **Step 2: Implement `componentNode.ts`**

```ts
// docs-site/generator/src/componentNode.ts
/**
 * @file The properties of a function's component node, by the graph editor's rules: its group's
 * colour variable (`groupColorVar`), else a colour from its declared return type (as
 * `computeNodeColor` colours a node by its value's type, which a static page cannot know), else the
 * fallback; the icon by `entryIcon`; required arguments by `isRequiredArgument`.
 */
import type { CatalogueEntry } from "./catalogue";
import {
  colorFromString,
  entryIcon,
  groupColorVar,
  isRequiredArgument,
  projectPathKey,
} from "./gui";
import type { Page, SiteModel } from "./model";
import { QUALIFIED_NAME, unqualifiedType } from "./typeText";

export interface NodeParam {
  name: string;
  /** `<type>` or `<type> = <default>`, `~` before the type of a suspended argument. */
  tooltip: string;
  optional: boolean;
}

export interface ComponentNodeProps {
  name: string;
  icon: string;
  /** A CSS colour or `var(--group-color-…)`. */
  color: string;
  returns: string;
  params: NodeParam[];
  /** The full signature, for screen readers. */
  label: string;
  size?: "large" | "small";
}

/** Icon names from doc comments that `icons.svg` does not have. */
export const unknownIcons = new Set<string>();

const FALLBACK = "var(--group-color-fallback)";

/** The node's colour: group, else declared return type, else the fallback. */
export function nodeColor(
  page: Page & { entry: CatalogueEntry },
  model: SiteModel,
): string {
  const group =
    page.doc.groupIndex != null ? model.groups[page.doc.groupIndex] : undefined;
  if (group) return `var(${groupColorVar(group)})`;
  const entry = page.entry;
  const returnType = "returnType" in entry ? entry.returnType : undefined;
  // A single qualified type name; `Any`, unions, intersections and functions have no one colour.
  if (
    !returnType ||
    !new RegExp(`^${QUALIFIED_NAME.source}$`).test(returnType) ||
    returnType.endsWith(".Any")
  ) {
    return FALLBACK;
  }
  const segments = returnType.split(".");
  return colorFromString(
    projectPathKey(segments.slice(0, 2).join("."), segments.slice(2).join(".")),
  );
}

export function nodeProps(
  page: Page & { entry: CatalogueEntry },
  model: SiteModel,
): ComponentNodeProps {
  const entry = page.entry;
  const args =
    "arguments" in entry
      ? entry.arguments.filter((arg) => arg.name !== "self")
      : [];
  const params = args.map((arg): NodeParam => {
    const type = (arg.isSuspended ? "~" : "") + unqualifiedType(arg.reprType);
    return {
      name: arg.name,
      tooltip:
        arg.hasDefault && arg.defaultValue != null
          ? `${type} = ${arg.defaultValue}`
          : type,
      optional: arg.hasDefault && !isRequiredArgument(arg),
    };
  });
  const returnType =
    "returnType" in entry ? unqualifiedType(entry.returnType) : "Any";
  const named = page.metadata?.icon;
  if (named != null && page.doc.iconName == null) unknownIcons.add(named);
  return {
    name: page.nodeName,
    icon: entryIcon({ iconName: page.doc.iconName, kind: "Method" }),
    color: nodeColor(page, model),
    returns: `Returns ${returnType}`,
    params,
    label: `${page.nodeName}(${params.map((param) => `${param.name}: ${param.tooltip}`).join(", ")}) -> ${returnType}`,
  };
}

/** The node as an MDX element; props are JSON, which MDX's JavaScript expressions accept. */
export function nodeJsx(props: ComponentNodeProps): string {
  const attributes = Object.entries(props).map(
    ([key, value]) => `${key}={${JSON.stringify(value)}}`,
  );
  return `<ComponentNode ${attributes.join(" ")} />`;
}
```

(`documentationData` already resolves `iconName` against the generated
`iconName.ts`, the mirror of `icons.svg`, and leaves it undefined for an unknown
name, so "known icon or `enso_logo`" is exactly `entryIcon`.)

- [ ] **Step 3: Write the React component and its styles**

```tsx
// docs-site/src/components/ComponentNode.tsx
/**
 * @file A function drawn as a graph-editor node. Each pill is a button whose tooltip shows on hover
 * (and while the pointer is over the tooltip), on keyboard focus, and on tap (a tap toggles it;
 * tapping elsewhere closes it); Escape closes it (WCAG 1.4.13). Before hydration, or without
 * JavaScript, CSS shows the tooltips on hover and focus.
 */
import type { ComponentNodeProps } from "@site/generator/src/componentNode";
import useBaseUrl from "@docusaurus/useBaseUrl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";
import styles from "./ComponentNode.module.css";

function Pill(props: {
  className: string;
  text: string;
  tooltip: string;
}): JSX.Element {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (hovered || focused || pinned);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDismissed(true);
        setPinned(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      ref={wrapper}
      className={styles.pill}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        setDismissed(false);
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={props.className}
        aria-describedby={id}
        onFocus={() => {
          setDismissed(false);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onClick={() => {
          setDismissed(false);
          setPinned((was) => !was);
        }}
      >
        {props.text}
      </button>
      <span
        role="tooltip"
        id={id}
        className={styles.tooltip}
        data-open={hydrated ? String(open) : undefined}
      >
        {props.tooltip}
      </span>
    </span>
  );
}

/** The node at the top of a function page (`large`) or in a list of functions (`small`). */
export default function ComponentNode(props: ComponentNodeProps): JSX.Element {
  const iconHref = useBaseUrl(`/img/icons.svg#${props.icon}`);
  return (
    <div
      role="group"
      aria-label={props.label}
      className={`${styles.node} ${props.size === "small" ? styles.small : ""}`}
      style={{ "--node-color": props.color } as CSSProperties}
    >
      <svg className={styles.icon} aria-hidden="true">
        <use href={iconHref} />
      </svg>
      <Pill
        className={styles.name!}
        text={props.name}
        tooltip={props.returns}
      />
      {props.params.map((param) => (
        <Pill
          key={param.name}
          className={`${styles.param} ${param.optional ? styles.optional : ""}`}
          text={param.name}
          tooltip={param.tooltip}
        />
      ))}
    </div>
  );
}
```

```css
/* docs-site/src/components/ComponentNode.module.css */
/* The graph editor's node: a 32px pill, white on the group colour, in both colour modes. */
.node {
  display: inline-flex;
  align-items: center;
  height: 32px;
  border-radius: 16px;
  padding-right: 6px;
  width: fit-content;
  max-width: 100%;
  flex-wrap: nowrap;
  background-color: var(--node-color, var(--group-color-fallback, #006b8a));
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  margin: 0.25rem 0 1rem;
}
.small {
  height: 24px;
  border-radius: 12px;
  font-size: 12px;
  margin: 0.25rem 0 0.5rem;
}
.icon {
  width: 24px;
  height: 24px;
  margin: 4px;
  flex: none;
}
.small .icon {
  width: 16px;
  height: 16px;
}
.pill {
  position: relative;
  display: inline-flex;
}
.name,
.param {
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: help;
  padding: 0 2px;
  margin-left: 4px;
}
.name {
  font-weight: 600;
}
.param {
  padding-left: 4px;
  border-left: 2px solid #0003;
  color: #fffc;
  font-weight: 400;
}
.optional {
  font-style: italic;
}
.name:focus-visible,
.param:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 1px;
  border-radius: 4px;
}
.tooltip {
  visibility: hidden;
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  white-space: pre;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--ifm-color-emphasis-900);
  color: var(--ifm-color-emphasis-0);
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
}
.pill:hover > .tooltip:not([data-open]),
.pill:focus-within > .tooltip:not([data-open]),
.tooltip[data-open="true"] {
  visibility: visible;
}
```

```tsx
// docs-site/src/theme/MDXComponents.tsx
import ComponentNode from "@site/src/components/ComponentNode";
import MDXComponents from "@theme-original/MDXComponents";

/** Makes `<ComponentNode>` available to every MDX page without an import (the generated pages use it). */
export default { ...MDXComponents, ComponentNode };
```

- [ ] **Step 4: Run the tests and the type check**

Run: `corepack pnpm --filter docs-site run test:unit` and
`corepack pnpm --filter docs-site run typecheck` Expected: PASS and clean. If
`@theme-original/MDXComponents` has no type, it comes from
`@docusaurus/module-type-aliases` (listed in `tsconfig.json`'s `types`); if
`.module.css` imports are untyped, the same package declares them.

- [ ] **Step 5: Commit**

```bash
git add docs-site/src/components docs-site/src/theme docs-site/generator/src/componentNode.ts docs-site/generator/src/componentNode.test.ts
git commit -m "docs-site: the component node, coloured and iconed by the graph editor's rules"
```

### Task 10: Pages, and the golden `Table.filter`

**Files:**

- Create: `docs-site/generator/src/pages.ts`
- Create:
  `docs-site/generator/fixtures/golden/lib/Standard/Table/0.0.0-dev/package.yaml`,
  `…/catalogue.json`, `docs-site/generator/fixtures/golden/Table.filter.mdx`
- Test: `docs-site/generator/src/pages.test.ts`

**Interfaces:**

- Consumes: Tasks 6-9.
- Produces: `renderPage(page: Page, model: SiteModel): string` (the whole MDX
  file: front matter and body); `relativeLink(from: Page, to: Page): string`
  (`../Square/index.mdx`);
  `linkerFor(page: Page, model: SiteModel): { type: (qualifiedName: string) => string | undefined; code: (code: string) => string | undefined }`.

The page layouts (spec, "Page design"):

- **Function page** (constructor, static, instance, module function, extension):
  front matter `slug: /api/<path>/`, `title`, `sidebar_label` (the node name),
  `description` (the summary, when there is one), `keywords` (the aliases and
  macro names, when any); then `# <title>`, the node (large), the badges
  (`:::caution Deprecated` admonition for `deprecated`; inline text badges
  `**Unstable**`, `**Advanced**`, `Added in X`, `Modified in X`,
  `Removed in X`), the `**Group**: <last segment> / **Aliases**: \`a\`,
  \`b\``line, the body (Documentation),`##
  Arguments`(table: Name, Type, Default, Description; then "Allowed values" for each argument with`tagValues`; then the unmatched bullets), `##
  Returns`(the linked return type and the section's text),`## Examples`, `##
  Errors`, `## Remarks`, then every other `##` section under its own heading.
- **Type page:** `# <Type>`, "Exported from `<library>`" when its `reexports`
  include `<library>.Main`, "Inherits from [Parent]" when it has a parent type,
  its body and other sections, then `## Constructors`, `## Static methods`,
  `## Methods`, `## Conversions` ("From [Text]" + its summary), and
  `## Extension methods` with a `### <library>` per defining library; each
  function as `### [<node name>](<link>)`, the node (small), its summary. Front
  matter adds `toc_max_heading_level: 2`.
- **Module page:** its documentation, `## Types` (linked list with summaries),
  `## Functions` (module functions as nodes), `## Extension methods` (R7).
- **Library page:** the `Main` module's documentation, then `## Modules` (linked
  list), then `Main`'s own types and functions if any.

- [ ] **Step 1: Make the golden fixture from a real catalogue**

Get a real distribution's `Standard.Table` catalogue (no local build needed):

```bash
run=$(gh run list -R jdunkerley/enso -w engine-pull-request.yml -b develop -s success -L 1 --json databaseId --jq '.[0].databaseId')
mkdir -p "$SCRATCH/dist" && cd "$SCRATCH/dist"
gh run download "$run" -R jdunkerley/enso -n "Engine Distribution (GraalVM CE) (native,test) (linux, amd64)"
tar -xf built-distribution.tar --wildcards 'built-distribution/*/lib/*/*/*/catalogue.json' 'built-distribution/*/lib/*/*/*/package.yaml'
rm built-distribution.tar
```

(`$SCRATCH` is your scratch folder, never the worktree. Task 13 reuses this
`lib`.) Then write the golden library from it, keeping the `Table` module, the
`Table` type and the `filter` method:

```bash
node -e "
const [file, out] = process.argv.slice(1)
const c = require(file)
const keep = (e) => (e.type === 'module' && e.module === 'Standard.Table.Table') ||
  (e.type === 'type' && e.module === 'Standard.Table.Table' && e.name === 'Table') ||
  (e.type === 'method' && e.name === 'filter' && e.selfType === 'Standard.Table.Table.Table')
require('fs').writeFileSync(out, JSON.stringify({ ...c, entries: c.entries.filter(keep) }, null, 2) + '\n')
" "$(ls -d $SCRATCH/dist/built-distribution/*/*/lib/Standard/Table/*)/catalogue.json" docs-site/generator/fixtures/golden/lib/Standard/Table/0.0.0-dev/catalogue.json
```

Check it has three entries and that the `filter` entry's `documentation` holds
the doc comment of `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`
(the block above `filter self (column : …`). Write its `package.yaml`:

```yaml
name: Table
namespace: Standard
version: 0.0.0-dev
```

- [ ] **Step 2: Write the failing tests**

```ts
// docs-site/generator/src/pages.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { FIXTURES_LIB, readLibraries } from "./catalogue";
import { readGroups } from "./groups";
import { buildModel } from "./model";
import { renderPage } from "./pages";

const model = buildModel(readLibraries([FIXTURES_LIB]));
const render = (path: string) => renderPage(model.byPath.get(path)!, model);

test("a function page has every section in order, and keeps unknown sections", () => {
  const mdx = render("Standard.Fixture/Shapes/Shape.area");
  const order = [
    "# Shape.area",
    "<ComponentNode",
    ":::caution",
    "**Group**: Selections",
    "## Arguments",
    "## Returns",
    "## Examples",
    "## Errors",
    "## Remarks",
    "## Implementation Notes",
  ];
  const positions = order.map((marker) => mdx.indexOf(marker));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(mdx).toContain("slug: /api/Standard.Fixture/Shapes/Shape.area/");
  expect(mdx).toContain('keywords: ["doubled","extent","size"]');
  expect(mdx).toContain("**Aliases**: `doubled`, `extent`, `size`");
  expect(mdx).toContain("Uses \\{braces\\} and &lt;angles&gt;");
  expect(mdx).toContain(
    "| `units` | Text \\| Nothing | `Nothing` | The units. |",
  );
  expect(mdx).toContain("- `extra`: Not an argument.");
  expect(mdx).toContain("Allowed values for `units`: `'cm'`, `'m'`");
  expect(mdx).toContain("**Unstable**");
  expect(mdx).toContain("Added in 2026.1");
});

test("prose code spans that name a type of the library link to it", () => {
  expect(render("Standard.Fixture/Shapes/Shape.area")).toContain(
    "[`Square`](../Square/index.mdx)",
  );
  expect(render("Standard.Fixture/Shapes/Shape.area")).toContain(
    "[`Square.side`](../Square.side/index.mdx)",
  );
});

test("a type page lists constructors, methods, conversions and extensions", () => {
  const square = render("Standard.Fixture/Shapes/Square");
  expect(square).toContain("Inherits from [Shape](../Shape/index.mdx)");
  expect(square).toContain("## Constructors");
  expect(square).toContain("### [Square.Value](../Square.Value/index.mdx)");
  expect(square).toContain("## Conversions");
  // Base is not in the fixture build, so `Integer` has no page and stays plain.
  expect(square).toContain("### From Integer");
  const shape = render("Standard.Fixture/Shapes/Shape");
  expect(shape).toContain("Exported from `Standard.Fixture`");
  expect(shape).toContain("## Static methods");
  expect(shape).toContain("## Extension methods");
  expect(shape).toContain("### Standard.Fixture_Ext");
  expect(shape).toContain(
    "(../../../Standard.Fixture_Ext/Describe/Shape.describe/index.mdx)",
  );
});

test("module and library pages", () => {
  expect(render("Standard.Fixture/Shapes")).toContain("## Types");
  expect(render("Standard.Fixture/Shapes")).toContain(
    "### [make_shape](make_shape/index.mdx)",
  );
  expect(render("Standard.Fixture")).toContain("## Modules");
  expect(render("Standard.Fixture_Ext/Describe")).toContain(
    "## Extension methods",
  );
});

test("an entry without documentation still renders", () => {
  expect(render("Standard.Fixture/Shapes/Shape.undocumented")).toContain(
    "# Shape.undocumented",
  );
});

test("golden: Table.filter", () => {
  const golden = fileURLToPath(new URL("../fixtures/golden", import.meta.url));
  const base = readGroups(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../distribution/lib/Standard/Base/0.0.0-dev/package.yaml",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  const table = readLibraries([`${golden}/lib`]);
  const goldenModel = buildModel([
    { name: base.library, dir: "", groups: base.groups, catalogue: undefined },
    ...table,
  ]);
  const page = goldenModel.byPath.get("Standard.Table/Table/Table.filter")!;
  expect(renderPage(page, goldenModel)).toBe(
    readFileSync(`${golden}/Table.filter.mdx`, "utf8"),
  );
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL.

- [ ] **Step 3: Implement `pages.ts`**

```ts
// docs-site/generator/src/pages.ts
/** @file The MDX of each page (spec, "Page design"). */
import { posix } from "node:path";
import type { CatalogueEntry } from "./catalogue";
import { nodeJsx, nodeProps } from "./componentNode";
import {
  escapeMdxText,
  escapeTableCell,
  linkedType,
  markdownToMdx,
} from "./mdx";
import { isFunctionPage, type Page, type SiteModel } from "./model";
import {
  argumentDescriptions,
  KNOWN_SECTIONS,
  splitSections,
} from "./sections";
import { simpleName } from "./typeText";

const fileOf = (page: Page) => `${page.path}/index.mdx`;

/** A relative link from one page's file to another's, which Docusaurus checks at build time. */
export function relativeLink(from: Page, to: Page): string {
  return posix.relative(posix.dirname(fileOf(from)), fileOf(to));
}

/**
 * Links from a page: a qualified type name to its page; a code span that is exactly a type's simple
 * name, or `Type.member`, when that resolves to one page in the page's own library or in
 * `Standard.Base`. Anything ambiguous stays plain.
 */
export function linkerFor(page: Page, model: SiteModel) {
  const scope = [page.library, "Standard.Base"];
  const byCode = new Map<string, Page[]>();
  for (const candidate of model.pages) {
    if (!scope.includes(candidate.library)) continue;
    const keys =
      candidate.kind === "type"
        ? [candidate.title]
        : isFunctionPage(candidate) && candidate.kind !== "moduleFunction"
          ? [candidate.title]
          : [];
    for (const key of keys)
      byCode.set(key, [...(byCode.get(key) ?? []), candidate]);
  }
  return {
    type: (qualifiedName: string) => {
      const target = model.types.get(qualifiedName);
      return target ? relativeLink(page, target) : undefined;
    },
    code: (code: string) => {
      const targets = byCode.get(code);
      return targets?.length === 1 && targets[0] !== page
        ? relativeLink(page, targets[0]!)
        : undefined;
    },
  };
}

function frontMatter(page: Page, extra: Record<string, unknown> = {}): string {
  const fields: Record<string, unknown> = {
    slug: `/api/${page.path}/`,
    title: page.title,
    sidebar_label: isFunctionPage(page)
      ? page.nodeName
      : simpleName(page.title),
    ...(page.doc.documentationSummary
      ? { description: page.doc.documentationSummary }
      : {}),
    ...(page.doc.aliasesAndMacros.length
      ? { keywords: page.doc.aliasesAndMacros }
      : {}),
    ...extra,
  };
  // JSON values are valid YAML, and quoting every value keeps colons and quotes safe.
  return [
    "---",
    ...Object.entries(fields).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    ),
    "---",
    "",
  ].join("\n");
}

function badges(page: Page): string[] {
  const meta = page.metadata;
  if (!meta) return [];
  const lines: string[] = [];
  if (meta.deprecated)
    lines.push(":::caution Deprecated\n\nThis component is deprecated.\n\n:::");
  const inline = [
    meta.unstable ? "**Unstable**" : undefined,
    meta.advanced ? "**Advanced**" : undefined,
    meta.added ? `Added in ${escapeMdxText(meta.added)}` : undefined,
    meta.modified ? `Modified in ${escapeMdxText(meta.modified)}` : undefined,
    meta.removed ? `Removed in ${escapeMdxText(meta.removed)}` : undefined,
  ].filter((badge) => badge != null);
  if (inline.length) lines.push(inline.join(" · "));
  return lines;
}

function groupLine(page: Page, model: SiteModel): string | undefined {
  const group =
    page.doc.groupIndex != null ? model.groups[page.doc.groupIndex] : undefined;
  const aliases = page.doc.aliasesAndMacros;
  const parts = [
    group ? `**Group**: ${escapeMdxText(group.name)}` : undefined,
    aliases.length
      ? `**Aliases**: ${aliases.map((alias) => `\`${alias}\``).join(", ")}`
      : undefined,
  ].filter((part) => part != null);
  return parts.length ? parts.join(" / ") : undefined;
}

function argumentsSection(
  entry: CatalogueEntry,
  text: string | undefined,
  link: ReturnType<typeof linkerFor>,
): string | undefined {
  const args =
    "arguments" in entry
      ? entry.arguments.filter((arg) => arg.name !== "self")
      : [];
  if (!args.length && !text) return undefined;
  const { byName, unmatched } = argumentDescriptions(
    text ?? "",
    args.map((arg) => arg.name),
  );
  const rows = args.map((arg) =>
    [
      `\`${arg.name}\``,
      escapeTableCell(
        (arg.isSuspended ? "~" : "") + linkedType(arg.reprType, link.type),
      ),
      arg.hasDefault && arg.defaultValue != null
        ? escapeTableCell(`\`${arg.defaultValue}\``)
        : "",
      escapeTableCell(
        markdownToMdx(byName.get(arg.name) ?? "", { linkCode: link.code }),
      ),
    ].join(" | "),
  );
  const parts = ["## Arguments"];
  if (rows.length)
    parts.push(
      [
        "| Name | Type | Default | Description |",
        "| --- | --- | --- | --- |",
        ...rows.map((row) => `| ${row} |`),
      ].join("\n"),
    );
  for (const arg of args) {
    if (arg.tagValues?.length)
      parts.push(
        `Allowed values for \`${arg.name}\`: ${arg.tagValues.map((value) => `\`${value}\``).join(", ")}`,
      );
  }
  if (unmatched.length)
    parts.push(markdownToMdx(unmatched.join("\n"), { linkCode: link.code }));
  return parts.join("\n\n");
}

function functionPage(
  page: Page & { entry: CatalogueEntry },
  model: SiteModel,
): string {
  const link = linkerFor(page, model);
  const mdx = (text: string) => markdownToMdx(text, { linkCode: link.code });
  const { body, sections } = splitSections(page.doc.documentation);
  const section = (heading: string) =>
    sections.find((s) => s.heading === heading)?.text;
  const parts = [
    frontMatter(page),
    `# ${escapeMdxText(page.title)}`,
    nodeJsx(nodeProps(page, model)),
    ...badges(page),
  ];
  const group = groupLine(page, model);
  if (group) parts.push(group);
  if (body) parts.push(mdx(body));
  const args = argumentsSection(page.entry, section("Arguments"), link);
  if (args) parts.push(args);
  const returnType =
    "returnType" in page.entry ? page.entry.returnType : undefined;
  if (returnType || section("Returns")) {
    parts.push(
      "## Returns",
      ...(returnType ? [linkedType(returnType, link.type)] : []),
      ...(section("Returns") ? [mdx(section("Returns")!)] : []),
    );
  }
  for (const heading of ["Examples", "Errors", "Remarks"] as const) {
    if (section(heading)) parts.push(`## ${heading}`, mdx(section(heading)!));
  }
  for (const other of sections.filter(
    (s) => !(KNOWN_SECTIONS as readonly string[]).includes(s.heading),
  )) {
    parts.push(`## ${escapeMdxText(other.heading)}`, mdx(other.text));
  }
  return parts.join("\n\n") + "\n";
}

function functionList(from: Page, pages: Page[], model: SiteModel): string[] {
  return pages.flatMap((page) =>
    isFunctionPage(page)
      ? [
          `### [${escapeMdxText(page.nodeName)}](${relativeLink(from, page)})`,
          nodeJsx({ ...nodeProps(page, model), size: "small" }),
          ...(page.doc.documentationSummary
            ? [markdownToMdx(page.doc.documentationSummary)]
            : []),
        ]
      : [],
  );
}

function documentation(page: Page, model: SiteModel): string[] {
  const link = linkerFor(page, model);
  const { body, sections } = splitSections(page.doc.documentation);
  return [
    ...(body ? [markdownToMdx(body, { linkCode: link.code })] : []),
    ...sections.flatMap((s) => [
      `## ${escapeMdxText(s.heading)}`,
      markdownToMdx(s.text, { linkCode: link.code }),
    ]),
  ];
}

function typePage(page: Page, model: SiteModel): string {
  const entry = page.entry as CatalogueEntry & { type: "type" };
  const qualified = `${entry.module}.${entry.name}`;
  const link = linkerFor(page, model);
  const members = model.pages.filter(
    (p) =>
      isFunctionPage(p) &&
      "returnType" in p.entry &&
      ((p.kind === "constructor" && p.entry.returnType === qualified) ||
        ((p.kind === "staticMethod" || p.kind === "instanceMethod") &&
          "selfType" in p.entry &&
          p.entry.selfType === qualified)),
  );
  const parts = [
    frontMatter(page, { toc_max_heading_level: 2 }),
    `# ${escapeMdxText(page.title)}`,
  ];
  if (entry.reexports?.includes(`${page.library}.Main`))
    parts.push(`Exported from \`${page.library}\``);
  if (entry.parentType && !entry.parentType.endsWith(".Any"))
    parts.push(`Inherits from ${linkedType(entry.parentType, link.type)}`);
  parts.push(...documentation(page, model));
  const listed = (heading: string, pages: Page[]) =>
    pages.length ? [`## ${heading}`, ...functionList(page, pages, model)] : [];
  parts.push(
    ...listed(
      "Constructors",
      members.filter((p) => p.kind === "constructor"),
    ),
  );
  parts.push(
    ...listed(
      "Static methods",
      members.filter((p) => p.kind === "staticMethod"),
    ),
  );
  parts.push(
    ...listed(
      "Methods",
      members.filter((p) => p.kind === "instanceMethod"),
    ),
  );
  const conversions = model.conversions.get(qualified) ?? [];
  if (conversions.length) {
    parts.push(
      "## Conversions",
      ...conversions.flatMap((c) => [
        `### From ${linkedType(c.source, link.type)}`,
        ...(c.doc.documentation
          ? [
              markdownToMdx(splitSections(c.doc.documentation).body, {
                linkCode: link.code,
              }),
            ]
          : []),
      ]),
    );
  }
  const extensions = model.extensions.get(qualified) ?? [];
  if (extensions.length) {
    parts.push("## Extension methods");
    for (const library of [
      ...new Set(extensions.map((p) => p.library)),
    ].sort()) {
      parts.push(
        `### ${library}`,
        ...functionList(
          page,
          extensions.filter((p) => p.library === library),
          model,
        ).map((line) => line.replace(/^### /, "#### ")),
      );
    }
  }
  return parts.join("\n\n") + "\n";
}

function modulePage(page: Page, model: SiteModel): string {
  const own = model.pages.filter((p) => p.module === page.module && p !== page);
  const parts = [
    frontMatter(page, { toc_max_heading_level: 2 }),
    `# ${escapeMdxText(page.title)}`,
    ...documentation(page, model),
  ];
  if (page.kind === "library") {
    const modules = model.pages.filter(
      (p) => p.kind === "module" && p.library === page.library,
    );
    if (modules.length)
      parts.push(
        "## Modules",
        modules
          .map(
            (m) =>
              `- [${escapeMdxText(m.title)}](${relativeLink(page, m)})${m.doc.documentationSummary ? ` — ${markdownToMdx(m.doc.documentationSummary)}` : ""}`,
          )
          .join("\n"),
      );
  }
  const types = own.filter((p) => p.kind === "type");
  if (types.length)
    parts.push(
      "## Types",
      types
        .map(
          (t) =>
            `- [${escapeMdxText(t.title)}](${relativeLink(page, t)})${t.doc.documentationSummary ? ` — ${markdownToMdx(t.doc.documentationSummary)}` : ""}`,
        )
        .join("\n"),
    );
  const functions = own.filter((p) => p.kind === "moduleFunction");
  if (functions.length)
    parts.push("## Functions", ...functionList(page, functions, model));
  const extensions = own.filter((p) => p.kind === "extensionMethod");
  if (extensions.length)
    parts.push(
      "## Extension methods",
      ...functionList(page, extensions, model),
    );
  return parts.join("\n\n") + "\n";
}

/** The whole MDX file of a page. */
export function renderPage(page: Page, model: SiteModel): string {
  if (isFunctionPage(page)) return functionPage(page, model);
  if (page.kind === "type") return typePage(page, model);
  return modulePage(page, model);
}
```

- [ ] **Step 4: Write the golden file and review it**

Run the golden test once with the expectation file missing; it fails with
`ENOENT`. Generate the file:

```bash
corepack pnpm --filter docs-site exec vite-node --config vitest.config.ts -e "
import { readFileSync, writeFileSync } from 'node:fs'
import { readLibraries } from './generator/src/catalogue'
import { readGroups } from './generator/src/groups'
import { buildModel } from './generator/src/model'
import { renderPage } from './generator/src/pages'
const base = readGroups(readFileSync('../distribution/lib/Standard/Base/0.0.0-dev/package.yaml', 'utf8'))
const model = buildModel([{ name: base.library, dir: '', groups: base.groups, catalogue: undefined }, ...readLibraries(['generator/fixtures/golden/lib'])])
writeFileSync('generator/fixtures/golden/Table.filter.mdx', renderPage(model.byPath.get('Standard.Table/Table/Table.filter'), model))
"
```

Then read `Table.filter.mdx` against this checklist before committing it (it is
the reviewed expectation, not a snapshot to accept blindly):

- `# Table.filter`, then one `<ComponentNode` with `name={"filter"}`,
  `icon={"preparation"}`,
  `color={"var(--group-color-Standard-Base-Selections)"}`,
  `returns={"Returns Table & Any"}`, params `column`, `filter`, `on_problems`
  with tooltips
  `Column | Expression | Text | Integer = Missing_Argument.throw "column"`,
  `Filter_Condition | (Any -> Boolean) = Filter_Condition.Equal True` (or the
  engine's rendering of it: open question 4, Task 13) and
  `Problem_Behavior = ..Report_Warning`; `column` not italic
  (`optional: false`), the other two `optional: true`.
- `**Group**: Selections / **Aliases**:` followed by the aliases and macro
  names, sorted.
- The body: the summary, the paragraphs, and the `action` / `on_problems`
  bullets the author put there.
- `## Arguments`: a three-row table; `column`'s and `filter`'s descriptions from
  the bullets; `on_problems` with an empty description.
- `## Returns`: `[Table](../Table/index.mdx) & Any` (the golden catalogue has
  the `Table` type; `Any` is in Base, which has no pages in the golden model),
  then the section's bullet.
- `## Examples`: four `###` titles, each a fenced `enso` block and "Returns a
  Table" followed by a Markdown table (not a code block).
- `## Errors` and `## Remarks` (with `### Nothing Equality`).

Fix the generator, not the file, for anything that is wrong; regenerate; rerun.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter docs-site run test:unit` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs-site/generator/src/pages.ts docs-site/generator/src/pages.test.ts docs-site/generator/fixtures/golden
git commit -m "docs-site: function, type, module and library pages; golden Table.filter"
```

### Task 11: Sidebars, the group stylesheet, the icon sprite, the report and the CLI

**Files:**

- Create: `docs-site/generator/src/sidebarData.ts`,
  `docs-site/generator/src/output.ts`, `docs-site/generator/src/report.ts`,
  `docs-site/generator/src/main.ts`
- Test: `docs-site/generator/src/sidebarData.test.ts`,
  `docs-site/generator/src/output.test.ts`

**Interfaces:**

- Consumes: Tasks 6-10; `groupColor`, `groupColorVar` from `./gui`.
- Produces:
  - `buildSidebars(model: SiteModel): Record<string, unknown[]>` (`api` plus one
    `api-<Library>` per library)
  - `groupsCss(model: SiteModel, fallback: string): string`
  - `readFallbackColour(baseCss: string): string` (the value of
    `--group-color-fallback:` in `app/gui/src/project-view/assets/base.css`)
  - `writeSite(model: SiteModel, siteDir: string): void` (clears and writes
    `docs/api/**` except `docs/api/index.md`, `generated/apiSidebars.json`,
    `src/css/groups.generated.css`, copies `static/img/icons.svg`)
  - `formatReport(model: SiteModel): string`
  - CLI:
    `corepack pnpm --filter docs-site run generate -- [--lib <dir>]… [--fixtures] [--min-function-pages <n>]`

- [ ] **Step 1: Write the failing tests**

```ts
// docs-site/generator/src/sidebarData.test.ts
import { expect, test } from "vitest";
import { FIXTURES_LIB, readLibraries } from "./catalogue";
import { buildModel } from "./model";
import { buildSidebars } from "./sidebarData";

const sidebars = buildSidebars(buildModel(readLibraries([FIXTURES_LIB])));

test("the Components intro sidebar lists the libraries", () => {
  expect(sidebars.api).toEqual([
    { type: "doc", id: "api/index", label: "Components" },
    {
      type: "ref",
      id: "api/Standard.Fixture/index",
      label: "Standard.Fixture",
    },
    {
      type: "ref",
      id: "api/Standard.Fixture_Ext/index",
      label: "Standard.Fixture_Ext",
    },
  ]);
});

test("one sidebar per library: modules, then types (collapsed) with constructors and methods", () => {
  expect(sidebars["api-Standard.Fixture"]).toEqual([
    {
      type: "doc",
      id: "api/Standard.Fixture/index",
      label: "Standard.Fixture",
    },
    {
      type: "category",
      label: "Shapes",
      link: { type: "doc", id: "api/Standard.Fixture/Shapes/index" },
      collapsed: true,
      items: [
        {
          type: "category",
          label: "Shape",
          link: { type: "doc", id: "api/Standard.Fixture/Shapes/Shape/index" },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Shape.unit/index",
              label: "Shape.unit",
            },
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Shape.area/index",
              label: "area",
            },
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Shape.op-2b/index",
              label: "+",
            },
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Shape.undocumented/index",
              label: "undocumented",
            },
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Shape.odd_icon/index",
              label: "odd_icon",
            },
          ],
        },
        {
          type: "category",
          label: "Square",
          link: { type: "doc", id: "api/Standard.Fixture/Shapes/Square/index" },
          collapsed: true,
          items: [
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Square.Value/index",
              label: "Square.Value",
            },
            {
              type: "doc",
              id: "api/Standard.Fixture/Shapes/Square.side/index",
              label: "side",
            },
          ],
        },
        {
          type: "doc",
          id: "api/Standard.Fixture/Shapes/make_shape/index",
          label: "make_shape",
        },
      ],
    },
  ]);
});
```

```ts
// docs-site/generator/src/output.test.ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FIXTURES_LIB, readLibraries } from "./catalogue";
import { buildModel } from "./model";
import { groupsCss, readFallbackColour, writeSite } from "./output";

const model = buildModel(readLibraries([FIXTURES_LIB]));

test("the fallback colour is read from the IDE", () => {
  expect(
    readFallbackColour(":root {\n  --group-color-fallback: #006b8a;\n}"),
  ).toBe("#006b8a");
  expect(() => readFallbackColour(":root {}")).toThrow();
});

test("one variable per group, named and valued as WithCurrentProject.vue sets them", () => {
  const css = groupsCss(model, "#006b8a");
  expect(css).toContain(
    "--group-color-Standard-Fixture-Selections: oklch(0.464 0.14 325);",
  );
  expect(css).toMatch(/--group-color-Standard-Fixture-Shaping: (rgb|oklch)\(/);
  expect(css).toContain("--group-color-fallback: #006b8a;");
});

test("writes pages, sidebars, the stylesheet and the sprite, and keeps the intro", () => {
  const site = mkdtempSync(join(tmpdir(), "docs-site-"));
  mkdirSync(join(site, "docs/api/stale"), { recursive: true });
  writeFileSync(join(site, "docs/api/index.md"), "intro");
  writeFileSync(join(site, "docs/api/stale/index.mdx"), "old");
  writeSite(model, site);
  expect(readFileSync(join(site, "docs/api/index.md"), "utf8")).toBe("intro");
  expect(existsSync(join(site, "docs/api/stale"))).toBe(false);
  expect(
    existsSync(
      join(site, "docs/api/Standard.Fixture/Shapes/Shape.area/index.mdx"),
    ),
  ).toBe(true);
  expect(existsSync(join(site, "generated/apiSidebars.json"))).toBe(true);
  expect(existsSync(join(site, "src/css/groups.generated.css"))).toBe(true);
  const sprite = readFileSync(join(site, "static/img/icons.svg"), "utf8");
  expect(sprite).toContain('<symbol id="preparation"');
});

test("every icon a node uses is a symbol of the sprite", () => {
  const site = mkdtempSync(join(tmpdir(), "docs-site-"));
  writeSite(model, site);
  const sprite = readFileSync(join(site, "static/img/icons.svg"), "utf8");
  const used = new Set<string>();
  for (const file of model.pages.map((page) =>
    join(site, "docs/api", page.path, "index.mdx"),
  )) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /icon=\{"([^"]+)"\}/g,
    ))
      used.add(match[1]!);
  }
  for (const icon of used) expect(sprite).toContain(`<symbol id="${icon}"`);
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// docs-site/generator/src/sidebarData.ts
import { isFunctionPage, type Page, type SiteModel } from "./model";
import { simpleName } from "./typeText";

const id = (page: Page) => `api/${page.path}/index`;
const doc = (page: Page, label: string) => ({
  type: "doc",
  id: id(page),
  label,
});

/** `api`: the intro and the libraries; `api-<library>`: that library's modules, types and functions. */
export function buildSidebars(model: SiteModel): Record<string, unknown[]> {
  const sidebars: Record<string, unknown[]> = {
    api: [{ type: "doc", id: "api/index", label: "Components" }],
  };
  for (const library of model.libraries) {
    const libraryPage = model.byPath.get(library)!;
    (sidebars.api as unknown[]).push({
      type: "ref",
      id: id(libraryPage),
      label: library,
    });
    const pages = model.pages.filter((page) => page.library === library);
    const memberOf = (type: Page) => {
      const qualified = `${type.module}.${type.title}`;
      return pages.filter(
        (page) =>
          isFunctionPage(page) &&
          ((page.kind === "constructor" &&
            "returnType" in page.entry &&
            page.entry.returnType === qualified) ||
            ((page.kind === "staticMethod" || page.kind === "instanceMethod") &&
              "selfType" in page.entry &&
              page.entry.selfType === qualified)),
      );
    };
    const orderMembers = (members: Page[]) => [
      ...members.filter((page) => page.kind === "constructor"),
      ...members.filter((page) => page.kind === "staticMethod"),
      ...members.filter((page) => page.kind === "instanceMethod"),
    ];
    const moduleCategory = (module: Page) => ({
      type: "category",
      label: module.kind === "library" ? "Main" : simpleName(module.module),
      link: { type: "doc", id: id(module) },
      collapsed: true,
      items: [
        ...pages
          .filter(
            (page) => page.kind === "type" && page.module === module.module,
          )
          .map((type) => ({
            type: "category",
            label: type.title,
            link: { type: "doc", id: id(type) },
            collapsed: true,
            items: orderMembers(memberOf(type)).map((page) =>
              doc(page, page.nodeName),
            ),
          })),
        ...pages
          .filter(
            (page) =>
              (page.kind === "moduleFunction" ||
                page.kind === "extensionMethod") &&
              page.module === module.module,
          )
          .map((page) => doc(page, page.nodeName)),
      ],
    });
    const mainHasMembers = pages.some(
      (page) =>
        page.kind !== "library" &&
        page.kind !== "module" &&
        page.module === libraryPage.module,
    );
    sidebars[`api-${library}`] = [
      doc(libraryPage, library),
      ...(mainHasMembers ? [moduleCategory(libraryPage)] : []),
      ...pages.filter((page) => page.kind === "module").map(moduleCategory),
    ];
  }
  return sidebars;
}
```

Member order inside a type is constructors, static methods, then instance
methods, each in catalogue order (the sidebar test above lists them so; adjust
the test's expected order only if the fixture's catalogue order differs, never
the rule).

```ts
// docs-site/generator/src/output.ts
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groupColor, groupColorVar } from "./gui";
import type { SiteModel } from "./model";
import { renderPage } from "./pages";
import { buildSidebars } from "./sidebarData";

/** The IDE's icon sprite and stylesheet, read at every run so the site ships the current ones. */
export const ICONS_SVG = fileURLToPath(
  new URL(
    "../../../app/gui/src/project-view/assets/icons.svg",
    import.meta.url,
  ),
);
export const BASE_CSS = fileURLToPath(
  new URL("../../../app/gui/src/project-view/assets/base.css", import.meta.url),
);

/** `--group-color-fallback`'s value in the IDE's `base.css`. */
export function readFallbackColour(baseCss: string): string {
  const match = baseCss.match(/--group-color-fallback:\s*([^;]+);/);
  if (!match)
    throw new Error("--group-color-fallback not found in the IDE stylesheet");
  return match[1]!.trim();
}

/** One variable per group, as `WithCurrentProject.vue` sets them, and the fallback. */
export function groupsCss(model: SiteModel, fallback: string): string {
  const lines = model.groups.map(
    (group) => `  ${groupColorVar(group)}: ${groupColor(group)};`,
  );
  return `/* Generated by docs-site/generator; do not edit. */\n:root {\n${lines.join("\n")}\n  --group-color-fallback: ${fallback};\n}\n`;
}

/** Replace the generated parts of the site in `siteDir` (`docs-site/` in normal use). */
export function writeSite(
  model: SiteModel,
  siteDir: string,
  baseCss: string = readFileSync(BASE_CSS, "utf8"),
): void {
  const apiDir = join(siteDir, "docs/api");
  mkdirSync(apiDir, { recursive: true });
  for (const name of readdirSync(apiDir)) {
    if (name !== "index.md")
      rmSync(join(apiDir, name), { recursive: true, force: true });
  }
  for (const page of model.pages) {
    const file = join(apiDir, page.path, "index.mdx");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, renderPage(page, model));
  }
  mkdirSync(join(siteDir, "generated"), { recursive: true });
  writeFileSync(
    join(siteDir, "generated/apiSidebars.json"),
    JSON.stringify(buildSidebars(model), null, 2) + "\n",
  );
  mkdirSync(join(siteDir, "src/css"), { recursive: true });
  writeFileSync(
    join(siteDir, "src/css/groups.generated.css"),
    groupsCss(model, readFallbackColour(baseCss)),
  );
  mkdirSync(join(siteDir, "static/img"), { recursive: true });
  copyFileSync(ICONS_SVG, join(siteDir, "static/img/icons.svg"));
}
```

```ts
// docs-site/generator/src/report.ts
import { unknownIcons } from "./componentNode";
import { isFunctionPage, type SiteModel } from "./model";

/** The run's report: counts by kind and library, gaps, and anything to look at. */
export function formatReport(model: SiteModel): string {
  const lines: string[] = [];
  for (const library of model.libraries) {
    const pages = model.pages.filter((page) => page.library === library);
    const counts = new Map<string, number>();
    for (const page of pages)
      counts.set(page.kind, (counts.get(page.kind) ?? 0) + 1);
    lines.push(
      `${library}: ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(", ")}`,
    );
  }
  const conversions = [...model.conversions.values()].flat().length;
  lines.push(
    `Function pages: ${model.pages.filter(isFunctionPage).length}; conversions: ${conversions}`,
  );
  if (model.skipped.length)
    lines.push(`No catalogue (skipped): ${model.skipped.join(", ")}`);
  const undocumented = model.pages.filter(
    (page) => isFunctionPage(page) && !page.doc.documentation.trim(),
  );
  if (undocumented.length)
    lines.push(
      `Without documentation (${undocumented.length}): ${undocumented.map((page) => page.path).join(", ")}`,
    );
  if (unknownIcons.size)
    lines.push(`Unknown icons: ${[...unknownIcons].sort().join(", ")}`);
  const unresolved = new Set<string>();
  for (const page of model.pages) {
    const types =
      page.entry && "arguments" in page.entry
        ? page.entry.arguments.map((arg) => arg.reprType)
        : [];
    if (page.entry && "returnType" in page.entry)
      types.push(page.entry.returnType);
    for (const type of types)
      for (const name of type.match(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\b/g) ??
        [])
        if (!model.types.has(name)) unresolved.add(name);
  }
  if (unresolved.size)
    lines.push(
      `Type names with no page (${unresolved.size}): ${[...unresolved].sort().join(", ")}`,
    );
  if (model.caseCollisions.length)
    lines.push(
      `Paths differing only in case: ${model.caseCollisions.map((pair) => pair.join(" ~ ")).join("; ")}`,
    );
  return lines.join("\n");
}
```

```ts
// docs-site/generator/src/main.ts
/**
 * @file `generate`: read the catalogues of a distribution (or the fixtures) and write the
 * Components reference into `docs-site/`. Usage:
 * `corepack pnpm --filter docs-site run generate -- --lib <distribution>/lib [--min-function-pages <n>]`
 * or `-- --fixtures`.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { FIXTURES_LIB, readLibraries } from "./catalogue";
import { buildModel, isFunctionPage } from "./model";
import { writeSite } from "./output";
import { formatReport } from "./report";

const SITE_DIR = fileURLToPath(new URL("../..", import.meta.url));

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    lib: { type: "string", multiple: true },
    fixtures: { type: "boolean" },
    "min-function-pages": { type: "string" },
  },
});

const roots = [
  ...(values.lib ?? []),
  ...(values.fixtures ? [FIXTURES_LIB] : []),
];
if (!roots.length) {
  console.error(
    "Give a distribution lib directory (--lib <dir>) or --fixtures.",
  );
  process.exit(2);
}
const model = buildModel(readLibraries(roots));
writeSite(model, SITE_DIR);
console.info(formatReport(model));
const floor = Number(values["min-function-pages"] ?? 0);
const functionPages = model.pages.filter(isFunctionPage).length;
if (functionPages < floor) {
  console.error(
    `Only ${functionPages} function pages, below the floor of ${floor}: is a catalogue empty?`,
  );
  process.exit(1);
}
```

- [ ] **Step 3: Run the tests, then build the fixture site**

```bash
corepack pnpm --filter docs-site run test:unit
corepack pnpm --filter docs-site run generate -- --fixtures
corepack pnpm --filter docs-site run build
corepack pnpm --filter docs-site run serve
```

Expected: tests PASS; the generator prints a report naming `Standard.Fixture`
and `Standard.Fixture_Ext`, 9 function pages, `Unknown icons: not_an_icon`; the
build passes with `onBrokenLinks`, `onBrokenAnchors` and `onBrokenMarkdownLinks`
all `throw`; at
`http://localhost:3210/enso/docs/api/Standard.Fixture/Shapes/Shape.area/` the
page shows the node in Selections' colour with the `preparation` icon, the
badges, the Group/Aliases line and the sections; the Components navbar item
opens the intro with both libraries in its sidebar; searching "extent" finds
`Shape.area`. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add docs-site/generator/src/sidebarData.ts docs-site/generator/src/sidebarData.test.ts docs-site/generator/src/output.ts docs-site/generator/src/output.test.ts docs-site/generator/src/report.ts docs-site/generator/src/main.ts
git commit -m "docs-site: sidebars, group colours, icon sprite, report and the generate command"
```

### Task 12: Accessibility and keyboard tests on the built site

Spec section 8, "Accessibility". Written now and run on the fixture build (R9);
PR 3 runs them in CI on the real build.

**Files:**

- Create: `docs-site/playwright.config.ts`, `docs-site/e2e/pages.ts`,
  `docs-site/e2e/node.spec.ts`, `docs-site/e2e/axe.spec.ts`

**Interfaces:**

- Consumes: a built site in `docs-site/build` (`build` script), served by
  `serve` on port 3210.
- Produces: `corepack pnpm --filter docs-site run test:e2e`; the env variable
  `DOCS_SITE_E2E_FUNCTION`/`DOCS_SITE_E2E_TYPE` choose which pages to check
  (defaults: the fixture's `Shape.area` and `Shape`; PR 3 sets the real
  `Table.filter` and `Table`).

- [ ] **Step 1: Write the config and the tests**

```ts
// docs-site/playwright.config.ts
import { defineConfig, devices } from "playwright/test";

/** Runs against the built site (`build`, then this serves it); no dev server. */
export default defineConfig({
  testDir: "./e2e",
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:3210/enso/" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@touch/,
    },
    { name: "touch", use: { ...devices["Pixel 7"] }, grep: /@touch/ },
  ],
  webServer: {
    command: "corepack pnpm run serve",
    url: "http://localhost:3210/enso/",
    reuseExistingServer: !process.env.CI,
  },
});
```

```ts
// docs-site/e2e/pages.ts
/** The pages the accessibility tests visit: the fixture's by default, the real ones in CI. */
export const FUNCTION_PAGE =
  process.env.DOCS_SITE_E2E_FUNCTION ??
  "docs/api/Standard.Fixture/Shapes/Shape.area/";
export const TYPE_PAGE =
  process.env.DOCS_SITE_E2E_TYPE ?? "docs/api/Standard.Fixture/Shapes/Shape/";
export const GUIDE_PAGE = "docs/intro/";
```

The node is found as `[role=group][aria-label]` (Docusaurus's own markup may
have other groups).

```ts
// docs-site/e2e/node.spec.ts
import { expect, test } from "playwright/test";
import { FUNCTION_PAGE } from "./pages";

test.describe("component node tooltips", () => {
  test("Tab reaches each pill, focus shows its tooltip, Escape hides it", async ({
    page,
  }) => {
    await page.goto(FUNCTION_PAGE);
    const node = page.locator("[role=group][aria-label]").first();
    const pills = node.getByRole("button");
    const count = await pills.count();
    expect(count).toBeGreaterThan(1);
    await pills.first().focus();
    for (let i = 0; i < count; i++) {
      const pill = pills.nth(i);
      await expect(pill).toBeFocused();
      const tooltip = page.locator(
        `#${await pill.getAttribute("aria-describedby")}`,
      );
      await expect(tooltip).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tooltip).toBeHidden();
      await page.keyboard.press("Tab");
    }
  });

  test("hover shows a tooltip, and it stays while the pointer is over it", async ({
    page,
  }) => {
    await page.goto(FUNCTION_PAGE);
    const name = page
      .locator("[role=group][aria-label]")
      .first()
      .getByRole("button")
      .first();
    const tooltip = page.locator(
      `#${await name.getAttribute("aria-describedby")}`,
    );
    await name.hover();
    await expect(tooltip).toBeVisible();
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
  });

  test("the node has the full signature as its accessible name", async ({
    page,
  }) => {
    await page.goto(FUNCTION_PAGE);
    await expect(
      page.locator("[role=group][aria-label]").first(),
    ).toHaveAttribute("aria-label", /\) -> /);
  });
});

test("a tap toggles a tooltip; tapping elsewhere closes it @touch", async ({
  page,
}) => {
  await page.goto(FUNCTION_PAGE);
  const name = page
    .locator("[role=group][aria-label]")
    .first()
    .getByRole("button")
    .first();
  const tooltip = page.locator(
    `#${await name.getAttribute("aria-describedby")}`,
  );
  await name.tap();
  await expect(tooltip).toBeVisible();
  await page.locator("h1").tap();
  await expect(tooltip).toBeHidden();
});
```

```ts
// docs-site/e2e/axe.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";
import { FUNCTION_PAGE, GUIDE_PAGE, TYPE_PAGE } from "./pages";

for (const colorScheme of ["light", "dark"] as const) {
  for (const [name, path] of [
    ["function", FUNCTION_PAGE],
    ["type", TYPE_PAGE],
    ["guide", GUIDE_PAGE],
  ] as const) {
    test(`${name} page has no axe violations (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
```

The `desktop` project runs every test except the `@touch` one; the `touch`
project only that one.

- [ ] **Step 2: Run them on the fixture build**

```bash
corepack pnpm --filter docs-site exec playwright install chromium
corepack pnpm --filter docs-site run generate -- --fixtures
corepack pnpm --filter docs-site run build
corepack pnpm --filter docs-site run test:e2e
```

Expected: all pass. An axe violation in Docusaurus's own theme (not in
`ComponentNode` or `custom.css`) is fixed with CSS in `custom.css` or by a
swizzle only if small; otherwise record it in `docs-site/CLAUDE.md` and exclude
that one rule for that one selector (`.exclude('<selector>')`), never globally.
A contrast failure in dark mode on links: darken or lighten the dark ramp in
`custom.css` (Task 4).

- [ ] **Step 3: Commit**

```bash
git add docs-site/playwright.config.ts docs-site/e2e
git commit -m "docs-site: axe, keyboard and touch tests of the built site"
```

### Task 13: The real reference: measurements and the implementation checks

Spec open questions 4, 6, 7, 8 (local half), 9 and 10, each with its fallback.
Results go into the PR body and `docs-site/CLAUDE.md` (Task 14). Use the `lib`
extracted in Task 10 Step 1 (`$SCRATCH/dist/built-distribution/*/*/lib`).

- [ ] **Step 1: Generate the full reference**

```bash
lib=$(ls -d "$SCRATCH"/dist/built-distribution/*/*/lib)
corepack pnpm --filter docs-site run generate -- --lib "$lib" > "$SCRATCH/report.txt"
```

Expected: exit 0. Read the report: function pages per library (record the total
as `N`); "No catalogue": exactly `Standard.Database_Test_Suite` and
`Standard.Visualization` (both say `catalogue: false`); unknown icons and
unresolved type names listed (record the counts; neither fails the run).

- [ ] **Step 2: Collisions (OQ 9)**

If `buildModel` threw "Two pages at …": the path rule cannot tell two entries
apart. Stop and report the pair to the owner; do not invent a rule.

If the report lists "Paths differing only in case": GitHub Pages and the Linux
CI build are case-sensitive, so the URLs are fine; only a build on a Windows or
macOS file system would write two pages into one folder. **Fallback:** keep the
URLs; in `writeSite`, write the second page of each pair to the folder
`<path>~1` (its `slug` front matter keeps the real URL, so links still resolve:
relative links go to files, and the file moved with the page), and print a
warning that a local Windows or macOS build of the full reference may still lose
one of each pair in the build output. Add a test with the `Side`/`side` fixture
case. Put the list in the PR body for the owner.

- [ ] **Step 3: Build time and memory (OQ 7)**

In WSL, on a clone under `~/` (Global Constraints), with the same `lib` copied
next to it, generate, then:

```bash
/usr/bin/time -v corepack pnpm --filter docs-site run build 2> ~/docs-site-build-time.txt
grep -E 'Elapsed|Maximum resident' ~/docs-site-build-time.txt
```

Record wall time and peak RSS. The CI runner (`ubuntu-latest`) has 4 vCPUs and
16 GB. **Pass:** under 20 minutes and under 10 GB. **Fallback 1:** add the
exactly pinned `@docusaurus/faster` (same version as `@docusaurus/core`) and
`future: { experimental_faster: true }` to `docusaurus.config.ts`; measure
again. **Fallback 2:** one docs plugin instance per library for the reference
(`routeBasePath: 'docs/api/<Library>'`, slugs relative to it, so no URL changes)
beside the main instance; measure again. Raise the build script's
`--max-old-space-size` only with a measured reason. Record which configuration
passed.

- [ ] **Step 4: Search index (OQ 6)**

```bash
ls -l docs-site/build/search-index*.json
gzip -c docs-site/build/search-index*.json | wc -c
```

Record both sizes (it is the first search's download). **Fallback**, if the
gzipped index is over 5 MB: set the plugin's `searchContextByPaths` to one entry
per library (`docs/api/<Library>`) plus `docs` for the guides, so a search
downloads only the current section's index; measure again.

- [ ] **Step 5: Dotted paths with `trailingSlash` (OQ 8, local half)**

With `serve` running:
`curl -sI http://localhost:3210/enso/docs/api/Standard.Table/Table/Table.filter`
Expected: a redirect (301/302) to `…/Table.filter/`, and
`curl -s http://localhost:3210/enso/docs/api/Standard.Table/Table/Table.filter/ | grep -c 'role="group"'`
greater than 0 (the node; CSS module class names are hashed in a production
build, so do not grep for them). The GitHub Pages half is Task 25. **Fallback**
(if Pages does not redirect the slashless form): a post-build step in the deploy
that writes `<path>.html` with a `<meta http-equiv="refresh">` to `<path>/` for
every API page (Pages serves `x.html` for `/x`).

- [ ] **Step 6: Result tables (OQ 10)**

Open `…/Standard.Table/Table/Table.filter/` and check every "Returns a Table" in
Examples is followed by a rendered table, not a code block. Compare with the
IDE's help panel for `Table.filter` (open the IDE from a local build, add a
`filter` node, open its help). **Fallback**, if the help panel shows code
blocks: keep the generator's table conversion (the site is more readable) and
note the difference in the PR body; if the generator shows code where the panel
shows tables, extend `mdx.ts`'s `CodeBlock` case to the node the real text
produced.

- [ ] **Step 7: Default values (OQ 4)**

Read the parameter tooltips of twenty functions across Base, Table and Database
(pick ones with call defaults: `Table.filter`, `Table.join`, `Table.aggregate`,
`Data.read`, `Text.split`, …). **Pass:** each reads as source would
(`Missing_Argument.throw "column"`, `Filter_Condition.Equal True`).
**Fallback,** if the engine's `buildDefaultValue` rendering puts arguments
before the function or is otherwise unreadable: show it as given, open an issue
for the engine's rendering with three examples, and link it in the PR body. The
generator does not rewrite defaults.

- [ ] **Step 8: The function-page floor**

Set the floor to 80 % of `N`, rounded down to a hundred, as a named constant:
add `export const MIN_FUNCTION_PAGES = <value>` (with a comment giving `N` and
the date) to `main.ts`, used when `--min-function-pages` is not given and
`--lib` is. Fixtures runs keep no floor.

- [ ] **Step 9: Linux**

In the WSL clone (Step 3): `corepack pnpm install --frozen-lockfile`,
`corepack pnpm --filter docs-site run test:unit`, the fixture build and
`test:e2e`, and the full generate + build. Expected: as on Windows. Delete the
clone and the copied `lib` when done.

- [ ] **Step 10: Commit**

```bash
git add docs-site
git commit -m "docs-site: measured on the full reference; function-page floor"
```

(Stage only what the fallbacks changed; `git status` must show no generated file
under `docs-site/` as untracked, since `.gitignore` covers them.)

### Task 14: Documentation, the GUI gate, the PR and the owner's preview

**Files:**

- Create: `docs-site/CLAUDE.md`
- Modify: `CLAUDE.md` (top-level layout, build systems), `docs/CLAUDE.md`,
  `.github/workflows/gui-changed-files.yml`

- [ ] **Step 1: `docs-site/CLAUDE.md`**

Write it per the `project-structure` skill: what the package is (the user
documentation site, published from `develop` to
`https://jdunkerley.github.io/enso/`); its layout (spec section 4, plus
`generated/`, `e2e/`); the scripts and how to run a fixture build and a real one
(Task 10 Step 1's `gh run download` recipe); the rule that the generator imports
the GUI only through `generator/src/gui.ts` and never copies (with the R1 moves
listed and why); that `typecheck` and `test:unit` need no distribution; the
golden file and how to regenerate it (Task 10 Step 4); the measurements of Task
13 (build time, memory, search index, `N`, the floor) and which fallbacks are
on; the `hoist=false` note (Task 4 Step 5) with any packages added for it; and
that the versioning design is the spec's section 6.

- [ ] **Step 2: Root and docs `CLAUDE.md`**

Root `CLAUDE.md`, "Top-level layout", after the `docs/` bullet:

```md
- `docs-site/` — The user documentation site (Docusaurus; React only here):
  hand-written guides and a Components reference generated from the standard
  libraries' catalogues. Published from `develop` to GitHub Pages. See
  `docs-site/CLAUDE.md`.
```

and in "Build systems", the pnpm bullet: "(packages listed in
`pnpm-workspace.yaml`, including `docs-site`)".

`docs/CLAUDE.md`, after the first paragraph:

```md
The user documentation (guides and the Components reference) is the site in
`docs-site/`, published at https://jdunkerley.github.io/enso/.
```

- [ ] **Step 3: The GUI gate**

In `.github/workflows/gui-changed-files.yml`, add `docs-site/**` after `app/**`
in both steps' `files:` lists (they are kept in sync), and to the second step's
`files_ignore:` (a site change runs the GUI checks' typecheck, lint and unit
tests, which cover `docs-site` through the root `ci:*` scripts, but does not
package the IDE). Update the comment above the second step to say so.

- [ ] **Step 4: Format and check everything**

```bash
corepack pnpm exec prettier --check docs-site app/common/src/docsSite app/ydoc-shared/src/ast app/gui/src CLAUDE.md docs/CLAUDE.md .github/workflows/gui-changed-files.yml
node tools/ci/check-workflows.mjs
corepack pnpm run ci:typecheck
corepack pnpm --filter docs-site run lint
corepack pnpm --filter docs-site run test:unit
corepack pnpm --filter enso-gui exec vitest run src/project-view/util src/providers/openedProjects/suggestionDatabase src/project-view/composables
corepack pnpm --filter enso-common run test:unit
corepack pnpm --filter ydoc-shared run test:unit
```

Expected: all clean. (Fix formatting with `--write`, then re-check.)

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add docs-site/CLAUDE.md CLAUDE.md docs/CLAUDE.md .github/workflows/gui-changed-files.yml
git commit -m "docs-site: CLAUDE.md, layout notes, GUI gate"
git push -u origin docs/docs-site-generator
```

PR title: "User docs site: generator and skeleton". Body (Write tool, then
`gh pr create --base develop --body-file <file> --label "CI: No changelog needed"`):
what it adds (the moves, `apiPath`, the package, the generator, the node, the
tests); the Task 13 measurements and which fallbacks are on; the collision list
if any; the result-table and default-value findings; what was not verified (the
GitHub Pages half of OQ 8, the CI routes, which are PR 3); the Linux run; and a
"For the owner" section asking for the preview review. Refs #577 (the spec).

- [ ] **Step 6: The owner's preview review**

Build the full reference locally (Task 13), zip `docs-site/build`, and give the
owner: the zip (they run `corepack pnpm --filter docs-site run serve` after
unzipping into `docs-site/build`), and screenshots, light and dark, of
`Table.filter` (and the IDE's help panel and graph node for the same function,
side by side), the `Table` type page, a module page and a library page, attached
to the PR through the orphan `pr-screenshots` branch as the repository's
screenshot rule says. Ask for a verdict on: the node's look against the graph
editor, the page sections, and the URLs. Fix what the owner asks, then merge on
green with the owner's OK. Remove the worktree and the local branch.

---

# PR 2: Guides

Worktree (after PR 1 merges):
`git fetch origin && git worktree add C:\Repos\Enso\ide\.claude\worktrees\docs-site-guides -b docs/docs-site-guides origin/develop`,
then `corepack pnpm install`.

The pages of the spec's section 1. **Write for someone using the IDE, not for a
developer of it:** what they see, what they click, what happens, in the IDE's
own words (button and menu labels exactly as `app/common/src/text/english.json`
and the GUI show them). No internal names (no `LocalBackend`, no shim, no
`versioning/commit`), no file paths in the repository, no PR numbers.

**Where the facts come from.** For each page, the design spec and its plan in
`docs/superpowers/` (named in each task) say what the feature does and why; the
code says what it does now. Where they differ, the code wins: read the
components and the `english.json` keys the spec names, and check each claim
before writing it. Keep a list of every claim you could not check in the IDE
itself, and put it in the PR body for the owner.

**Screenshots.** From a local installer build of the PR's `develop` base (the
`ide-local` recipe in `docs/CONTRIBUTING.md`, "Building the IDE"; on Windows the
memory note on the vcvars `.cmd` file applies), light theme, a fresh profile and
a sample project, at a 1280×800 window. PNG, cropped to the part being
explained, under 300 KB each (`oxipng` or any lossless optimiser), stored next
to the page: each guide is a folder, `docs-site/docs/<guide>/index.md`, with its
images beside it and referenced relatively
(`![The Versions tab](./versions-tab.png)`), each with alt text that says what
the image shows.

### Task 15: Page skeletons, sidebar and intro

**Files:**

- Create: `docs-site/docs/<guide>/index.md` for `getting-started`,
  `installing-and-updating`, `local-versioning`, `secrets`, `engine-logs`,
  `samples`, each with front matter only (`title`, `slug: /<guide>/`,
  `description`) and an `# <title>` line
- Modify: `docs-site/sidebars.ts` (`guides`), `docs-site/docs/intro.md`

- [ ] **Step 1: Sidebar**

```ts
const sidebars: SidebarsConfig = {
  guides: [
    "intro",
    "getting-started/index",
    "installing-and-updating/index",
    "samples/index",
    "local-versioning/index",
    "secrets/index",
    "engine-logs/index",
  ],
  ...apiSidebars,
};
```

- [ ] **Step 2: Intro**

Replace "The guides, coming soon, explain how to use the IDE" with a short list
linking each guide (`[Getting started](./getting-started/index.md)`, …), one
line each on what it covers. Keep the Components and wiki paragraphs.

- [ ] **Step 3: Build and commit**

Run: `corepack pnpm --filter docs-site run build` (no distribution needed: the
Components sidebar is empty without one). Expected: no broken links.

```bash
git add docs-site/docs docs-site/sidebars.ts
git commit -m "docs-site: guide pages and sidebar"
```

### Task 16: Getting started, and samples

**Files:** `docs-site/docs/getting-started/index.md` and images;
`docs-site/docs/samples/index.md` and images.

Sources: the IDE itself (spec: "the IDE");
`docs/superpowers/specs/2026-10-17-local-only-ide-design.md` (what the dashboard
is now: local only, no login); `app/gui/CLAUDE.md` (the drive's categories:
Local, Recent, saved folders; the component browser; the help panel). For
samples: `downloadSamples` and `SAMPLES_DIRECTORY_NAME` in
`app/project-manager-shim/src/projectManagement.ts`, called from
`app/electron-client/src/index.ts` (R12).

- [ ] **Step 1: Getting started** — sections: _Create a project_ (the drive, New
      Project, where it is saved); _Add a component_ (the component browser:
      open it, search, aliases find components, Enter to add); _Connect
      components_ (drag from an output port); _Read a result_ (the visualization
      under a node, choosing another visualization); _Get help on a component_
      (the help panel, and that the Components reference on this site has the
      same text); _Save and close_. A screenshot for each of the component
      browser, a connected pair of nodes with a table visualization, and the
      help panel.
- [ ] **Step 2: Samples** — where the sample projects come from (downloaded on
      the IDE's first start into a `Samples` folder in the projects directory,
      when that folder does not exist yet), how to open one from the drive, that
      they are ordinary projects (edit freely; to get a fresh copy, delete or
      rename the `Samples` folder and restart). Check each statement against
      `downloadSamples` before writing it. Screenshot: the drive showing the
      Samples folder.
- [ ] **Step 3: Build, read through, commit**

Run: `corepack pnpm --filter docs-site run build` and `serve`; read both pages
in the browser, light and dark.

```bash
git add docs-site/docs/getting-started docs-site/docs/samples
git commit -m "docs-site: getting started and samples guides"
```

### Task 17: Installing and updating

**Files:** `docs-site/docs/installing-and-updating/index.md` and images.

Sources:
`docs/superpowers/specs/2026-10-18-standard-installer-and-updates-design.md` and
`docs/superpowers/plans/2026-10-18-standard-installer-and-updates.md`; the
version checker (`app/gui/src/versionChecker/`); the releases page
`https://github.com/jdunkerley/enso/releases`.

- [ ] **Step 1: Write** — sections: _Download_ (the releases page, which file
      for each platform); _Install on Windows_, _on macOS_, _on Linux_ (what the
      installer asks, where the IDE is installed, where projects go by default;
      unsigned-installer warnings and how to get past them, if the spec or the
      release notes say the fork ships unsigned); _Updates_ (how a new version
      is offered — the "new version available" dialog — and what applying it
      does); _Uninstalling_ (and that projects are kept). A screenshot of the
      update dialog (from the version checker's own dialog, or its Playwright
      mock if a real update cannot be staged; say which in the PR body).
- [ ] **Step 2: Build, read through, commit**

```bash
git add docs-site/docs/installing-and-updating
git commit -m "docs-site: installing and updating guide"
```

### Task 18: Local versioning

**Files:** `docs-site/docs/local-versioning/index.md` and images.

Sources: `docs/superpowers/specs/2026-10-16-local-git-versioning-design.md`,
`docs/superpowers/specs/2026-10-11-local-labels-and-recent-design.md` and their
plans (`docs/superpowers/plans/2026-10-16-local-git-versioning.md`,
`2026-10-11-local-labels-and-recent.md`); `app/gui/CLAUDE.md`, "Local versioning
(saving versions)"; `app/gui/src/versions/` (the Versions tab);
`app/common/CLAUDE.md` ("`LocalBackend`: labels, Recent, and versioning"). This
is the page issue #240 asked for (R11: "Refs #240").

- [ ] **Step 1: Write** — sections: _What a version is_ (a saved snapshot of a
      project, kept on your computer; Git is used underneath, and is needed —
      what the IDE shows when Git is missing); _Turning versioning on_ (the
      prompt, and the setting); _When versions are saved_ (on closing or saving
      a project; not on quitting the app — check `app/gui/CLAUDE.md`'s wording
      against the code); _The Versions tab_ (opening it, the list, comments on a
      version); _Restoring and duplicating_ (restore a version, open an old
      version as a new project); _Labels and Recent_ (labelling projects,
      filtering by label, the Recent list, removing from Recent). Screenshots:
      the Versions tab with a few versions, the restore menu, the labels picker,
      the Recent list.
- [ ] **Step 2: Build, read through, commit**

```bash
git add docs-site/docs/local-versioning
git commit -m "docs-site: local versioning guide"
```

### Task 19: Secrets

**Files:** `docs-site/docs/secrets/index.md` and images.

Sources: `docs/superpowers/specs/2026-10-18-local-secrets-design.md` and its
plan; `app/gui/src/secrets/` and its `CLAUDE.md` (which dialogs are live:
Settings, the Drive bar's New secret, the pickers); the standard library's
`Enso_Secret`
(`distribution/lib/Standard/Base/0.0.0-dev/src/Enso_Cloud/Enso_Secret.enso`;
check the path with `Glob`) for how a workflow uses one.

- [ ] **Step 1: Write** — sections: _What a secret is_ (a named value, such as a
      password or key, kept out of your project's code); _Creating a secret_
      (from Settings and from the drive's New secret); _Using a secret in a
      workflow_ (picking it in a component's argument, e.g. a database
      password); _Changing and removing secrets_; _Where secrets are stored_ (on
      this computer, how they are protected — exactly what the spec and the code
      say, nothing more). Screenshots: the New secret dialog, a secret picked in
      an argument.
- [ ] **Step 2: Build, read through, commit**

```bash
git add docs-site/docs/secrets
git commit -m "docs-site: secrets guide"
```

### Task 20: Engine logs

**Files:** `docs-site/docs/engine-logs/index.md` and images.

Sources: `docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md` and its
plan; `app/gui/CLAUDE.md`, "Engine logs (the bottom dock's Logs tab)";
`app/gui/src/project-view/components/EngineLogs/` and its `CLAUDE.md`; the
shortcuts in `app/gui/src/configurations/graphInputBindings.ts`
(`graph.toggleLogs`, `graph.toggleCodeEditor`).

- [ ] **Step 1: Write** — sections: _Opening the logs_ (the Logs button at the
      bottom of the graph's left gutter, the shortcut — written as Ctrl+L on
      Windows and Linux, ⌘L on macOS, after checking the binding); _The dock_
      (switching between Code and Logs, full screen, closing); _Reading and
      filtering_ (levels, search, the unseen-errors dot); _Sending logs with a
      bug report_ (what to copy or save, and where to report:
      `https://github.com/jdunkerley/enso/issues`). Screenshots: the dock on the
      Logs tab, the filter controls.
- [ ] **Step 2: Build, read through, commit**

```bash
git add docs-site/docs/engine-logs
git commit -m "docs-site: engine logs guide"
```

### Task 21: Check, PR and the owner's review

- [ ] **Step 1: Check**

```bash
corepack pnpm exec prettier --check docs-site/docs docs-site/sidebars.ts
corepack pnpm --filter docs-site run build
corepack pnpm --filter docs-site run test:e2e
```

Expected: clean; the axe run's guide page (`docs/intro/`) passes; also run the
axe test once with `GUIDE_PAGE` pointed at `docs/local-versioning/` (edit
`e2e/pages.ts` locally, do not commit the change) to cover a page with images.
`du -sh docs-site/docs` to record the size the images add.

- [ ] **Step 2: PR**

```bash
git push -u origin docs/docs-site-guides
```

Title "User docs site: guides". Body: the pages and what each covers; the
unchecked claims list; R12's note on the upstream samples URL; "Refs #240" (the
issue is already closed); the screenshots attached via the `pr-screenshots`
branch so the owner reads the pages as they will look. Label
`CI: No changelog needed` (not published until PR 3). **Needs the owner's review
of the text**; merge on green after it. Remove the worktree and branch.

---

# PR 3: CI and deploy

Worktree (after PR 1 merges; merge after PR 2):
`git fetch origin && git worktree add C:\Repos\Enso\ide\.claude\worktrees\docs-site-deploy -b ci/docs-site-deploy origin/develop`.
Read `.github/CLAUDE.md` first; every workflow rule below is from it.

### Task 22: Route A — build the site in the engine checks

**Files:**

- Create: `.github/workflows/docs-site-build.yml`,
  `docs-site/scripts/extract-catalogues.sh`
- Modify: `.github/workflows/engine-checks-platform.yml` (a new job after
  `standard-library-api-check`), `.github/workflows/engine-changed-files.yml`
  (the `files:` list)

**Interfaces:**

- Produces: reusable workflow `docs-site-build.yml` with inputs `source`
  (`distribution` | `catalogues`) and `distribution-artifact`; artifacts
  `docs-site-catalogues` (each library's `catalogue.json` and `package.yaml`,
  under `lib/`; route A only) and `docs-site` (the built site).

- [ ] **Step 1: The extraction script**

```bash
#!/usr/bin/env bash
# docs-site/scripts/extract-catalogues.sh <built-distribution.tar> <out-dir>
# Extracts each library's catalogue.json and package.yaml from the engine build's artifact into
# <out-dir>/lib/<namespace>/<name>/<version>/, which `generate -- --lib <out-dir>/lib` reads.
set -euo pipefail
tar_file=$1
out_dir=$2
work=$(mktemp -d)
tar -xf "$tar_file" -C "$work" --wildcards \
  'built-distribution/*/lib/*/*/*/catalogue.json' \
  'built-distribution/*/lib/*/*/*/package.yaml'
lib=$(ls -d "$work"/built-distribution/*/*/lib)
mkdir -p "$out_dir"
mv "$lib" "$out_dir/lib"
rm -rf "$work"
count=$(find "$out_dir/lib" -name catalogue.json | wc -l)
echo "Extracted $count catalogues"
[ "$count" -gt 0 ]
```

Test it locally on the tar from PR 1's Task 10 recipe (download it again into
your scratch folder):
`bash docs-site/scripts/extract-catalogues.sh "$SCRATCH/dist/built-distribution.tar" "$SCRATCH/input"`
then `ls "$SCRATCH"/input/lib/Standard`. Expected: every standard library, a
`catalogue.json` in all but `Database_Test_Suite` and `Visualization`.

- [ ] **Step 2: `docs-site-build.yml`**

```yaml
# This file is not auto-generated. Feel free to edit it.

# Builds the user documentation site (`docs-site/`) and uploads it as the `docs-site` artifact,
# which is the pull request's preview and what `docs-site-deploy.yml` publishes from develop.
# It only ever downloads from its own run, so it needs no `actions: read` (see Note [Docs Site
# Catalogues] in `docs-site.yml`). Called with a matrix leg's inputs, so it has no `concurrency:`.
name: Docs Site Build

on:
  workflow_call:
    inputs:
      source:
        description: >-
          `distribution`: extract the catalogues from this run's engine distribution artifact and
          upload them as `docs-site-catalogues` (the engine checks). `catalogues`: use this run's
          `docs-site-catalogues` artifact (`docs-site.yml`).
        required: true
        type: string
      distribution-artifact:
        description: The engine distribution artifact, for `source: distribution`.
        required: false
        type: string
        default: Engine Distribution (GraalVM CE) (native,test) (linux, amd64)

permissions:
  contents: read

jobs:
  build:
    name: Build the docs site
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node
      # No Rust: the generator loads no WASM (Task 5 of the plan); only the Markdown parser fork
      # and the icon list need building.
      - name: Install dependencies
        run: corepack pnpm install --frozen-lockfile --ignore-scripts
      - name: Build the Markdown parser and the icon list
        run: |
          corepack pnpm --filter @lezer/markdown run prepare
          corepack pnpm --filter enso-gui run generate-icons
      - name: Download the engine distribution
        if: inputs.source == 'distribution'
        uses: actions/download-artifact@v5
        with:
          name: ${{ inputs.distribution-artifact }}
      - name: Extract the catalogues
        if: inputs.source == 'distribution'
        run: |
          bash docs-site/scripts/extract-catalogues.sh built-distribution.tar docs-site-input
          rm built-distribution.tar
      - name: Upload the catalogues
        if: inputs.source == 'distribution'
        uses: actions/upload-artifact@v5
        with:
          name: docs-site-catalogues
          path: docs-site-input
          if-no-files-found: error
      - name: Download the catalogues
        if: inputs.source == 'catalogues'
        uses: actions/download-artifact@v5
        with:
          name: docs-site-catalogues
          path: docs-site-input
      - name: Generate the Components reference
        run: corepack pnpm --filter docs-site run generate -- --lib "$GITHUB_WORKSPACE/docs-site-input/lib"
      - name: Build the site
        run: corepack pnpm --filter docs-site run build
      - name: Install the browser
        run: corepack pnpm --filter docs-site exec playwright install --with-deps chromium
      - name: Accessibility and keyboard tests
        run: corepack pnpm --filter docs-site run test:e2e
        env:
          DOCS_SITE_E2E_FUNCTION: docs/api/Standard.Table/Table/Table.filter/
          DOCS_SITE_E2E_TYPE: docs/api/Standard.Table/Table/Table/
      - name: Upload the site
        uses: actions/upload-artifact@v5
        with:
          name: docs-site
          path: docs-site/build
          if-no-files-found: error
```

Set `timeout-minutes` from Task 13's measurement: 30 if the generate + build +
tests took under 20 minutes, else 1.5× the measured time rounded up to 5
(`.github/CLAUDE.md`). The `generate` step uses the floor (Task 13 Step 8)
because `--lib` is given.

If `corepack pnpm --filter @lezer/markdown run prepare` is not what installs its
`dist/` (check `app/lezer-markdown/package.json`'s scripts at the time), use the
script that does; the step's purpose is to build what `--ignore-scripts`
skipped, and nothing else.

- [ ] **Step 3: The job in `engine-checks-platform.yml`**

After the `standard-library-api-check` job:

```yaml
# The user documentation site, built from this run's distribution (route A of the docs site's
# spec, section 5): a doc comment that breaks the site fails here, on the pull request that
# changes it. Linux and GraalVM CE only, once per run, and not in `extra-nightly-tests.yml`
# (which passes `linux-checks: false`).
docs-site:
  name: Docs site
  if:
    inputs.os == 'linux' && inputs.edition == 'GraalVM CE' &&
    inputs.linux-checks
  needs: [build-engine-distribution]
  uses: ./.github/workflows/docs-site-build.yml
  with:
    source: distribution
    distribution-artifact:
      Engine Distribution (${{ inputs.edition }}) (native,test) (${{ inputs.os
      }}, ${{ inputs.arch }})
```

Nesting: `engine-pull-request.yml` → `engine-checks.yml` →
`engine-checks-platform.yml` → `docs-site-build.yml` is four levels, and
`macos-pull-request.yml` → `macos-checks.yml` → `engine-checks-platform.yml`
skips the job (`os: macos`). GitHub allows that depth; if a run fails with a
nesting error, say so in the PR and move the job up into `engine-checks.yml`
(after the platform matrix, gated on the Linux leg's success) instead.

- [ ] **Step 4: The engine gate**

In `.github/workflows/engine-changed-files.yml`'s `files:`, after
`.github/workflows/engine-checks-platform.yml`, add
`.github/workflows/docs-site-build.yml` (a workflow the engine checks use:
`.github/CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docs-site-build.yml .github/workflows/engine-checks-platform.yml .github/workflows/engine-changed-files.yml docs-site/scripts/extract-catalogues.sh
git commit -m "CI: build the docs site in the engine checks"
```

### Task 23: Route B — pull requests that change only the site

**Files:**

- Create: `.github/workflows/docs-site.yml`,
  `docs-site/generator/src/workflowPaths.test.ts`

**Interfaces:**

- Consumes: `docs-site-build.yml` (Task 22); the `docs-site-catalogues` artifact
  of `develop` runs of `engine-pull-request.yml`.

- [ ] **Step 1: The path whitelist test (failing first)**

The workflow's `paths` must cover every file the generator loads from outside
`docs-site/`: the modules `gui.ts` imports, and theirs. The test resolves
`gui.ts`'s imports with the same aliases and checks each against the workflow's
globs, plus a fixed list of their own imports.

```ts
// docs-site/generator/src/workflowPaths.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ALIASES: [string, string][] = [
  ["@/", "app/gui/src/project-view/"],
  ["$/", "app/gui/src/"],
  ["enso-common/src/", "app/common/src/"],
  ["ydoc-shared/", "app/ydoc-shared/src/"],
];
/** What the modules `gui.ts` imports import in turn, outside `docs-site/` (checked by hand when gui.ts changes). */
const TRANSITIVE = [
  "app/gui/src/project-view/util/data/array.ts",
  "app/gui/src/project-view/util/data/opt.ts",
  "app/gui/src/project-view/util/assert.ts",
  "app/gui/src/project-view/util/iconMetadata/iconName.ts",
  "app/ydoc-shared/src/util/assert.ts",
  "app/common/src/utilities/data/result.ts",
  "app/common/src/utilities/data/opt.ts",
  "app/gui/src/project-view/assets/icons.svg",
  "app/gui/src/project-view/assets/base.css",
  "app/gui/scripts/generateIconMetadata.mjs",
  "app/lezer-markdown/src/index.ts",
];

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${pattern}$`);
}

test("docs-site.yml's paths cover every file the generator loads", () => {
  const workflow = parse(
    readFileSync(`${ROOT}.github/workflows/docs-site.yml`, "utf8"),
  );
  const paths = (workflow.on.pull_request.paths as string[]).map(globToRegExp);
  const gui = readFileSync(
    fileURLToPath(new URL("./gui.ts", import.meta.url)),
    "utf8",
  );
  const imported = [...gui.matchAll(/from '([^']+)'/g)].map((match) => {
    const [prefix, dir] = ALIASES.find(([alias]) =>
      match[1]!.startsWith(alias),
    )!;
    return `${dir}${match[1]!.slice(prefix.length)}.ts`;
  });
  for (const file of [...imported, ...TRANSITIVE]) {
    expect(
      paths.some((path) => path.test(file)),
      file,
    ).toBe(true);
  }
});
```

Run: `corepack pnpm --filter docs-site run test:unit` Expected: FAIL,
`docs-site.yml` does not exist.

- [ ] **Step 2: `docs-site.yml`**

```yaml
# This file is not auto-generated. Feel free to edit it.

# Note [Docs Site Catalogues]
# ===========================
# The docs site needs only each library's `catalogue.json` and `package.yaml`, which the engine
# build produces. A pull request that changes the engine or the standard library builds the site in
# its own engine checks (`engine-checks-platform.yml` › Docs site), which uploads them as
# `docs-site-catalogues`. This workflow is for pull requests that change only the site or the GUI
# code it reuses: it takes the catalogues of the newest develop run of `engine-pull-request.yml`
# whose commit is an ancestor of the pull request's merge commit (the `find-backend` pattern of
# `ide-packaging.yml`), falling back to that run's Linux distribution artifact while no develop run
# has the small one, and re-uploads them into this run, so `docs-site-build.yml` downloads only from
# its own run and the engine workflows' permissions stay as they are. A pull request that changes
# both kinds of file runs both; this one is a few minutes and harmless.
name: Docs Site

on:
  pull_request:
    # A whitelist, which leaves out `docs/superpowers/**` (`checkPullRequestsIgnoreSpecs`).
    # `docs-site/generator/src/workflowPaths.test.ts` checks it covers what the generator loads.
    paths:
      - "docs-site/**"
      - "app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts"
      - "app/gui/src/providers/openedProjects/suggestionDatabase/argument.ts"
      - "app/gui/src/providers/openedProjects/suggestionDatabase/groupInfo.ts"
      - "app/gui/src/project-view/components/ComponentHelp/metadata.ts"
      - "app/gui/src/project-view/util/colors.ts"
      - "app/gui/src/project-view/util/entryIcon.ts"
      - "app/gui/src/project-view/util/groupColors.ts"
      - "app/gui/src/project-view/util/projectPathKey.ts"
      - "app/gui/src/project-view/util/qualifiedName.ts"
      - "app/gui/src/project-view/util/assert.ts"
      - "app/gui/src/project-view/util/data/**"
      - "app/gui/src/project-view/util/iconMetadata/**"
      - "app/gui/src/project-view/assets/icons.svg"
      - "app/gui/src/project-view/assets/base.css"
      - "app/gui/scripts/generateIconMetadata.mjs"
      - "app/ydoc-shared/src/ast/ensoMarkdown.ts"
      - "app/ydoc-shared/src/ast/prerenderMarkdown.ts"
      - "app/ydoc-shared/src/languageServerTypes/suggestions.ts"
      - "app/ydoc-shared/src/util/assert.ts"
      - "app/common/src/docsSite/**"
      - "app/common/src/utilities/data/**"
      - "app/lezer-markdown/**"
      - "app/vitest.node.base.ts"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - ".github/workflows/docs-site.yml"
      - ".github/workflows/docs-site-build.yml"
      - ".github/actions/setup-node/**"
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}-docs-site
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  find-catalogues:
    name: Find develop's catalogues
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      actions: read # Download another run's artifacts
    steps:
      - uses: actions/checkout@v5
      - id: find
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          HEAD_SHA: ${{ github.sha }}
        run: |
          for artifact in docs-site-catalogues "Engine Distribution (GraalVM CE) (native,test) (linux, amd64)"; do
            candidates=$(gh api -X GET "repos/$REPO/actions/artifacts" -f name="$artifact" -f per_page=100 \
              --jq '[.artifacts[] | select(.expired | not) | select(.workflow_run.head_branch == "develop" and .workflow_run.head_repository_id == .workflow_run.repository_id)
                     | "\(.workflow_run.id) \(.workflow_run.head_sha)"] | .[:30] | .[]')
            while read -r run_id sha; do
              [ -n "$run_id" ] || continue
              path=$(gh api "repos/$REPO/actions/runs/$run_id" --jq .path) || continue
              [ "$path" = ".github/workflows/engine-pull-request.yml" ] || continue
              status=$(gh api "repos/$REPO/compare/$sha...$HEAD_SHA" --jq .status) || continue
              case "$status" in ahead|identical) ;; *) continue ;; esac
              { echo "run-id=$run_id"; echo "artifact=$artifact"; } >> "$GITHUB_OUTPUT"
              echo "Catalogues from develop run [$run_id](https://github.com/$REPO/actions/runs/$run_id) at \`$sha\` (\`$artifact\`)." >> "$GITHUB_STEP_SUMMARY"
              exit 0
            done <<< "$candidates"
          done
          echo "::error::No develop engine run whose commit is an ancestor of $HEAD_SHA has the catalogues. Merge develop into the branch."
          exit 1
      - name: Download them
        uses: actions/download-artifact@v5
        with:
          name: ${{ steps.find.outputs.artifact }}
          run-id: ${{ steps.find.outputs.run-id }}
          github-token: ${{ github.token }}
          path: downloaded
      - name: Extract the catalogues from the distribution
        if: steps.find.outputs.artifact != 'docs-site-catalogues'
        run: |
          bash docs-site/scripts/extract-catalogues.sh downloaded/built-distribution.tar docs-site-input
          rm downloaded/built-distribution.tar
      - name: Use the catalogues as they are
        if: steps.find.outputs.artifact == 'docs-site-catalogues'
        run: mv downloaded docs-site-input
      - name: Upload them into this run
        uses: actions/upload-artifact@v5
        with:
          name: docs-site-catalogues
          path: docs-site-input
          if-no-files-found: error
          retention-days: 1

  build:
    name: Docs site
    needs: [find-catalogues]
    uses: ./.github/workflows/docs-site-build.yml
    with:
      source: catalogues
```

`find-catalogues` has `actions/checkout` first because it runs the repository's
extraction script. On `workflow_dispatch` `github.sha` is the branch head, which
the compare treats the same way.

- [ ] **Step 3: Run the test and the policy**

```bash
corepack pnpm --filter docs-site run test:unit
node tools/ci/check-workflows.mjs
node --test tools/ci/*.test.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide/.claude/worktrees/docs-site-deploy && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck'
```

Expected: PASS; no policy problem (top-level `permissions:`, every job with
`timeout-minutes` or `uses:`, the `paths` whitelist leaves specs out);
actionlint clean. If the test names a file the workflow misses, add it to
`paths`; if it names one the generator does not really load, fix the test's
resolution, not the list.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/docs-site.yml docs-site/generator/src/workflowPaths.test.ts
git commit -m "CI: build the docs site on pull requests that change only the site"
```

### Task 24: Route C — deploy from `develop`

**Files:**

- Create: `.github/workflows/docs-site-deploy.yml`

- [ ] **Step 1: The workflow**

```yaml
# This file is not auto-generated. Feel free to edit it.

# Publishes the docs site that a develop run of the engine checks built (its `docs-site` artifact)
# to GitHub Pages. The site is deployed when it built, even if an unrelated engine test failed.
#
# Note [The Docs Site Deploy Is Switched On By A Variable]
# ========================================================
# GitHub Pages must be enabled (source "GitHub Actions") and the `github-pages` environment
# restricted to `develop` before a deploy can succeed; both are the repository owner's settings.
# Until the owner has done that and set the repository variable `DOCS_SITE_DEPLOY` to `true`, the
# deploy job is skipped, not failed, so merging this workflow cannot turn develop red. Nothing else
# needs Pages: pull requests only build the site.
name: Docs Site Deploy

on:
  workflow_run:
    workflows: ["✨ Engine"]
    types: [completed]
    branches: [develop]
  workflow_dispatch:
    inputs:
      run-id:
        description:
          The develop run of "✨ Engine" whose `docs-site` artifact to publish.
        required: true
        type: string

concurrency:
  group: pages
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy the docs site
    if: >-
      vars.DOCS_SITE_DEPLOY == 'true' && (github.event_name ==
      'workflow_dispatch' || (github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_repository.full_name == github.repository))
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      actions: read # Download the engine run's `docs-site` artifact
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: run
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          RUN_ID:
            ${{ github.event_name == 'workflow_dispatch' && inputs.run-id ||
            github.event.workflow_run.id }}
        run: |
          found=$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" \
            --jq '[.artifacts[] | select(.name == "docs-site" and (.expired | not))] | length')
          echo "run-id=$RUN_ID" >> "$GITHUB_OUTPUT"
          if [ "$found" -ge 1 ]; then
            echo "found=true" >> "$GITHUB_OUTPUT"
          else
            echo "found=false" >> "$GITHUB_OUTPUT"
            echo "::notice::Run $RUN_ID has no docs-site artifact (the site did not build); nothing deployed."
          fi
      - if: steps.run.outputs.found == 'true'
        uses: actions/download-artifact@v5
        with:
          name: docs-site
          run-id: ${{ steps.run.outputs.run-id }}
          github-token: ${{ github.token }}
          path: site
      - if: steps.run.outputs.found == 'true'
        uses: actions/upload-pages-artifact@v5
        with:
          path: site
      - if: steps.run.outputs.found == 'true'
        id: deployment
        uses: actions/deploy-pages@v5
```

`workflow_run` workflows start only from the default branch's copy, so this one
cannot run before it merges: the first `develop` push after merge (with the
variable set) is its test (Task 25 Step 5).

- [ ] **Step 2: Check and commit**

Run the Task 23 Step 3 commands again. Expected: clean.

```bash
git add .github/workflows/docs-site-deploy.yml
git commit -m "CI: deploy the docs site from develop to GitHub Pages"
```

### Task 25: Documentation, changelog, PR, the owner's OK, and the first deploy

**Files:**

- Modify: `.github/CLAUDE.md`, `docs-site/CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: `.github/CLAUDE.md`**

In "Layout", add a bullet: "`workflows/docs-site-build.yml`, `docs-site.yml`,
`docs-site-deploy.yml` — the user documentation site: built in the engine checks
from the run's distribution (and its catalogues uploaded as
`docs-site-catalogues`), built on pull requests that change only the site from
develop's catalogues (Note [Docs Site Catalogues]), and deployed from develop to
GitHub Pages when the `DOCS_SITE_DEPLOY` variable is `true` (Note [The Docs Site
Deploy Is Switched On By A Variable])." In "Where the build logic lives", add
rows for `engine-checks-platform.yml` › Docs site (`docs-site-build.yml`:
`generate`, `build`, `test:e2e`; set up by `setup-node`), `docs-site.yml` › Find
develop's catalogues (`gh api`; no build) and `docs-site-deploy.yml`
(`deploy-pages`). In the permissions convention, add `pages: write` and
`id-token: write` (the Pages deploy, `docs-site-deploy.yml` only).

- [ ] **Step 2: `docs-site/CLAUDE.md`**

Add a "CI" section: the three routes, the preview (download the `docs-site`
artifact of the PR's run, unzip into `docs-site/build`,
`corepack pnpm --filter docs-site run serve`), the path whitelist and its test,
and the owner's one-time Pages setup.

- [ ] **Step 3: Changelog**

Under `# Next Release` › `#### Enso IDE`, as the first item:

```md
- [A user documentation site, with guides to the IDE and a reference of every
  standard library component, drawn as the graph editor shows it, at
  https://jdunkerley.github.io/enso/.][NNN]
```

with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` added at the top of
that section's link definitions (`NNN` is this PR's number; push first to get
it, then amend in a new commit, never by amending a pushed one).

- [ ] **Step 4: PR, preview and the owner's OK**

```bash
corepack pnpm exec prettier --check .github docs-site CHANGELOG.md
git add .github/CLAUDE.md docs-site/CLAUDE.md CHANGELOG.md
git commit -m "docs-site: CI notes and changelog"
git push -u origin ci/docs-site-deploy
```

Title "User docs site: CI and Pages deploy". Body: the three routes; the
permissions (only the deploy workflow gets `pages`/`id-token`/`actions: read`;
the engine workflows are unchanged); ruling R2 and the deploy guard (ruling 1);
**owner steps before the first deploy**: (1) Settings › Pages › Source "GitHub
Actions"; (2) Settings › Environments › `github-pages` › deployment branches:
`develop` only; (3) Settings › Variables › Actions: `DOCS_SITE_DEPLOY` = `true`.
The PR's own runs prove routes A and B (this PR changes
`engine-checks-platform.yml`, so the engine checks run, and
`.github/workflows/docs-site*.yml`, so `docs-site.yml` runs; its finder falls
back to the distribution artifact, since no develop run has catalogues yet — say
which it used). Link the `docs-site` artifact of the run as the preview and ask
the owner for their OK on it. **Do not merge without it**, nor before PR 2.

- [ ] **Step 5: After merge: the first deploy**

The merge commit's `develop` run is the first with route A on `develop`; when it
finishes:

1. Check its "Docs site" job uploaded `docs-site` and `docs-site-catalogues`.
2. If the owner has done the three steps, check the "Docs Site Deploy" run: it
   deployed, and its log shows the page URL. If the variable is not set yet, the
   run is skipped; tell the owner, and after they set it, run
   `gh workflow run docs-site-deploy.yml -f run-id=<that develop run's id>` and
   check that.
3. **OQ 8, GitHub Pages half:**
   `curl -sI https://jdunkerley.github.io/enso/docs/api/Standard.Table/Table/Table.filter`
   — expected a 301 to `…/Table.filter/`; and the slashed URL serves the page.
   If not, apply Task 13 Step 5's fallback in a follow-up PR.
4. The next PR that changes only `docs-site/` uses `docs-site-catalogues` from
   develop (its summary says so).

Remove the worktree and the local branch.

---

# PR 4 (follow-up): IDE links to the site

**Waits for** #566 (which removes the help.enso.org links, including
`suggestionDocumentationUrl` and the `help.docs` menu entry) to merge, and for
the site to be live (PR 3's first deploy). Spec section 7. Visible: changelog
entry, and the owner's OK after an installer check (merge gate for features).
Re-read #566's merged diff before starting: the menu and the F1 handling below
are described as the spec has them and must be placed where #566 left the code.

Worktree:
`git worktree add C:\Repos\Enso\ide\.claude\worktrees\docs-site-links -b gui/docs-site-links origin/develop`.

### Task 26: The documentation URL, F1 and the menu entry

**Files (as of `develop` before #566; confirm after it):**

- Modify: `app/gui/src/config.ts` (`DEFAULT_CONFIG`), `app/gui/.env` (and
  `.env.testing` if #566 added URL entries there)
- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/entry.ts`
  (`suggestionDocumentationUrl`, back, built on `apiPath`)
- Modify: `app/gui/src/project-view/components/ComponentHelp.vue` (the help
  panel's button), `app/gui/src/project-view/components/GraphEditor.vue` (F1 /
  "Open documentation")
- Modify: the settings menu component #566 leaves (the settings cog's menu;
  `UserMenu.vue` before #566) and `app/common/src/text/english.json`
- Test:
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/documentationUrl.test.ts`

- [ ] **Step 1: The failing test**

```ts
// app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/documentationUrl.test.ts
import { suggestionDocumentationUrl } from "$/providers/openedProjects/suggestionDatabase/entry";
import {
  makeMethod,
  makeModuleMethod,
  makeConstructor,
  makeType,
  makeModule,
} from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import { expect, test } from "vitest";

const BASE = "https://jdunkerley.github.io/enso/docs/";

test.each([
  [
    makeMethod("Standard.Table.Table.Table.filter"),
    `${BASE}api/Standard.Table/Table/Table.filter/`,
  ],
  [
    makeModuleMethod("Standard.Base.Data.read"),
    `${BASE}api/Standard.Base/Data/read/`,
  ],
  [
    makeConstructor(
      "Standard.Base.Data.Filter_Condition.Filter_Condition.Equal",
    ),
    `${BASE}api/Standard.Base/Data/Filter_Condition/Filter_Condition.Equal/`,
  ],
  [
    makeType("Standard.Table.Table.Table"),
    `${BASE}api/Standard.Table/Table/Table/`,
  ],
  [makeModule("Standard.Table.Table"), `${BASE}api/Standard.Table/Table/`],
  [makeMethod("local.Project.Main.Foo.bar"), undefined],
])("%#", (entry, url) => {
  expect(suggestionDocumentationUrl(entry, BASE)).toBe(url);
});
```

(Check the mock helpers' names in the suggestion database's mock module with
`Grep pattern "export function make(Method|ModuleMethod|Constructor|Type|Module)\\b" path app/gui/src`
and use what exists; add an extension-method case with whatever helper builds a
method whose `definedIn` differs from its self type's module.)

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/suggestionDatabase/__tests__/documentationUrl.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

- `config.ts`: `DOCS_URL: import.meta.env.ENSO_IDE_DOCS_URL`; `.env`:
  `ENSO_IDE_DOCS_URL=https://jdunkerley.github.io/enso/docs/` (overridable like
  the other `ENSO_IDE_*` values).
- `entry.ts`:

```ts
import { apiPath, type ApiPathEntry } from "enso-common/src/docsSite/apiPath";

/** The libraries the documentation site documents. */
function isDocumentedLibrary(project: string | undefined): project is string {
  return project?.startsWith("Standard.") ?? false;
}

/** The documentation site's page for `entry`, or nothing for the user's own code. */
export function suggestionDocumentationUrl(
  entry: SuggestionEntry,
  base: string,
): string | undefined {
  const { project, path } = entry.definedIn;
  if (!isDocumentedLibrary(project)) return;
  const module = `${project}.${path ?? "Main"}`;
  const pathEntry: ApiPathEntry | undefined =
    entry.kind === SuggestionKind.Module
      ? { kind: "module", module }
      : entry.kind === SuggestionKind.Type
        ? { kind: "type", module, name: entry.name }
        : entry.kind === SuggestionKind.Constructor
          ? {
              kind: "constructor",
              module,
              name: entry.name,
              owner: entry.memberOf.key(),
            }
          : entry.kind === SuggestionKind.Method
            ? {
                kind: "method",
                module,
                name: entry.name,
                owner: entry.memberOf.key(),
              }
            : undefined;
  return pathEntry && `${base}api/${apiPath(pathEntry)}/`;
}
```

Check `memberOf`'s type and how its qualified name is spelled (it is a
`ProjectPath`; `key()` drops `Main`, which `apiPath`'s owner comparison must
match: a module function's owner must equal `module`). Write the owner as the
fully qualified name `apiPath` expects, and add a test case for a member of a
`Main` module.

- `ComponentHelp.vue` and `GraphEditor.vue`: pass `$config.DOCS_URL` (open the
  URL as they did before #566).
- The settings menu: a "Documentation" item opening `${DOCS_URL}intro/`
  (`english.json` key next to the menu's others).

- [ ] **Step 3: Tests, Playwright, changelog, PR**

Run the unit test (PASS), the GUI's `typecheck` and `lint`, and the Playwright
specs that cover the help panel and the menu. Changelog entry under
`#### Enso IDE`: "[F1 on a component, the help panel and the settings menu open
the documentation site.][NNN]". PR "IDE: links to the documentation site", with
before/after screenshots (screenshot rule), and an installer build for the
owner's check. Merge after the owner's OK.

---

## Self-review (done while planning)

- **Spec coverage.** Section 1 (content): Tasks 4, 10, 15-20. Section 2 (node,
  sections, URLs, sidebars, search, dark mode): Tasks 1, 7-12. Section 3 (the
  generator, parser reuse, `apiPath`, outputs, scale): Tasks 1-3, 5-11, 13.
  Section 4 (the package): Task 4, 14. Section 5 (routes A, B, C, policy, the
  owner's setup): Tasks 22-25. Section 6 (versioning): no task, by design (at
  the first release); the URL scheme and the single docs instance keep it
  possible (Task 4, R4), and `docs-site/CLAUDE.md` points at the spec's section.
  Section 7 (IDE links): PR 4. Section 8 (testing): unit tests in Tasks 1-3 and
  5-11, the golden page (Task 10), parity (Tasks 3, 6, 11), the smoke test (Task
  5), the real build and floor (Tasks 13, 22), accessibility (Tasks 12, 22),
  Linux (Task 13). Section 9 (delivery): the PR split above.
- **Placeholders.** The React version in Task 4 Step 1 and `NNN` in the
  changelog are values the executor fills from a command or the PR number, with
  the command given; the function-page floor is computed from Task 13's
  measurement by a stated rule.
- **Names.** `apiPath`/`memberSegment`/`ApiPathEntry` (Task 1) are used as such
  in Tasks 5, 7 and 26; `Page`, `SiteModel`, `isFunctionPage`, `buildModel`
  (Task 7) in Tasks 9-11; `nodeProps`/`nodeJsx`/`nodeColor`/`unknownIcons`
  (Task 9) in Tasks 10-11; `renderPage`/`relativeLink`/`linkerFor` (Task 10) in
  Task 11; `writeSite`/`groupsCss`/`readFallbackColour` and `buildSidebars`
  (Task 11) in Task 13; `docs-site-catalogues`/`docs-site` artifacts and the
  `source`/`distribution-artifact` inputs (Task 22) in Tasks 23-24.
