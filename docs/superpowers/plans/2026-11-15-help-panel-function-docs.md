# Help panel: function documentation (node tooltips, Copy, sections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The help panel shows a function as a compact node whose argument pills
have tooltips (type, default, widget kind, description) and expand into rows;
examples get a Copy button that pastes connected nodes into the graph; the
`## Arguments` section is no longer repeated and `## Remarks` is collapsed.

**Architecture:** Pure helpers in `ComponentHelp/` (sections, merged arguments,
example → clipboard nodes) with unit tests; a CodeMirror decoration for the Copy
button and result lines, passed to the panel's read-only `MarkdownEditor`
through its `extensions` prop; `DocsSignature.vue` gains pill tooltips and an
expanded view; `ComponentHelp.vue` wires them. The doc-section parser moves from
the docs-site generator into the GUI and the generator imports it back, so both
read docs the same way.

**Tech Stack:** Vue 3, TypeScript, CodeMirror 6, Lezer, `@floating-ui/vue`,
Vitest; the docs-site generator (vite-node, Vitest) and its React
`ComponentNode`.

**Spec:**
`docs/superpowers/specs/2026-11-15-function-documentation-style-design.md`
(sections 2 and 3; delivery item 2).

## Global Constraints

- Panel layout: compact node, a tooltip on each argument pill (type, default,
  widget kind, description), a **▸ details** toggle expanding into one row per
  argument plus the return type; **collapsed by default**; the choice persists
  across entries; `→ Type` stays under the collapsed node.
- Tooltips open on hover, on keyboard focus and on tap; Escape closes (as the
  site's `ComponentNode` does).
- `## Arguments` is removed from the editor text **only when every bullet
  matched an argument**; unmatched bullets stay visible.
- Copy: each top-level statement → one node; `name = expr` keeps its name; bare
  expressions get none; comments (incl. `# → value`) dropped; nodes stacked
  vertically; writes the Enso clipboard type plus `text/plain` without the
  result line. An example that does not parse gets **no** Copy button. The
  plain-text paste path is **not** changed.
- No `as unknown as` on third-party APIs (root `CLAUDE.md`).
- The PR is visible: a `CHANGELOG.md` entry under `#### Enso IDE`; before/after
  screenshots on the PR via the orphan `pr-screenshots` branch; it merges only
  after the owner tests it.
- Verify on Linux too (WSL, `. ~/.enso-toolchain.sh` first).

**Deviation from the spec, deliberate:** the spec names `TooltipTrigger` for the
pill tooltips. `TooltipTrigger` handles pointer enter/leave and click only, not
keyboard focus, and changing it affects every tooltip in the IDE. The panel
instead gets a small `DocsParamPill.vue` that ports the site's `Pill` behaviour
(hover, focus, tap, Escape) and positions with `@floating-ui/vue`. Mention this
in the PR body.

## File map

| File                                                                                     | Status                                                     | Responsibility                                                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/gui/src/project-view/components/ComponentHelp/sections.ts`                          | moved from `docs-site/generator/src/sections.ts`, extended | split a doc at `##` headings; argument bullets; `panelText` (drop matched Arguments, split off Remarks) |
| `…/ComponentHelp/__tests__/sections.test.ts`                                             | moved + extended                                           |                                                                                                         |
| `…/ComponentHelp/arguments.ts`                                                           | new                                                        | merged argument list (`DocArgument`) and `widgetKind`                                                   |
| `…/ComponentHelp/__tests__/arguments.test.ts`                                            | new                                                        |                                                                                                         |
| `…/ComponentHelp/examples.ts`                                                            | new                                                        | `exampleToNodes`, `exampleCodeText`                                                                     |
| `…/ComponentHelp/__tests__/examples.test.ts`                                             | new                                                        |                                                                                                         |
| `…/MarkdownEditor/codemirror/decoration/examples.ts`                                     | new                                                        | Copy button widget + `cm-exampleResult` line class, for fenced blocks under `## Examples`               |
| `…/MarkdownEditor/codemirror/decoration/__tests__/examples.test.ts`                      | new                                                        |                                                                                                         |
| `…/ComponentHelp/DocsParamPill.vue`                                                      | new                                                        | one pill with its tooltip                                                                               |
| `…/ComponentHelp/DocsSignature.vue`                                                      | modify                                                     | pills → `DocsParamPill`; ▸ details; expanded rows                                                       |
| `…/ComponentHelp/signature.ts`                                                           | modify                                                     | `Signature` carries `DocArgument[]` and `returns`                                                       |
| `…/components/ComponentHelp.vue`                                                         | modify                                                     | wire arguments, expanded setting, Copy extension, Remarks disclosure                                    |
| `…/components/GraphEditor/graphClipboard.ts`                                             | modify                                                     | export `CopiedNode`                                                                                     |
| `app/gui/src/project-view/stores/settings.ts`                                            | modify                                                     | `expandHelpArguments: false`                                                                            |
| `docs-site/generator/src/gui.ts`                                                         | modify                                                     | re-export the moved section helpers                                                                     |
| `docs-site/generator/src/pages.ts`                                                       | modify                                                     | import from `./gui`                                                                                     |
| `docs-site/generator/src/componentNode.ts`, `docs-site/src/components/ComponentNode.tsx` | modify                                                     | tooltip gains the description                                                                           |
| `ComponentHelp/CLAUDE.md`, `MarkdownEditor/CLAUDE.md`                                    | modify                                                     | new files                                                                                               |
| `.gitignore`                                                                             | modify                                                     | `.superpowers/`                                                                                         |
| `CHANGELOG.md`                                                                           | modify                                                     | entry                                                                                                   |

Commands used throughout (from the repo root):

- GUI unit tests: `corepack pnpm --filter enso-gui exec vitest run <path>`
- Generator tests: `corepack pnpm --filter docs-site exec vitest run <path>`
- GUI typecheck: `corepack pnpm --filter enso-gui run typecheck`
- Lint: `corepack pnpm --filter enso-gui run lint` and
  `corepack pnpm --filter docs-site run lint`

---

### Task 1: Move the section parser into the GUI and add `panelText`

**Files:**

- Move: `docs-site/generator/src/sections.ts` →
  `app/gui/src/project-view/components/ComponentHelp/sections.ts`
- Move: `docs-site/generator/src/sections.test.ts` →
  `app/gui/src/project-view/components/ComponentHelp/__tests__/sections.test.ts`
- Modify: `docs-site/generator/src/gui.ts`, `docs-site/generator/src/pages.ts`
- Modify: `.gitignore`

**Interfaces:**

- Produces (all from `@/components/ComponentHelp/sections`):
  - `KNOWN_SECTIONS`, `DocSections`, `splitSections(prerendered)`,
    `argumentDescriptions(sectionText, names)` — unchanged signatures.
  - `sectionRanges(prerendered: string): SectionRange[]` with
    `interface SectionRange { heading: string; from: number; to: number }`
    (`from` = start of the `##` line, `to` = start of the next `##` heading or
    end of text).
  - `panelText(prerendered: string, argumentNames: readonly string[]): { main: string; remarks: string }`.

- [ ] **Step 1: Move the files with git**

```bash
git mv docs-site/generator/src/sections.ts app/gui/src/project-view/components/ComponentHelp/sections.ts
git mv docs-site/generator/src/sections.test.ts app/gui/src/project-view/components/ComponentHelp/__tests__/sections.test.ts
```

In the moved `sections.ts`, change `import { ensoMarkdownParser } from './gui'`
to `import { ensoMarkdownParser } from 'ydoc-shared/ast/ensoMarkdown'`, and the
file comment's first line to say it is shared by the help panel and the docs
site generator. In the moved test, change the import to
`from '@/components/ComponentHelp/sections'`.

- [ ] **Step 2: Re-export from the generator's bridge**

In `docs-site/generator/src/gui.ts`, after the `metadata` export, add:

```ts
export {
  argumentDescriptions,
  KNOWN_SECTIONS,
  panelText,
  sectionRanges,
  splitSections,
  type DocSections,
} from "@/components/ComponentHelp/sections";
```

In `docs-site/generator/src/pages.ts` line 7, change `from './sections'` to
`from './gui'`.

- [ ] **Step 3: Run both suites to prove the move is neutral**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/sections.test.ts`
Expected: PASS (same tests as before the move).

Run: `corepack pnpm --filter docs-site exec vitest run` Expected: PASS,
including `workflowPaths.test.ts` (`ComponentHelp/**` is already in
`docs-site.yml`'s paths).

- [ ] **Step 4: Write failing tests for `sectionRanges` and `panelText`**

Append to `__tests__/sections.test.ts`:

````ts
const FULL = [
  "Counts the working days.",
  "",
  "## Arguments",
  "- `end`: The last day.",
  "- `holidays`: Dates to skip.",
  "",
  "## Examples",
  "### January",
  "```",
  "days = start.work_days_until end",
  "```",
  "",
  "## Remarks",
  "### Including the end date",
  "Not counted by default.",
].join("\n");

test("sectionRanges gives each ## heading and its extent", () => {
  const ranges = sectionRanges(FULL);
  expect(ranges.map((r) => r.heading)).toEqual([
    "Arguments",
    "Examples",
    "Remarks",
  ]);
  expect(FULL.slice(ranges[0]!.from, ranges[0]!.to)).toMatch(
    /^## Arguments\n[\s\S]*Dates to skip\.\n\n$/,
  );
  expect(ranges[2]!.to).toBe(FULL.length);
});

test("panelText drops a fully matched Arguments section and splits off Remarks", () => {
  const { main, remarks } = panelText(FULL, ["end", "holidays"]);
  expect(main).not.toContain("## Arguments");
  expect(main).toContain("Counts the working days.");
  expect(main).toContain("## Examples");
  expect(main).not.toContain("## Remarks");
  expect(remarks).toBe("### Including the end date\nNot counted by default.");
});

test("panelText keeps the Arguments section when a bullet matches no argument", () => {
  const { main } = panelText(FULL, ["end"]);
  expect(main).toContain("## Arguments");
  expect(main).toContain("`holidays`");
});

test("panelText without sections returns the text unchanged", () => {
  expect(panelText("Just text.", [])).toEqual({
    main: "Just text.",
    remarks: "",
  });
});
````

Add `panelText, sectionRanges` to the test's import.

- [ ] **Step 5: Run them to see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/sections.test.ts`
Expected: FAIL — `sectionRanges` / `panelText` are not exported.

- [ ] **Step 6: Implement**

In `sections.ts`, replace the heading loop of `splitSections` with a shared
`sectionRanges`, and add `panelText`:

```ts
/** A `##` section of a doc: its heading text, and where it starts (at `##`) and ends. */
export interface SectionRange {
  heading: string;
  from: number;
  to: number;
}

/** The `##` sections of prerendered Markdown, each up to the next `##` heading or the end. */
export function sectionRanges(prerendered: string): SectionRange[] {
  const headings = children(
    ensoMarkdownParser.parse(prerendered).topNode,
  ).filter((block) => block.name === "ATXHeading2");
  return headings.map((block, i) => ({
    heading: prerendered
      .slice(block.from, block.to)
      .replace(/^##\s*/, "")
      .trim(),
    from: block.from,
    to: headings[i + 1]?.from ?? prerendered.length,
  }));
}
```

`splitSections` keeps its behaviour, rewritten over `sectionRanges` (the body
still starts after a `YAMLFrontMatter` block):

```ts
export function splitSections(prerendered: string): DocSections {
  const front = children(ensoMarkdownParser.parse(prerendered).topNode).find(
    (block) => block.name === "YAMLFrontMatter",
  );
  const ranges = sectionRanges(prerendered);
  const body = prerendered
    .slice(front?.to ?? 0, ranges[0]?.from ?? prerendered.length)
    .trim();
  const sections = ranges.map(({ heading, from, to }) => ({
    heading,
    text: prerendered
      .slice(prerendered.indexOf("\n", from) + 1 || to, to)
      .trim(),
  }));
  return { body, sections };
}
```

(The section text starts after the heading's line; for a heading on the last
line `indexOf` is −1 and `|| to` gives an empty text, as before.)

```ts
/**
 * The help panel's text: the doc without its `## Arguments` section when every bullet in it
 * matched one of `argumentNames` (the node shows them), and without `## Remarks`, which is
 * returned apart (its body, without the heading) for the panel to show collapsed.
 */
export function panelText(
  prerendered: string,
  argumentNames: readonly string[],
): { main: string; remarks: string } {
  let main = prerendered;
  let remarks = "";
  // From the end, so that earlier offsets stay valid as later sections are cut.
  for (const range of sectionRanges(prerendered).reverse()) {
    const sectionText = prerendered.slice(range.from, range.to);
    const bodyText = sectionText.slice(sectionText.indexOf("\n") + 1).trim();
    if (range.heading === "Remarks") {
      remarks = bodyText;
      main = main.slice(0, range.from) + main.slice(range.to);
    } else if (
      range.heading === "Arguments" &&
      argumentDescriptions(bodyText, argumentNames).unmatched.length === 0
    ) {
      main = main.slice(0, range.from) + main.slice(range.to);
    }
  }
  return { main: main.trimEnd(), remarks };
}
```

- [ ] **Step 7: Run all section and generator tests**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/sections.test.ts`
Expected: PASS (old and new).

Run: `corepack pnpm --filter docs-site exec vitest run` Expected: PASS (the
generator's page snapshots are unchanged, proving `splitSections` kept its
behaviour).

- [ ] **Step 8: Ignore the brainstorm mockups and commit**

Append `.superpowers/` to `.gitignore` (under a `# Brainstorming mockups`
comment).

```bash
git add -A app/gui/src/project-view/components/ComponentHelp docs-site/generator/src .gitignore
git commit -m "Help panel: the doc-section parser moves into the GUI; panelText

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Merged arguments and the widget kind

**Files:**

- Create: `app/gui/src/project-view/components/ComponentHelp/arguments.ts`
- Test:
  `app/gui/src/project-view/components/ComponentHelp/__tests__/arguments.test.ts`

**Interfaces:**

- Consumes: `argumentDescriptions`, `splitSections` (Task 1);
  `isRequiredArgument` from
  `$/providers/openedProjects/suggestionDatabase/argument`;
  `CallableSuggestionEntry` (`entry.arguments`, `entry.annotations: string[]` —
  the names of arguments that have an `@` annotation, `entry.documentation`).
- Produces (and `unqualifiedType`, moved here):

```ts
export type WidgetKind =
  "dropdown" | "checkbox" | "number" | "text" | "custom" | "type";
export interface DocArgument {
  name: string;
  /** Unqualified, `~` before a suspended argument's type. */
  type: string;
  /** The engine's rendering of the default, if any. */
  default: string | undefined;
  optional: boolean;
  widget: WidgetKind;
  /** True when no `@` annotation chose the widget: it is what the type gives. */
  widgetInferred: boolean;
  /** Markdown from the `## Arguments` bullet; '' when undocumented. */
  description: string;
}
export function widgetKind(
  arg: SuggestionEntryArgument,
  annotated: boolean,
): WidgetKind;
export function docArguments(entry: CallableSuggestionEntry): DocArgument[];
export const WIDGET_LABELS: Record<WidgetKind, string>;
```

Widget rule (spec §2, settled here): the engine builds `@` widgets at run time,
so the panel cannot name them statically. Rules, in order:

1. `tagValues` non-empty → `dropdown` (inferred unless annotated);
2. annotated → `custom`;
3. type without `| Nothing`: `Boolean` → `checkbox`; `Integer`, `Float`,
   `Number` → `number`; `Text` → `text`;
4. otherwise → `type` (the type's own default widget, if it has one).

Labels: dropdown "dropdown", checkbox "checkbox", number "number", text "text
input", custom "custom widget", type "type's widget". The hand assessment in the
Date PR is the authority on whether a widget actually works.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  makeArgument,
  makeModuleMethod,
} from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import { docArguments, widgetKind } from "@/components/ComponentHelp/arguments";
import { expect, test } from "vitest";

const DOC = [
  "Counts the working days.",
  "",
  "## Arguments",
  "- `end`: The last day.",
  "- `include_end_date`: Count `end` too.",
].join("\n");

test("docArguments merges types and defaults from code with descriptions from the doc", () => {
  const entry = makeModuleMethod(
    "Standard.Base.Data.Time.Date.work_days_until",
    {
      args: [
        makeArgument("self", "Standard.Base.Data.Time.Date.Date"),
        makeArgument("end", "Standard.Base.Data.Time.Date.Date"),
        {
          ...makeArgument("holidays", "Standard.Base.Data.Vector.Vector"),
          hasDefault: true,
          defaultValue: "[]",
        },
        {
          ...makeArgument(
            "include_end_date",
            "Standard.Base.Data.Boolean.Boolean",
          ),
          hasDefault: true,
          defaultValue: "False",
        },
      ],
    },
  );
  entry.documentation = DOC;
  const args = docArguments(entry);
  expect(args.map((a) => a.name)).toEqual([
    "end",
    "holidays",
    "include_end_date",
  ]);
  expect(args[0]).toMatchObject({
    type: "Date",
    default: undefined,
    optional: false,
    description: "The last day.",
    widget: "type",
    widgetInferred: true,
  });
  expect(args[1]).toMatchObject({
    type: "Vector",
    default: "[]",
    optional: true,
    description: "",
  });
  expect(args[2]).toMatchObject({
    widget: "checkbox",
    description: "Count `end` too.",
  });
});

test("widgetKind: tag values make a dropdown, an annotation a custom widget", () => {
  const period = {
    ...makeArgument(
      "period",
      "Standard.Base.Data.Time.Date_Period.Date_Period",
    ),
    tagValues: ["..Day"],
  };
  expect(widgetKind(period, false)).toBe("dropdown");
  expect(
    widgetKind(makeArgument("format", "Standard.Base.Data.Text.Text"), true),
  ).toBe("custom");
  expect(
    widgetKind(makeArgument("n", "Standard.Base.Data.Numbers.Integer"), false),
  ).toBe("number");
  expect(
    widgetKind(
      makeArgument(
        "s",
        "Standard.Base.Data.Text.Text | Standard.Base.Nothing.Nothing",
      ),
      false,
    ),
  ).toBe("text");
});
```

Before writing these, open
`app/gui/src/providers/openedProjects/suggestionDatabase/mockSuggestion.ts` and
check `makeModuleMethod`'s options and whether `documentation` is assignable;
adjust the test's construction (not its expectations) to fit.

- [ ] **Step 2: Run to see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/arguments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `arguments.ts`**

```ts
import { isRequiredArgument } from "$/providers/openedProjects/suggestionDatabase/argument";
import type { CallableSuggestionEntry } from "$/providers/openedProjects/suggestionDatabase/entry";
import {
  argumentDescriptions,
  splitSections,
} from "@/components/ComponentHelp/sections";
import type { SuggestionEntryArgument } from "ydoc-shared/languageServerTypes/suggestions";

// `QUALIFIED_NAME` and `unqualifiedType` move here from `signature.ts` (cut them there, and
// re-export: `export { unqualifiedType } from '@/components/ComponentHelp/arguments'`), because
// `signature.ts` will import this module in Task 5.

/** …(the WidgetKind / DocArgument declarations from Interfaces, with doc comments)… */

export const WIDGET_LABELS: Record<WidgetKind, string> = {
  dropdown: "dropdown",
  checkbox: "checkbox",
  number: "number",
  text: "text input",
  custom: "custom widget",
  type: "type's widget",
};

const NUMBER_TYPES = new Set(["Integer", "Float", "Number"]);

/** The widget an argument gets, as far as the panel can tell without the engine (see plan). */
export function widgetKind(
  arg: SuggestionEntryArgument,
  annotated: boolean,
): WidgetKind {
  if (arg.tagValues?.length) return "dropdown";
  if (annotated) return "custom";
  const type = unqualifiedType(arg.reprType)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "Nothing");
  if (type.length !== 1) return "type";
  if (type[0] === "Boolean") return "checkbox";
  if (NUMBER_TYPES.has(type[0]!)) return "number";
  if (type[0] === "Text") return "text";
  return "type";
}

/** The arguments of a callable but `self`, each with what the code and the doc say about it. */
export function docArguments(entry: CallableSuggestionEntry): DocArgument[] {
  const args = entry.arguments.filter((arg) => arg.name !== "self");
  const argumentsSection = splitSections(
    entry.documentation ?? "",
  ).sections.find((s) => s.heading === "Arguments");
  const { byName } = argumentDescriptions(
    argumentsSection?.text ?? "",
    args.map((arg) => arg.name),
  );
  return args.map((arg) => {
    const annotated = entry.annotations.includes(arg.name);
    return {
      name: arg.name,
      type: (arg.isSuspended ? "~" : "") + unqualifiedType(arg.reprType),
      default:
        arg.hasDefault && arg.defaultValue != null
          ? arg.defaultValue
          : undefined,
      optional: arg.hasDefault && !isRequiredArgument(arg),
      widget: widgetKind(arg, annotated),
      widgetInferred: !annotated,
      description: byName.get(arg.name) ?? "",
    };
  });
}
```

Check `entry.documentation`'s name and type in `suggestionDatabase/entry.ts`; if
the entry stores parsed docs differently, take the same string `ir.ts` passes to
the panel (`docs.documentation`).

- [ ] **Step 4: Run tests**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/arguments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/ComponentHelp/arguments.ts app/gui/src/project-view/components/ComponentHelp/__tests__/arguments.test.ts
git commit -m "Help panel: arguments merged from the signature and the doc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: An example → clipboard nodes

**Files:**

- Create: `app/gui/src/project-view/components/ComponentHelp/examples.ts`
- Test:
  `app/gui/src/project-view/components/ComponentHelp/__tests__/examples.test.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor/graphClipboard.ts`
  (add `export` to `interface CopiedNode`, and replace the two `TODO: Add docs`
  comments on `clipboardNodeData` / `nodesToClipboardData` with real ones while
  there)

**Interfaces:**

- Consumes: `Ast.parseBlock`, `Ast.Assignment`, `Ast.ExpressionStatement`,
  `Ast.Invalid`, `Ast.visitRecursive` (from `ydoc-shared/ast`, as `aiNode.ts`
  imports `Ast`); the **type** `CopiedNode` from
  `@/components/GraphEditor/graphClipboard`. `examples.ts` must have no value
  imports beyond `ydoc-shared`: the docs-site generator imports it (the Date
  PR's style check), and graph-editor modules do not load there. Hence a local
  `NODE_STEP` rather than `DEFAULT_NODE_SIZE`, and the clipboard write lives in
  `ComponentHelp.vue` (Task 6), not here.
- Produces:

```ts
/** A trailing `# → value` line. */
export const RESULT_LINE: RegExp; // /^\s*#\s*→/
/** The example without its result line(s), trimmed. */
export function exampleCodeText(code: string): string;
/** The nodes of an example, or undefined if it does not parse or has no statement. */
export function exampleToNodes(code: string): CopiedNode[] | undefined;
```

- [ ] **Step 1: Write the failing tests**

```ts
import {
  exampleCodeText,
  exampleToNodes,
} from "@/components/ComponentHelp/examples";
import { expect, test } from "vitest";

const EXAMPLE = [
  "start = Date.new 2020 1 1",
  "end = Date.new 2020 2 1",
  "start.work_days_until end",
  "# → 23",
].join("\n");

test("each statement becomes a node; assignments keep their names", () => {
  const nodes = exampleToNodes(EXAMPLE)!;
  expect(
    nodes.map(({ binding, expression }) => ({ binding, expression })),
  ).toEqual([
    { binding: "start", expression: "Date.new 2020 1 1" },
    { binding: "end", expression: "Date.new 2020 2 1" },
    { binding: undefined, expression: "start.work_days_until end" },
  ]);
});

test("nodes are stacked downwards, one under the other", () => {
  const ys = exampleToNodes(EXAMPLE)!.map((n) => n.metadata!.position!.y);
  expect(ys[0]).toBe(0);
  expect(ys[1]).toBeGreaterThan(ys[0]!);
  expect(ys[2]).toBeGreaterThan(ys[1]!);
});

test("comments and the result line are not nodes", () => {
  expect(exampleToNodes("# a note\nx = 1\n# → 1")).toHaveLength(1);
});

test("an example that does not parse, or is empty, gives no nodes", () => {
  expect(exampleToNodes("x = = 1")).toBeUndefined();
  expect(exampleToNodes("# only a comment")).toBeUndefined();
});

test("the text drops the result line", () => {
  expect(exampleCodeText(EXAMPLE)).toBe(
    EXAMPLE.split("\n").slice(0, 3).join("\n"),
  );
});
```

- [ ] **Step 2: Run to see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/examples.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `examples.ts`**

```ts
import type { CopiedNode } from "@/components/GraphEditor/graphClipboard";
import { Ast } from "ydoc-shared/ast";

/** A `# → value` line: an example's stated result, shown but never pasted. */
export const RESULT_LINE = /^\s*#\s*→/;

/**
 * Vertical distance between the pasted nodes of an example: `DEFAULT_NODE_SIZE.y` (32, in
 * `ComponentBrowser/placement.ts`) plus a gap. Not imported, to keep this module loadable by the
 * docs-site generator.
 */
const NODE_STEP = 56;

/** The example's code without its result line(s). */
export function exampleCodeText(code: string): string {
  return code
    .split("\n")
    .filter((line) => !RESULT_LINE.test(line))
    .join("\n")
    .trim();
}

function hasInvalid(ast: Ast.Ast): boolean {
  let invalid = false;
  Ast.visitRecursive(ast, (node) => {
    if (node instanceof Ast.Invalid) invalid = true;
    return !invalid;
  });
  return invalid;
}

/**
 * The nodes an example pastes as: each top-level statement one node, an assignment keeping its
 * name, stacked downwards. Undefined when the example does not parse or has no statement, so the
 * panel shows no Copy button for it.
 */
export function exampleToNodes(code: string): CopiedNode[] | undefined {
  const block = Ast.parseBlock(exampleCodeText(code));
  if (hasInvalid(block)) return undefined;
  const nodes: CopiedNode[] = [];
  for (const statement of block.statements()) {
    const position = { x: 0, y: nodes.length * NODE_STEP };
    if (statement instanceof Ast.Assignment) {
      nodes.push({
        binding: statement.pattern.code(),
        expression: statement.expression.code(),
        metadata: { position },
      });
    } else if (statement instanceof Ast.ExpressionStatement) {
      nodes.push({
        expression: statement.expression.code(),
        metadata: { position },
      });
    } else {
      return undefined;
    }
  }
  return nodes.length ? nodes : undefined;
}
```

Check before relying on them: `Ast.visitRecursive`'s callback contract (does
returning `false` stop descent?), the import path other GUI files use for `Ast`
(`grep -rn "import { Ast }" app/gui/src/project-view | head -3`), and
`CopiedNode.metadata`'s type (`NodeMetadataFields`: if `position` needs more
fields, supply them). Whether the scene's y grows downwards is checked by hand
in Task 6, Step 6; if pasted nodes come out upwards, negate `y` and flip the
test's expectations.

- [ ] **Step 4: Run tests**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/examples.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/ComponentHelp/examples.ts app/gui/src/project-view/components/ComponentHelp/__tests__/examples.test.ts app/gui/src/project-view/components/GraphEditor/graphClipboard.ts
git commit -m "Help panel: an example's code as clipboard nodes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Copy button and result lines in the editor

**Files:**

- Create:
  `app/gui/src/project-view/components/MarkdownEditor/codemirror/decoration/examples.ts`
- Test:
  `app/gui/src/project-view/components/MarkdownEditor/codemirror/decoration/__tests__/examples.test.ts`
  (check the existing test folder name first:
  `ls app/gui/src/project-view/components/MarkdownEditor/__tests__ app/gui/src/project-view/components/MarkdownEditor/codemirror/decoration`;
  put it beside the existing decoration tests)
- Modify:
  `app/gui/src/project-view/components/MarkdownEditor/MarkdownEditorImpl.vue`
  (styles for `.cm-exampleCopy` and `.cm-exampleResult`)

**Interfaces:**

- Consumes: `exampleToNodes`, `RESULT_LINE` (Task 3); `syntaxTree`.
- Produces:

```ts
/** The fenced code blocks under a `## Examples` heading: where each starts and its code. */
export function exampleBlocks(
  state: EditorState,
): { from: number; code: string }[];
/** The Copy buttons and result-line classes, for a read-only editor. */
export function exampleDecoratorExt(onCopy: (code: string) => void): Extension;
```

- [ ] **Step 1: Write the failing tests**

````ts
import {
  exampleBlocks,
  exampleDecoratorExt,
} from "@/components/MarkdownEditor/codemirror/decoration/examples";
import { ensoMarkdown } from "@/components/MarkdownEditor/markdown"; // see note
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";

const DOC = [
  "Intro.",
  "```",
  "not = an example",
  "```",
  "## Examples",
  "### One",
  "```",
  "x = 1",
  "# → 1",
  "```",
  "## Remarks",
  "```",
  "also = not an example",
  "```",
].join("\n");

const state = () =>
  EditorState.create({ doc: DOC, extensions: [ensoMarkdown()] });

test("only fenced blocks under ## Examples are examples", () => {
  const blocks = exampleBlocks(state());
  expect(blocks.map((b) => b.code)).toEqual(["x = 1\n# → 1"]);
});

test("a Copy button per example, which copies that example", () => {
  const copied: string[] = [];
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [ensoMarkdown(), exampleDecoratorExt((c) => copied.push(c))],
    }),
  });
  const buttons = view.dom.querySelectorAll(".cm-exampleCopy");
  expect(buttons).toHaveLength(1);
  (buttons[0] as HTMLButtonElement).click();
  expect(copied).toEqual(["x = 1\n# → 1"]);
  expect(view.dom.querySelectorAll(".cm-exampleResult")).toHaveLength(1);
  view.destroy();
});
````

Note: find the Markdown language extension the editor uses
(`grep -n "markdown(" app/gui/src/project-view/components/MarkdownEditor/MarkdownEditorImpl.vue app/gui/src/project-view/components/MarkdownEditor/codemirror/index.ts`)
and import that instead of `ensoMarkdown` if it is named differently. Check how
the existing decoration tests build their state and copy that.

- [ ] **Step 2: Run to see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/MarkdownEditor/codemirror/decoration/__tests__/examples.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `decoration/examples.ts`**

```ts
import {
  exampleToNodes,
  RESULT_LINE,
} from "@/components/ComponentHelp/examples";
import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

/** The fenced code blocks under a `## Examples` heading (until the next `##`). */
export function exampleBlocks(
  state: EditorState,
): { from: number; code: string }[] {
  const blocks: { from: number; code: string }[] = [];
  let inExamples = false;
  for (
    let node = syntaxTree(state).topNode.firstChild;
    node;
    node = node.nextSibling
  ) {
    if (node.name === "ATXHeading2") {
      inExamples = /^##\s*Examples\s*$/.test(
        state.sliceDoc(node.from, node.to),
      );
    } else if (inExamples && node.name === "FencedCode") {
      const text = node.getChild("CodeText");
      if (text)
        blocks.push({
          from: node.from,
          code: state.sliceDoc(text.from, text.to),
        });
    }
  }
  return blocks;
}

class CopyWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly onCopy: (code: string) => void,
  ) {
    super();
  }
  override eq(other: CopyWidget) {
    return other.code === this.code;
  }
  override toDOM() {
    const button = document.createElement("button");
    button.className = "cm-exampleCopy";
    button.type = "button";
    button.textContent = "Copy";
    button.title = "Copy as nodes, to paste into the graph";
    button.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's selection
    button.addEventListener("click", () => {
      this.onCopy(this.code);
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    return button;
  }
  override ignoreEvent() {
    return true;
  }
}

function decorations(
  state: EditorState,
  onCopy: (code: string) => void,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const block of exampleBlocks(state)) {
    if (exampleToNodes(block.code)) {
      ranges.push(
        Decoration.widget({
          widget: new CopyWidget(block.code, onCopy),
          side: 1,
        }).range(block.from),
      );
    }
    const first = state.doc.lineAt(block.from).number;
    const last = state.doc.lineAt(block.from + block.code.length + 4).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (RESULT_LINE.test(line.text))
        ranges.push(
          Decoration.line({ class: "cm-exampleResult" }).range(line.from),
        );
    }
  }
  return Decoration.set(ranges, true);
}

/** Copy buttons on the examples, and the muted style of their `# → value` lines. */
export function exampleDecoratorExt(onCopy: (code: string) => void): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorations(state, onCopy),
    update: (prev, tr) =>
      tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)
        ? decorations(tr.state, onCopy)
        : prev,
    provide: (f) => EditorView.decorations.from(f),
  });
}
```

(The `last` line bound is loose on purpose — the fence lines can't match
`RESULT_LINE`; simplify to the FencedCode node's `to` by returning `to` from
`exampleBlocks` if you prefer, and update the interface.)

- [ ] **Step 4: Styles**

In `MarkdownEditorImpl.vue`'s styles, beside the `cm-codeBlock` rules:

```css
:deep(.cm-codeBlock-first) {
  position: relative;
}
:deep(.cm-exampleCopy) {
  position: absolute;
  top: 4px;
  right: 6px;
  padding: 1px 8px;
  border: 1px solid rgb(255 255 255 / 0.2);
  border-radius: 4px;
  background: rgb(255 255 255 / 0.1);
  color: #fff;
  font: 11px var(--font-sans, system-ui);
  cursor: pointer;
}
:deep(.cm-exampleCopy:hover) {
  background: rgb(255 255 255 / 0.2);
}
:deep(.cm-exampleResult) {
  color: #676e95;
  font-style: italic;
}
```

Follow the file's existing selector style (`:deep` or not) for `cm-codeBlock`.

- [ ] **Step 5: Run tests**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/MarkdownEditor`
Expected: PASS, the existing MarkdownEditor tests included.

- [ ] **Step 6: Commit**

```bash
git add app/gui/src/project-view/components/MarkdownEditor
git commit -m "Markdown editor: Copy buttons and result lines on examples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The node — pill tooltips and the expanded view

**Files:**

- Create: `app/gui/src/project-view/components/ComponentHelp/DocsParamPill.vue`
- Modify: `app/gui/src/project-view/components/ComponentHelp/signature.ts`,
  `DocsSignature.vue`, `__tests__/signature.test.ts`
- Test:
  `app/gui/src/project-view/components/ComponentHelp/__tests__/DocsSignature.test.ts`

**Interfaces:**

- Consumes: `DocArgument`, `WIDGET_LABELS` (Task 2).
- Produces:
  - `Signature` becomes
    `{ name: string; params: DocArgument[]; returns: string; label: string }`
    and `entrySignature(entry, returnType)` builds `params` with
    `docArguments(entry)`. `SignatureParam` is removed; update its tests to the
    new shape (`detail` assertions become `type`/`default` assertions; the label
    text is unchanged: `name: Type = default`).
  - `DocsSignature.vue` props:
    `{ signature: Signature; icon: Icon; color: string; expanded: boolean }`,
    emits `'update:expanded': [boolean]`.
  - `DocsParamPill.vue` props: `{ param: DocArgument }`.

- [ ] **Step 1: Update `signature.ts` and its test (test first)**

Change `signature.test.ts`'s first test to expect
`signature.params.map(p => ({ name: p.name, type: p.type, default: p.default, optional: p.optional }))`
for the `read` example (`path`: `Text`, default `Missing_Argument.throw "path"`,
optional false; `format`: `File_Format`, `Auto_Detect`, optional true; `action`:
`~Any`, …), and `signature.returns` to be `'Any'`. Run it; it fails. Then:

```ts
import {
  docArguments,
  type DocArgument,
} from "@/components/ComponentHelp/arguments";
import type { CallableSuggestionEntry } from "$/providers/openedProjects/suggestionDatabase/entry";

export interface Signature {
  name: string;
  params: DocArgument[];
  /** The unqualified return type. */
  returns: string;
  /** The whole signature in text, for screen readers. */
  label: string;
}

export function entrySignature(
  entry: CallableSuggestionEntry,
  returnType: string,
): Signature {
  const params = docArguments(entry);
  const returns = unqualifiedType(returnType);
  const detail = (p: DocArgument) =>
    p.default != null ? `${p.type} = ${p.default}` : p.type;
  return {
    name: entry.name,
    params,
    returns,
    label: `${entry.name}(${params.map((p) => `${p.name}: ${detail(p)}`).join(", ")}) -> ${returns}`,
  };
}
```

(`unqualifiedType` already lives in `arguments.ts` since Task 2, re-exported
from `signature.ts`, so there is no import cycle.)

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp`
Expected: PASS.

- [ ] **Step 2: Write the failing component test**

```ts
import DocsSignature from "@/components/ComponentHelp/DocsSignature.vue";
import type { Signature } from "@/components/ComponentHelp/signature";
import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";

const SIGNATURE: Signature = {
  name: "work_days_until",
  returns: "Integer",
  label: "work_days_until(end: Date) -> Integer",
  params: [
    {
      name: "end",
      type: "Date",
      default: undefined,
      optional: false,
      widget: "type",
      widgetInferred: true,
      description: "The last day.",
    },
    {
      name: "include_end_date",
      type: "Boolean",
      default: "False",
      optional: true,
      widget: "checkbox",
      widgetInferred: true,
      description: "Count it too.",
    },
  ],
};

const mountIt = (expanded: boolean) =>
  mount(DocsSignature, {
    props: { signature: SIGNATURE, icon: "calendar", color: "red", expanded },
    attachTo: document.body,
  });

test("collapsed: a pill per argument; focus shows its tooltip, Escape hides it", async () => {
  const w = mountIt(false);
  const pills = w.findAll(".param");
  expect(pills.map((p) => p.text())).toEqual(["end", "include_end_date"]);
  await pills[1]!.trigger("focus");
  const tip = document.body.querySelector(".DocsParamPill-tooltip");
  expect(tip?.textContent).toContain("Boolean");
  expect(tip?.textContent).toContain("= False");
  expect(tip?.textContent).toContain("checkbox");
  expect(tip?.textContent).toContain("Count it too.");
  await pills[1]!.trigger("keydown", { key: "Escape" });
  expect(document.body.querySelector(".DocsParamPill-tooltip")).toBeNull();
  w.unmount();
});

test("the toggle asks to expand; expanded shows a row per argument and the return type", async () => {
  const w = mountIt(false);
  await w.find(".toggle").trigger("click");
  expect(w.emitted("update:expanded")).toEqual([[true]]);
  const open = mountIt(true);
  expect(open.findAll(".param")).toHaveLength(0);
  expect(open.findAll(".row .argName").map((r) => r.text())).toEqual([
    "end",
    "include_end_date",
  ]);
  expect(open.find(".returnsRow").text()).toContain("Integer");
  w.unmount();
  open.unmount();
});
```

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp/__tests__/DocsSignature.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `DocsParamPill.vue`**

Port the behaviour of `docs-site/src/components/ComponentNode.tsx`'s `Pill`
(read it first): the pill is a `<button type="button" class="param">`
(`.optional` when optional); the tooltip opens while hovered (mouse pointer
only), focused, or pinned by a tap/click/Enter/Space (toggle, using the state at
pointer-down as the site does); a pointer-down outside unpins; Escape dismisses
until the next hover/focus. The tooltip is teleported to `body` and placed with
`useFloating(reference, floating, { placement: 'bottom-start', middleware: [offset(6), flip(), shift({ padding: 8 })], whileElementsMounted: autoUpdate })`
from `@floating-ui/vue`, with class `DocsParamPill-tooltip`, `role="tooltip"`,
and the button's `aria-describedby` pointing at it. Content:

```vue
<div class="meta">
  <code class="type" v-text="param.type" />
  <span v-if="param.default != null" class="default" v-text="`= ${param.default}`" />
  <span class="widget" :class="{ inferred: param.widgetInferred }" v-text="WIDGET_LABELS[param.widget]" />
</div>
<div v-if="param.description" class="description" v-text="param.description" />
```

The description is plain text here (its inline code shows with backticks);
rendering its Markdown inline is not worth a second editor per tooltip. Styles
from the mockup (`.superpowers/brainstorm/*/content/panel-layout-v2.html`):
white card, `1px solid var(--docs-table-border)`, radius 8px, shadow
`0 4px 14px #0002`, padding `7px 9px`, font `var(--docs-font-size)`; `.type`
uses the `--docs-code-*` tokens; `.widget` a dashed 1px border, 10.5px;
`.inferred` adds `opacity: 0.8`.

- [ ] **Step 4: Rewrite `DocsSignature.vue`**

```vue
<script setup lang="ts">
import DocsParamPill from "@/components/ComponentHelp/DocsParamPill.vue";
import { WIDGET_LABELS } from "@/components/ComponentHelp/arguments";
import type { Signature } from "@/components/ComponentHelp/signature";
import SvgIcon from "@/components/SvgIcon.vue";
import type { Icon } from "@/util/iconMetadata/iconName";

const { signature, icon, color, expanded } = defineProps<{
  signature: Signature;
  icon: Icon;
  color: string;
  expanded: boolean;
}>();
const emit = defineEmits<{ "update:expanded": [value: boolean] }>();
</script>

<template>
  <div
    class="DocsSignature"
    role="group"
    :aria-label="signature.label"
    :style="{ backgroundColor: color }"
  >
    <div class="head">
      <SvgIcon :name="icon" class="icon" />
      <span class="name" v-text="signature.name" />
      <template v-if="!expanded">
        <DocsParamPill
          v-for="param in signature.params"
          :key="param.name"
          :param="param"
        />
      </template>
      <button
        v-if="signature.params.length > 0"
        type="button"
        class="toggle"
        :aria-expanded="expanded"
        @click="emit('update:expanded', !expanded)"
        v-text="expanded ? '▾ hide' : '▸ details'"
      />
    </div>
    <div v-if="expanded" class="rows">
      <div v-for="param in signature.params" :key="param.name" class="row">
        <span
          class="argName"
          :class="{ optional: param.optional }"
          v-text="param.name"
        />
        <span class="argDetail">
          <span class="meta">
            <code class="type" v-text="param.type" />
            <span
              v-if="param.default != null"
              class="default"
              v-text="`= ${param.default}`"
            />
            <span
              class="widget"
              :class="{ inferred: param.widgetInferred }"
              v-text="WIDGET_LABELS[param.widget]"
            />
          </span>
          <span
            v-if="param.description"
            class="description"
            v-text="param.description"
          />
        </span>
      </div>
      <div class="returnsRow">
        → <code class="type" v-text="signature.returns" />
      </div>
    </div>
  </div>
  <div v-if="!expanded" class="returnsLine">→ {{ signature.returns }}</div>
</template>
```

Keep the existing `.DocsSignature`, `.icon`, `.name` styles, but make
`.DocsSignature` a block (`display: block`; `.head` takes the old
inline-flex/wrap rules, so the collapsed node looks as today). `.rows`:
`display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; margin: 0 6px 6px; background: #0002; border-radius: 10px; padding: 8px 9px; font-size: 11.5px; line-height: 1.45;`;
`.argName` 600 weight, `.optional` italic 500; `.type` white background in rows;
`.returnsRow` spans both columns with a top border `1px solid #fff3`. `.toggle`:
no border/background, `color: inherit`, `margin-left: auto`, 11px, opacity 0.85,
`cursor: pointer`. `.returnsLine`: `color: #666`, 11px, `margin: 4px 0 0 4px`. A
collapsed node shrinks to its content (as today) —
`.DocsSignature { width: fit-content; max-width: 100% }` collapsed, full width
expanded (`:class="{ expanded }"`).

- [ ] **Step 5: Run tests and typecheck**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentHelp`
Expected: PASS.

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: no errors
(ComponentHelp.vue does not yet pass `expanded`: if the typecheck flags it, add
`:expanded="false"` temporarily — Task 6 replaces it).

- [ ] **Step 6: Commit**

```bash
git add app/gui/src/project-view/components/ComponentHelp
git commit -m "Help panel: argument tooltips and the expanded node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the panel

**Files:**

- Modify: `app/gui/src/project-view/components/ComponentHelp.vue`
- Modify: `app/gui/src/project-view/stores/settings.ts`

**Interfaces:**

- Consumes: `panelText` (Task 1), `exampleToNodes`, `exampleCodeText` (Task 3),
  `clipboardNodeData`, `exampleDecoratorExt` (Task 4), `DocsSignature` with
  `expanded` (Task 5), `useSettings`
  (`settings.user.value.expandHelpArguments`), `writeClipboard`.

- [ ] **Step 1: The setting**

In `stores/settings.ts` add to `UserSettings`:

```ts
/** Whether the help panel shows a function's node expanded, one row per argument. */
expandHelpArguments: boolean;
```

and `expandHelpArguments: false` to `defaultUserSettings`.

- [ ] **Step 2: The panel's text, Remarks and Copy**

In `ComponentHelp.vue`:

```ts
import {
  exampleCodeText,
  exampleToNodes,
} from "@/components/ComponentHelp/examples";
import { panelText } from "@/components/ComponentHelp/sections";
import { exampleDecoratorExt } from "@/components/MarkdownEditor/codemirror/decoration/examples";
import {
  clipboardNodeData,
  writeClipboard,
} from "@/components/GraphEditor/graphClipboard";
import { useSettings } from "@/stores/settings";

const settings = useSettings();
const expanded = computed({
  get: () => settings.user.value.expandHelpArguments,
  set: (value) =>
    (settings.user.value = {
      ...settings.user.value,
      expandHelpArguments: value,
    }),
});

/** The editor's text and the collapsed Remarks, the Arguments section dropped when the node shows it all. */
const text = computed(() => {
  const docs = documentation.value;
  if (docs.kind === "Placeholder") return { main: "", remarks: "" };
  const names = signature.value?.params.map((p) => p.name) ?? [];
  const { main, remarks } = panelText(docs.documentation, names);
  return {
    main: resultTablesAsTables(main),
    remarks: resultTablesAsTables(remarks),
  };
});

/** An example's Copy: its nodes as the Enso clipboard type, and its text without the result line. */
const exampleCopy = exampleDecoratorExt((code) => {
  const nodes = exampleToNodes(code);
  if (nodes)
    void writeClipboard({
      ...clipboardNodeData(nodes),
      "text/plain": exampleCodeText(code),
    });
});
```

Change `syncMarkdownDocumentation` to insert `text.value.main` (watch `text`
instead of `documentation`), and add a second sync for the Remarks editor:

```ts
function syncEditor(select: (t: { main: string; remarks: string }) => string) {
  return (view: EditorView) =>
    watch(
      () => select(text.value),
      (content) =>
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        }),
      { immediate: true },
    );
}
```

Use `syncEditor((t) => t.main)` and `syncEditor((t) => t.remarks)`, replacing
`syncMarkdownDocumentation`. Only call `panelText` with signature names when the
entry is callable; for a type or module, `names` is `[]` and an `## Arguments`
section (rare there) stays.

Template, inside `.markdownDocs`:

```vue
<DocsSignature
  v-if="signature"
  v-model:expanded="expanded"
  :signature="signature"
  :icon="icon"
  :color="color"
/>
<span
  v-if="documentation.documentation.length == 0"
>No documentation available.</span>
<template v-else>
  <MarkdownEditor
    :content="text.main"
    :toolbar="false"
    :readonly="true"
    :extensions="exampleCopy"
    :editorReadyCallback="syncEditor((t) => t.main)"
  />
  <details v-if="text.remarks" class="remarks">
    <summary>Remarks</summary>
    <MarkdownEditor
      :content="text.remarks"
      :toolbar="false"
      :readonly="true"
      :editorReadyCallback="syncEditor((t) => t.remarks)"
    />
  </details>
</template>
```

`.remarks summary`:
`cursor: pointer; font-weight: 600; margin: 8px 0 4px; font-size: var(--docs-h3-size)`;
`.remarks`: `border-top: 1px solid var(--docs-table-border); padding-top: 4px;`.
Note `syncEditor` returns a new function on every render; if `MarkdownEditor`
re-invokes the callback when it changes, hoist the two callbacks into `const`s.

- [ ] **Step 3: Typecheck, lint, unit tests**

Run: `corepack pnpm --filter enso-gui run typecheck`, then
`corepack pnpm --filter enso-gui run lint`, then
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components`
Expected: all clean.

- [ ] **Step 4: Check the integration tests that touch the help panel**

Run:
`grep -rln "ComponentHelp\|DocsSignature\|help panel\|documentation panel" app/gui/integration-test | head`
For each spec found, run it (per `app/gui/CLAUDE.md`'s Playwright recipe) on
Windows and in WSL. Expected: pass; a test asserting on the old pills' `title`
or on `## Arguments` text in the panel is updated to the new behaviour, not
deleted. Rebuild workspace packages first in a reused clone
(`corepack pnpm -r compile`).

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/ComponentHelp.vue app/gui/src/project-view/stores/settings.ts app/gui/integration-test
git commit -m "Help panel: the node expands; examples copy; Remarks collapse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Check by hand in the running IDE**

Run the IDE (the `run` skill / `app/gui/CLAUDE.md`'s dev recipe) with a real
engine. With today's Date docs (not yet rewritten):

1. Select `Date.new` in the component browser: the node shows `year`, `month`,
   `day`; Tab onto `month` — tooltip with `Integer`, `= 1`, "custom widget";
   Escape hides it; tap/click pins it.
2. Click **▸ details**: rows appear; select `Date.parse` — still expanded;
   reload the IDE — still expanded. Collapse again.
3. `Date.parse`: `## Arguments` gone from the text (both bullets matched);
   Remarks collapsed under a disclosure.
4. Hand-edit one example in the running copy of `Date.enso` (or a user project's
   function doc) to the new style (`x = Date.new 2020 1 1` / `y = x.year` /
   `# → 2020`), recompile, open it: a Copy button on that example only; the
   result line muted. Click Copy, click the graph, Ctrl+V: two nodes, `y` below
   `x`, connected (`x.year`), named `x`/`y` (or `x1` if taken). If they come out
   above, fix the sign in Task 3 and its test.
5. Screenshots (before on `develop`, after on the branch) of: `Date.new`
   collapsed with a tooltip open; expanded; `Date.parse` with Remarks; the
   pasted nodes. Keep them for Task 8.

---

### Task 7: The docs site's tooltips carry the description

**Files:**

- Modify: `docs-site/generator/src/componentNode.ts`,
  `docs-site/generator/src/componentNode.test.ts`,
  `docs-site/src/components/ComponentNode.tsx` (and its CSS module if needed)

**Interfaces:**

- Consumes: `argumentDescriptions`, `splitSections` via `./gui` (Task 1).
- Produces: `NodeParam` gains `description: string` (Markdown, '' if none).

- [ ] **Step 1: Failing test**

In `componentNode.test.ts`, extend the existing `nodeProps` test fixture's doc
with `## Arguments\n- \`<argName>\`: Some
text.`for one of its arguments and expect`props.params[i].description`to be`'Some
text.'`and the others`''`.

Run:
`corepack pnpm --filter docs-site exec vitest run generator/src/componentNode.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `nodeProps`:

```ts
const argumentsText =
  splitSections(page.doc.documentation).sections.find(
    (s) => s.heading === "Arguments",
  )?.text ?? "";
const { byName } = argumentDescriptions(
  argumentsText,
  args.map((arg) => arg.name),
);
```

and set `description: byName.get(arg.name) ?? ''` on each `NodeParam`. In
`ComponentNode.tsx`, render the description under the type line in the tooltip
when non-empty (plain text, as in the panel). Update any page snapshot that
serialises the props (`pages.test.ts`) — the change is the added field.

- [ ] **Step 3: Tests, lint, typecheck**

Run: `corepack pnpm --filter docs-site exec vitest run` then
`corepack pnpm --filter docs-site run lint` then
`corepack pnpm --filter docs-site run typecheck` Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
git add docs-site
git commit -m "Docs site: a node's tooltips include the argument's description

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, changelog, PR

**Files:**

- Modify: `app/gui/src/project-view/components/ComponentHelp/CLAUDE.md`,
  `app/gui/src/project-view/components/MarkdownEditor/CLAUDE.md`,
  `docs-site/generator/CLAUDE.md` (if it lists `sections.ts`), `CHANGELOG.md`

- [ ] **Step 1: CLAUDE.md files**

`ComponentHelp/CLAUDE.md`: add `sections.ts` (shared with the docs site's
generator, which imports it through `generator/src/gui.ts`; `panelText`),
`arguments.ts` (the merge; the widget-kind rule and why it is static),
`examples.ts` (Copy → nodes), `DocsParamPill.vue` (why not `TooltipTrigger`: no
keyboard focus); update the `DocsSignature` line (tooltips, ▸ details,
`expandHelpArguments` setting). `MarkdownEditor/CLAUDE.md`: add
`decoration/examples.ts` (only under `## Examples`; only examples that parse get
a Copy button). Generator `CLAUDE.md`: `sections.ts` now lives in the GUI.

- [ ] **Step 2: Changelog**

Under `# Next Release` → `#### Enso IDE`, in the existing form, with the PR
number filled in once the PR exists:

```
- [The help panel shows each argument's type, default, widget and description
  on the component's node, and examples have a Copy button that pastes them
  into the graph as nodes][NNN]
```

and the matching `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` link.

- [ ] **Step 3: Full verification**

Run, on Windows and in WSL (`. ~/.enso-toolchain.sh` first):
`corepack pnpm --filter enso-gui run typecheck`,
`corepack pnpm --filter enso-gui exec vitest run`,
`corepack pnpm --filter docs-site exec vitest run`,
`corepack pnpm exec prettier --check` on the changed files. Expected: all pass.
Record anything not run.

- [ ] **Step 4: Screenshots and PR**

Push the screenshots from Task 6 Step 6 to the orphan `pr-screenshots` branch
(per the standing rule) and open the PR against `develop`: title "Help panel:
argument tooltips, an expanding node, and Copy on examples"; body: what changed,
the `TooltipTrigger` deviation, the widget-kind rule, the before/after images,
"Part of the function documentation design (#784)". Then link the PR
(`link_pull_request`) and wait for the owner's test before merging.
