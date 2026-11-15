# Date documentation pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every user-facing function of `Date` up to the documentation
house style, with correct signatures and working widgets, and make a style check
hold it there.

**Architecture:** A hand assessment of the widgets first (recorded in the spec's
appendix); then signature and widget fixes in `Date.enso`, guarded by the
existing `Date_Spec`; then the docs rewritten method group by method group, each
example run once to confirm its `# →` result; a style check in the docs-site
generator over the built catalogues, for an opt-in list of modules.

**Tech Stack:** Enso (standard library), sbt (engine distribution), the
docs-site generator (TypeScript, Vitest), the IDE for the assessment.

**Spec:**
`docs/superpowers/specs/2026-11-15-function-documentation-style-design.md`
(sections 1, 4, 5; delivery item 3).

## Global Constraints

- The authoring style is the spec's section 1, verbatim: one-sentence summary;
  `## Arguments` bullets `` `name`: description `` (meaning only, never the type
  or default); `## Examples` = `###` title + fenced block flush with the fence,
  one node per line, `name = expression`, no imports, no `example_*` names, a
  method example constructs its `self` first, optional last line `# → value`,
  first example the common case; `## Remarks` optional with `###` subsections.
- Every argument has a type ascription; every return type is correct.
- Every argument has a usable widget, or a remark saying why not.
- The check covers only opted-in modules; the list starts as
  `['Standard.Base.Data.Time.Date']`.
- Builds on the help panel PR (its `examples.ts` is reused by the check): branch
  from `develop` after that PR merges, or stack on its branch and retarget
  before merging (memory: stacked PR merge order).
- The PR is visible: a `CHANGELOG.md` entry under `#### Enso Standard Library`;
  owner's OK before merging.
- Running an Enso project by hand: the working directory is the project's
  parent, and a filter that matches nothing still exits 0 (root `CLAUDE.md`).

## File map

| File                                                                       | Responsibility                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date.enso`         | signatures, widgets, docs                                                                       |
| `distribution/lib/Standard/Base/0.0.0-dev/src/Widget_Helpers.enso`         | any new widget helper (e.g. a date-list or `Date_Period` selector), if the assessment needs one |
| `test/Base_Tests/src/Data/Time/Date_Spec.enso`                             | tests for each signature fix that changes behaviour                                             |
| `docs-site/generator/src/style.ts`, `style.test.ts`                        | the style check                                                                                 |
| `docs-site/generator/src/main.ts`                                          | run the check, exit 1 on violations                                                             |
| `docs-site/generator/src/gui.ts`                                           | re-export `exampleToNodes`                                                                      |
| `docs/superpowers/specs/2026-11-15-function-documentation-style-design.md` | the appendix (before/after table)                                                               |
| wiki: `Style-Guide-Enso-Docs.md` (new), `_Sidebar.md`, `Style-Guide.md`    | the house style                                                                                 |
| `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`                       | create if missing; link the wiki page and the opt-in list                                       |
| `CHANGELOG.md`                                                             | entry                                                                                           |

Build and run helpers used below:

- Engine distribution (WSL, a Linux-filesystem clone is much faster; root
  `CLAUDE.md`): `sbt buildEngineDistribution`.
- Date tests:
  `cd test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" "Date_Spec"`
  — compare the test count with an unfiltered-by-name run's Date section, so a
  filter that matched nothing is not read as a pass.
- Generator with the real catalogues:
  `corepack pnpm --filter docs-site run generate -- --lib <built-distribution>/enso-engine-*/enso-*/lib`.

---

### Task 1: The "before" widget assessment

**Files:**

- Modify: the spec's `## Appendix: Date widget assessment`

- [ ] **Step 1: Set up**

Run the IDE with a real engine (`run` skill / the wiki's Building-and-Running).
New project. Place `date1 = Date.new 2020 1 15`.

- [ ] **Step 2: Assess each function**

For each user-facing function of `Date` — the static ones (`today`, `new`,
`parse`) placed on their own, every instance method connected to `date1` — open
every argument's widget and record one row:

```
| Function | Argument | Type (declared) | Widget seen | Result | Note |
| new | month | Integer | number, 1–12 | works | |
| work_days_until | holidays | (untyped) | text box | missing | needs a date list |
```

Result is **works**, **missing** (plain text box where a picker or dropdown is
expected) or **broken** (a widget appears but setting it gives a wrong or
invalid expression, an error, or nothing). For a dropdown, pick every entry once
and check the node evaluates (in particular `Date_Period.Week`, which takes
`first_day`). Include the operators and conversions only if they appear in the
component browser.

- [ ] **Step 3: Record and commit**

Write the table under the appendix's "Before" heading, with the date and the
commit it was taken on. Add, under it, the list of user-facing vs hidden
functions the assessment settles (spec §5's last table row).

```bash
git add docs/superpowers/specs/2026-11-15-function-documentation-style-design.md
git commit -m "Date docs pilot: the widget assessment before the fixes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Signature fixes

**Files:**

- Modify: `Date.enso`, `test/Base_Tests/src/Data/Time/Date_Spec.enso`

- [ ] **Step 1: Write failing tests where behaviour is observable**

In `Date_Spec.enso`, in the existing Date group, add:

```enso
        group_builder.specify "first_of_month and end_of_month are Dates" <|
            d = Date.new 2020 2 15
            d.first_of_month . should_equal (Date.new 2020 2 1)
            d.end_of_month . should_equal (Date.new 2020 2 29)
            Meta.type_of d.first_of_month . should_equal Date

        group_builder.specify "work_days_until rejects a non-Date end" <|
            (Date.new 2020 1 1).work_days_until 5 . should_fail_with Type_Error
```

(Match the spec file's existing structure and imports — read it first; if the
second test does not fail today because the untyped `end` already errors inside,
keep it as a regression test and note that it passed before.)

Run the Date tests. Expected: the first test passes already (the declared type
is not enforced), the second fails or passes as noted. They are guards for the
signature change, not proof of a bug.

- [ ] **Step 2: Fix the signatures**

In `Date.enso`:

- `first_of_month : Integer` → `first_of_month : Date`, and
  `end_of_month : Integer` → `end_of_month : Date`. Prefer inline form while
  there: `first_of_month self -> Date =`.
- `until`: add the missing closing `---` to its front matter.
- `week_of_year self (locale : Locale | Nothing = Nothing) -> Integer =`.
- `work_days_until self (end : Date) (holidays : Vector Date = []) (include_end_date : Boolean = False) -> Integer =`.
- `add_work_days self (days : Integer = 1) (holidays : Vector Date = []) -> Date =`
  (and `internal_add_work_days` the same).
- `until self (end : Date) -> Period =`,
  `days_until self (end : Date) (include_end_date : Boolean = False) -> Integer =`.
- Remove each old separate `name : A -> B` signature line the inline form
  replaces, so there is one signature per method.

- [ ] **Step 3: Build and run the Date tests**

`sbt buildEngineDistribution` (or the faster `runtime/...` route if the wiki
gives one for stdlib-only changes), then the Date tests and the full
`Base_Tests` `Data.Time` specs. Expected: all pass, the new ones included.

- [ ] **Step 4: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date.enso test/Base_Tests/src/Data/Time/Date_Spec.enso
git commit -m "Date: correct return types and type every argument

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Widget fixes

**Files:**

- Modify: `Date.enso`; `Widget_Helpers.enso` only if a helper is shared

- [ ] **Step 1: List the fixes from Task 1's table**

Every **missing** or **broken** row becomes a fix. Look for an existing widget
first
(`grep -rn "default_widget\|make_.*_selector" distribution/lib/Standard/Base/0.0.0-dev/src | head -40`):
`Date.default_widget` for a `Date` argument, `Locale.default_widget` (or
whatever `Date_Time` uses for locales) for `locale`, a `Vector_Editor` of
`Date.default_widget` for `holidays`
(`Widget.Vector_Editor item_editor=(Date.default_widget) display=Display.Always item_default="Date.today"`
— check `Widget.Vector_Editor`'s fields in `Metadata.enso`), and for
`Date_Period` the dropdown its type gives, or an explicit `Widget.Single_Choice`
listing `..Year`, `..Quarter`, `..Month`, `(..Week)`, `..Day` if `Week`'s
argument breaks the default one.

- [ ] **Step 2: Apply them**

Add the `@argument widget` annotations above each method, in the file's existing
style (`@time_of_day (Time_Of_Day.default_widget include_now=False)`). A fix
that needs GUI work becomes a ticket; the doc gets a `## Remarks` subsection
saying what to type instead.

- [ ] **Step 3: Rebuild, re-check by hand**

Rebuild the distribution, restart the IDE, and recheck each fixed row in the
running IDE. Then the Date tests again. Expected: every row **works** or has a
ticket and a remark.

- [ ] **Step 4: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src
git commit -m "Date: a working widget for every argument

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The style check

**Files:**

- Create: `docs-site/generator/src/style.ts`,
  `docs-site/generator/src/style.test.ts`
- Modify: `docs-site/generator/src/main.ts`, `docs-site/generator/src/gui.ts`

**Interfaces:**

- Consumes: `exampleToNodes`, `RESULT_LINE` (help panel PR's
  `ComponentHelp/examples.ts`, re-exported through `gui.ts`); `splitSections`,
  `argumentDescriptions` (via `gui.ts`); `SiteModel`, `Page`, `isFunctionPage`
  (`model.ts`).
- Produces:

```ts
/** Modules whose functions must follow the house style. */
export const STYLE_CHECKED_MODULES: readonly string[]; // ['Standard.Base.Data.Time.Date']
export interface StyleViolation {
  page: string;
  rule: string;
}
export function styleViolations(
  model: SiteModel,
  modules?: readonly string[],
): StyleViolation[];
```

Rules (each a `rule` string, so the report reads as a list):
`argument <name> has no type`, `argument <name> is not documented`,
`## Arguments names <name>, which is not an argument`, `no example`,
`example <n> does not parse`, `example <n> imports`,
`example <n> binds example_*`, `example <n>: the result line is not last`.

- [ ] **Step 1: Failing tests on hand-built pages**

Build a minimal `SiteModel` with one function page in
`Standard.Base.Data.Time.Date` (copy how `pages.test.ts` / `model.test.ts` make
pages from fixture entries) and assert, one test per rule, that a doc breaking
that rule gives exactly that violation; one test that a conforming doc (the spec
§1 example, with the code flush) gives `[]`; one that a page outside the
opted-in modules is never checked.

An argument "has no type" when its `reprType` is `Standard.Base.Any.Any` and the
source had no ascription — the catalogue cannot tell `Any` from untyped, so
treat `Any` as untyped, and allow it only with a remark: a `## Remarks`
subsection naming the argument (document this in `style.ts`).

Run:
`corepack pnpm --filter docs-site exec vitest run generator/src/style.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `style.ts`**

For each `isFunctionPage` page whose `entry.module` is in the list: take the
arguments but `self`; `splitSections(page.doc.documentation)`; check
`## Arguments` with `argumentDescriptions` (missing → `is not documented`,
`unmatched` bullets that name a non-argument → `which is not an argument`); find
the `## Examples` section, extract its fenced blocks with `ensoMarkdownParser`
(`FencedCode` → `CodeText`, as the panel's `exampleBlocks` does), and per block:
`exampleToNodes(code)` undefined → `does not parse`; a line starting `import `
or `from ` → `imports`; a node binding starting `example_` → `binds example_*`;
a `RESULT_LINE` that is not the last non-empty line → `result line is not last`.

`exampleToNodes` parses with the Enso parser: check it loads in the generator's
Node environment (`gui.test.ts` shows how the bridge is tested); if the WASM
parser needs initialising there, do it the way `ydoc-shared`'s own Node tests
do.

- [ ] **Step 3: Run the check in `main.ts`**

After the page-floor check:

```ts
const violations = styleViolations(model);
if (violations.length) {
  for (const v of violations) console.error(`${v.page}: ${v.rule}`);
  console.error(
    `${violations.length} documentation style violations (STYLE_CHECKED_MODULES).`,
  );
  process.exit(1);
}
```

Fixture runs (`--fixtures`) have no Date module, so they pass.

- [ ] **Step 4: Tests, and a run against today's Date docs**

Run: `corepack pnpm --filter docs-site exec vitest run` Expected: PASS.

Run the generator against the distribution from Task 3. Expected: **fails**,
listing Date's violations (its docs are not rewritten yet). Keep the list: it is
Task 5's worklist.

- [ ] **Step 5: Commit**

```bash
git add docs-site/generator/src
git commit -m "Docs site: a documentation style check for opted-in modules (Date)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rewrite Date's documentation

**Files:**

- Modify: `Date.enso`

Work in these groups, one commit each, in this order: (a) `today`, `new`,
`parse`; (b) the field getters (`year`, `month`, `day`, `quarter`,
`week_of_year`, `day_of_year`, `day_of_week`, `century`, `is_leap_year`,
`length_of_year`, `length_of_month`); (c) period arithmetic (`first_of_month`,
`end_of_month`, `start_of`, `end_of`, `next`, `previous`, `date_part`,
`date_diff`, `date_add`, `until`, `days_until`, `+`, `-`); (d) work days
(`work_days_until`, `add_work_days`); (e) ranges and conversions (`up_to`,
`down_to`, `to_date_time`, `format`, `to_display_text`, and any other the
assessment kept user-facing).

For each function in the group:

- [ ] **Step 1: Write the doc to the style**

A one-sentence summary; `## Arguments` with every argument but `self` (meaning
only); at least one example under `## Examples` with a `###` title, code flush
with the fence, `name = expression` lines, `self` constructed first, and a
`# → value` result; existing remarks kept under `## Remarks` with `###`
subsections. Fix the copy-pasted `end` descriptions of `until` and `days_until`.
Example of the target, for `year`:

````
    ## ---
       group: Metadata
       icon: metadata
       ---
       The year of this date.

       ## Examples
       ### The year of a date
       ```
       date = Date.new 2020 12 23
       year = date.year
       # → 2020
       ```
    year self -> Integer = Date_Helpers.year self
````

Examples use fixed dates, not `Date.today`, except `today`'s own (whose result
line is omitted, since it changes). Pick dates that show the edge the function
is about (a leap year for `length_of_month`, a year boundary for `next`).

- [ ] **Step 2: Confirm every stated result by running it**

Make a scratch project outside the repo (`enso --new <scratch>/Example_Check`),
and put the group's examples into its `main`, each example's last binding
printed: `IO.println (date.year)` and so on. Run it (working directory = the
project's parent):

```bash
cd <scratch> && <built-distribution>/enso-engine-*/enso-*/bin/enso --run Example_Check
```

Expected: each printed value equals its `# →` line. Fix the doc where it does
not — never the expectation to match a suspicious output without checking why.

- [ ] **Step 3: Rebuild, run the check and the Date tests**

Rebuild the distribution; run the generator against it. Expected: no violations
left for the functions done so far. Run the Date tests. Expected: pass.

- [ ] **Step 4: Commit the group**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date.enso
git commit -m "Date docs: <group> to the house style

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After group (e): the generator run reports **no** violations.

---

### Task 6: The "after" assessment, style guide, PR

**Files:**

- Modify: the spec's appendix; `CHANGELOG.md`;
  `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md` (create if missing)
- Wiki: new `Style-Guide-Enso-Docs.md`; `_Sidebar.md`; `Style-Guide.md`

- [ ] **Step 1: The "after" table**

Repeat Task 1 on the branch (with the help panel PR merged or stacked), and
also: open each Date function in the help panel — the node's tooltips show a
description for every argument, every example has a Copy button, Copy + paste of
three examples (one from each of groups b, c, d) gives connected nodes that
evaluate to the stated result. Write the table under "After"; commit.

- [ ] **Step 2: The wiki page**

Clone the wiki (per `docs/CLAUDE.md`) to a scratch directory. Write
`Style-Guide-Enso-Docs.md` from spec §1 (the example, the rules, and why: the
node and the Copy button), plus how to opt a module into the check
(`STYLE_CHECKED_MODULES` in `docs-site/generator/src/style.ts`) and how to run
it. Link it from `Style-Guide.md` and `_Sidebar.md`. Link to code with full
`https://github.com/jdunkerley/enso/blob/develop/...` URLs. Push.

- [ ] **Step 3: `Base` CLAUDE.md and changelog**

`distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`: a short section "Doc
comments" pointing at the wiki page and the opt-in list. If the file does not
exist, create it per the `project-structure` skill (purpose, layout, the
`Data/Time` area, the doc style).

`CHANGELOG.md`, `# Next Release` → `#### Enso Standard Library`:

```
- [`Date`'s functions are documented with examples you can copy into the graph,
  and every argument has a widget][NNN]
```

with the link definition.

- [ ] **Step 4: Verify and open the PR**

Run: the Date tests; `Base_Tests` `Data.Time`; the generator against the
distribution (no violations);
`corepack pnpm --filter docs-site exec vitest run`; `prettier --check` on
changed Markdown. On Linux (WSL) as well as Windows. Say in the PR which of
these ran where, and that `gatherLicenses` and the engine CI jobs are left to
CI.

Open the PR against `develop` (after the help panel PR), title "Date: the
documentation house style, working widgets, and a style check"; body: the
before/after tables, the signature fixes, the widgets added, tickets for any
deferred widget, the wiki page, "Closes nothing; part of the function
documentation design (#784)". Link it (`link_pull_request`) and wait for the
owner's OK before merging.

- [ ] **Step 5: Follow-up tickets**

Open (on the fork): checking `# →` results by running examples (spec §6); a live
preview node; one ticket per `Data/Time` type (`Date_Time`, `Time_Of_Day`,
`Period`, `Duration`, `Date_Range`), each naming the wiki page and the opt-in
list.
