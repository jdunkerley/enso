# Function documentation: a house style, piloted on `Date`

Status: design approved by the owner, 2026-11-15. This spec writes it down and
grounds it in the code.

## Goal and scope

Make a function's documentation look good in the IDE's help panel, give it
examples that paste straight into the graph, show its arguments clearly, and
check that every argument has a widget that works. `Date`
(`distribution/lib/Standard/Base/0.0.0-dev/src/Data/Time/Date.enso`) is the
pilot: it is brought fully up to the style, and the style is written down so
that the other types follow, one ticket each.

In scope:

- the authoring style for doc comments (section 1);
- the help panel's rendering of a function: the node with tooltips and an
  expanded view, Copy buttons on examples, and the `## Arguments` section shown
  only on the node (section 2);
- copying an example into the graph as connected nodes (section 3);
- checks over the built catalogues that hold the style (section 4);
- a hand assessment of `Date`'s widgets, and the fixes to its signatures,
  widgets and documentation (section 5).

Out of scope (follow-up tickets, section 6): running the examples to check their
stated results; a live preview node with working widgets in the panel;
converting any type other than `Date`.

## Decisions (the owner's, 2026-11-15)

1. **Date is the pilot.** The style is defined and Date is fixed to it; other
   types follow later as separate tickets.
2. **An example is a small graph.** One node per line, `name = expression`, no
   imports, no `example_*` names; an optional trailing `# → value` line gives
   the result and is not pasted. A **Copy** button puts the example on the
   clipboard as connected, named nodes.
3. **Arguments are merged from code and doc.** Type and default come from the
   signature, the widget kind from annotations and type, the description from
   the doc's `## Arguments` bullets, so the documentation cannot contradict the
   code.
4. **Widgets are fixed in the pilot,** not just recorded. "Every argument has a
   usable widget, or a remark saying why not" is part of the style.
5. **Panel layout** (chosen from mockups, `.superpowers/brainstorm/`): the
   compact node the panel already draws, with a tooltip on each argument pill
   (type, default, widget kind, description) and a **▸ details** toggle that
   expands the node into one row per argument plus the return type. Collapsed by
   default. No separate Arguments section below the node. The `→ Type` line
   stays under the collapsed node. Then the summary, the examples with Copy
   buttons, and the remarks, collapsed.

## Where things are today

(From a read of the code at `b3a7a71285`, 2026-11-15.)

- **The help panel** is `app/gui/src/project-view/components/ComponentHelp.vue`
  with the pieces in `components/ComponentHelp/` (its `CLAUDE.md` lists them).
  The text is a read-only `MarkdownEditor` (CodeMirror) fed with
  `resultTablesAsTables(docs.documentation)`. The look is the docs site's, from
  the `--docs-*` tokens in `assets/base.css`.
- **The node already exists:** `DocsSignature.vue` / `signature.ts` draw a
  callable as the docs site draws it
  (`docs-site/src/components/ComponentNode.tsx`): icon, name and argument pills
  on the group colour, optional arguments in italics. The type and default are
  only in a native `title` on each pill.
- **Argument descriptions are already parsed,** but only by the docs site:
  `argumentDescriptions` in `docs-site/generator/src/sections.ts` matches each
  `## Arguments` bullet that opens with `` `name` `` to that argument, on the
  Lezer tree of the GUI's `ensoMarkdownParser`. `splitSections` splits a doc at
  its `##` headings; `KNOWN_SECTIONS` is
  `Arguments, Returns, Examples, Errors, Remarks`.
- **Paste:** `components/GraphEditor/graphClipboard.ts` decodes the Enso
  clipboard type (`ENSO_MIME_TYPE`: a list of `CopiedNode`
  `{expression, binding?, documentation?, metadata?}`), then spreadsheets, then
  plain text. Plain text becomes **one** node holding the whole text.
  `clipboardNodeData` / `writeClipboard` write the Enso type. On creation,
  `composables/nodeCreation.ts` gives each pasted binding a locally unique name
  (`generateLocallyUniqueIdent`), rewrites references between the pasted nodes
  (`identifiersRenameMap`) and adds detected imports (`addDetectedImports`).
- **Date's documentation** has these problems:
  - **Examples won't paste.** They read `from Standard.Base import Date` /
    `example_year = Date.today.year`, so pasting makes a single broken node.
    Inside each fence the code also carries 6 extra spaces of indent.
  - **Few examples:** about 16 across roughly 40 methods. Most getters and
    arithmetic methods have none.
  - **Wrong signatures:** `first_of_month` and `end_of_month` declare
    `: Integer` and return a `Date`. `until`'s front matter is never closed (no
    closing `---`), so its description is read as front matter.
  - **Untyped arguments:** `week_of_year locale`,
    `work_days_until end holidays`, `add_work_days days holidays`.
  - **Copy-pasted text:** `until` and `days_until` describe `end` as "the end
    date of the interval to count workdays in".
  - **Few explicit widgets:** only `new` (`@year`, `@month`, `@day`), `parse`
    and `format` (`@format`) and `to_date_time` (`@time_of_day`, `@zone`) have
    them. The rest rely on what their type gives.

## 1. The authoring style

```
## ---
   group: DateTime
   icon: time
   ---
   Counts the working days from this date (inclusive) up to `end` (exclusive).

   ## Arguments
   - `end`: The last day of the range. Not counted unless `include_end_date` is on.
   - `holidays`: Dates to skip. Weekends are already skipped.
   - `include_end_date`: Count `end` too, as Excel's `NETWORKDAYS` does.

   ## Examples
   ### Working days in January 2020
```

start = Date.new 2020 1 1 end = Date.new 2020 2 1 days = start.work_days_until
end

# → 23

```

## Remarks
### Including the end date
…
```

Rules:

- **Summary:** the first paragraph is one sentence. The panel shows it right
  under the node.
- **`## Arguments`:** one bullet per argument except `self`, in the form
  `` `name`: description ``. The text gives meaning only: never the type or the
  default, which the node shows from the code.
- **`## Examples`:** each example is a `###` title and one fenced block.
  - The code is flush with the fence, with no extra indent.
  - Each line is one node, written as `name = expression` (a bare expression is
    allowed and gets an automatic name).
  - No imports: `Standard.Base` is imported in every project, and the paste path
    adds other detected imports. No `example_*` names.
  - A method's example starts by constructing its `self` value as a node.
  - An optional last line `# → value` states the result. It is shown, never
    pasted.
  - The first example is the common case.
- **`## Remarks`:** optional, with `###` subsections. The panel collapses it.
- **Signature:** every argument has a type ascription and the return type is
  correct, because the node and the widgets are built from them.
- **Widgets:** every argument has a usable widget, or a remark saying why it
  cannot have one.

The style guide is written up as a wiki page (next to the other style guides),
linked from `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md` (created if
missing) and from this spec.

## 2. The help panel

All in `app/gui/src/project-view/components/ComponentHelp/`.

**The merged arguments: new `arguments.ts`.** One list per callable, each item
`{name, optional, type, default, widget, description}`:

- `name`, `optional`, `type`, `default`: from the suggestion entry's arguments,
  as `signature.ts` reads them today.
- `description`: from `argumentDescriptions`, which moves from
  `docs-site/generator/src/sections.ts` into shared GUI code (with
  `splitSections`); the generator imports it from there, so the site and the
  panel use one copy.
- `widget`: a short label for the widget kind (`dropdown`, `number`,
  `date picker`, `checkbox`, `text`, …). From what the GUI would actually pick
  if the widget registry's selection can be reused cheaply for a suggestion
  argument; otherwise from the `@` annotation alone, and `text` when there is
  none. Settled in the plan. A label for an argument without an explicit
  annotation is marked as inferred.

**The node: `DocsSignature.vue`.**

- Each pill gets a real tooltip (`TooltipTrigger`), replacing the native
  `title`: type, default, widget kind and description. It opens on hover, on
  keyboard focus and on tap, as the docs-site spec requires of the site's node.
- A **▸ details** toggle on the node turns the pills into one row per argument
  (name, type, default, widget kind, description) plus a return-type row.
  Collapsed is the default; the choice persists in the panel's settings across
  entries.
- The `→ Type` line stays under the collapsed node.

**The text below the node.**

- `## Arguments` is removed from the Markdown handed to the editor when every
  bullet in it matched an argument. Any unmatched bullet or block stays visible
  in place, so nothing is silently lost.
- Each fenced block under `## Examples` gets a **Copy** button, a CodeMirror
  widget decoration in the read-only editor (next to `decoration/blocks.ts`,
  which already marks fenced code lines). A trailing `# → value` line is drawn
  in a muted result style.
- `## Remarks` is collapsed under a disclosure.

**The docs site** keeps its React `ComponentNode`, but builds its tooltips from
the same merged arguments through the shared helper, so the site and the panel
say the same things.

## 3. Copy → paste into the graph

`exampleToNodes(code)` (new, in `ComponentHelp/`):

1. Parse the example as a block with the GUI's Enso parser.
2. Each top-level statement becomes a `CopiedNode`: an assignment `name = expr`
   gives `{binding: name, expression: expr}`, a bare expression gives
   `{expression}`. Comments (including `# → value`) are dropped.
3. Positions: stacked vertically from the first node, one default node height
   plus the usual gap apart, in `metadata.position`.
4. The Copy button writes `clipboardNodeData(nodes)`: the Enso clipboard type,
   plus the example's text without the result line as `text/plain`.

Pasting is the normal Ctrl+V path, so unique names, rewritten references and
detected imports come for free. The plain-text paste path does not change. An
example that does not parse gets no Copy button. The checks (section 4) keep
every standard library example out of that state.

## 4. Checks

Vitest tests in `docs-site/generator`, run on the built catalogues the site
already uses, for each documented callable in an **opted-in** module (an
explicit list, starting with `Standard.Base.Data.Time.Date` and growing as types
are converted):

- every argument except `self` has a type and a description, and no
  `## Arguments` bullet names a missing argument;
- at least one example;
- every example parses with one node per line, has no imports and no `example_*`
  binding, and its result line, if any, is the last line.

The site's CI job (`docs-site` on pull requests touching `distribution/lib/**`)
runs them, so a Date doc change that breaks the style fails its PR.

GUI unit tests: `exampleToNodes` (assignments, bare expressions, comments,
result line, a parse failure); `arguments.ts` merge (matched, missing, unmatched
bullet, `self`); the `## Arguments` removal (all matched: removed; one
unmatched: kept). A component test for the tooltip and the expanded node.

## 5. Date: widget assessment and fixes

**Assessment.** In the IDE with a real engine, put `Date.new 2020 1 15` on the
canvas, connect each Date method to it in turn (and place the static ones on
their own), and record each argument as **works**, **missing** (falls back to a
text box) or **broken**, with a note. The table is added to this spec's
appendix, then redone after the fixes, so it ends as a before/after record.

**Fixes known from reading the code:**

| Where                                                                                | Fix                                                                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `first_of_month`, `end_of_month`                                                     | Return type `Integer` → `Date`                                                                        |
| `until`                                                                              | Close the front matter                                                                                |
| `week_of_year`                                                                       | `locale : Locale \| Nothing`, with the Locale widget used elsewhere                                   |
| `work_days_until`, `add_work_days`                                                   | `end : Date`, `holidays : Vector Date`, `days : Integer`                                              |
| `until`, `days_until`                                                                | Rewrite the copy-pasted description of `end`                                                          |
| `start_of`, `end_of`, `next`, `previous`, `date_part`, `date_diff`, `date_add`       | Check the `Date_Period` dropdown; `Week` takes `first_day`, a likely problem. Add a widget if missing |
| `+`, `-`, comparisons, `to_display_text`, `to_js_object`, `pretty`, `default_widget` | Decide which are user-facing. Operators get a short example; plumbing methods none, or are hidden     |

Anything else the assessment finds is fixed in the same PR. A fix too large for
it (a widget the GUI cannot draw today, say) becomes a ticket, with a remark in
the doc. Every Date function is then rewritten to section 1, each with at least
one example, the first one the common case. Results in `# →` lines are worked
out by hand and checked by running the example in the IDE once.

## 6. Delivery

1. **This spec** (docs only, so it starts no CI). `.superpowers/` (the mockups)
   goes into `.gitignore` in PR 2.
2. **PR: the help panel.** Section 2 and 3, the shared move of
   `argumentDescriptions`, and the GUI tests. Visible: a changelog entry under
   `#### Enso IDE`, before/after screenshots on the PR. Merges after the owner's
   test.
3. **PR: Date.** Section 5, the section 4 checks for the Date module, and the
   wiki style guide. A changelog entry under `#### Enso Standard Library`. Built
   alongside PR 2, merged after it, so the new examples arrive with their Copy
   buttons.

Follow-up tickets:

- Check every `# → value` by running the examples (a generated Enso test from
  the catalogue is the likely route).
- A live preview node with working widgets in the panel.
- One ticket per type for the rollout, starting with the rest of `Data/Time`
  (`Date_Time`, `Time_Of_Day`, `Period`, `Duration`, `Date_Range`).

## Appendix: Date widget assessment

### Before

Taken on: _date_, commit _sha_ (develop after #788), by the owner in the
installed IDE with a real engine.

**Setup.** New project. Place `date1 = Date.new 2020 1 15`. Place the static
functions (`today`, `new`, `parse`) on their own; connect every instance method
to `date1` (drag from its output, or type `date1.` in the component browser).

**For each row:** open the argument's widget, set a value, and check the node
evaluates. Fill in:

- **Widget seen:** what the IDE shows (number, dropdown, date picker, checkbox,
  text box, nothing…).
- **Result:** **works**; **missing** (a plain text box where a picker or
  dropdown is expected); or **broken** (a widget appears but setting it gives a
  wrong or invalid expression, an error, or nothing).
- For a dropdown, pick **every entry once**, in particular `Date_Period.Week`,
  which takes `first_day`. Note any entry that fails.
- Rows with no argument (—): just check the function is in the component
  browser, its help panel looks right, and the node evaluates. Put "hidden" in
  Note for any that is not in the component browser.

| Function                                                            | Argument         | Type (declared)             | Expected widget                               | Widget seen               | Result  | Note                                                                          |
| ------------------------------------------------------------------- | ---------------- | --------------------------- | --------------------------------------------- | ------------------------- | ------- | ----------------------------------------------------------------------------- |
| today                                                               | —                | —                           | —                                             | —                         | n/a     | No arguments, so no widget to assess.                                         |
| new                                                                 | year             | Integer                     | number                                        | number                    | works   |                                                                               |
| new                                                                 | month            | Integer                     | number, 1–12                                  | number with a 1–12 slider | works   | The slider is barely visible: a design fault in the numeric widget, not Date. |
| new                                                                 | day              | Integer                     | day picker (`make_day_picker`)                | day picker                | works   |                                                                               |
| parse                                                               | text             | Text                        | text                                          | text                      | works   |                                                                               |
| parse                                                               | format           | Date_Time_Formatter         | format dropdown (`make_date_format_selector`) | format dropdown           | works   |                                                                               |
| year · month · day                                                  | —                | —                           | —                                             | —                         | n/a     | No arguments, so no widget to assess.                                         |
| week_of_year                                                        | locale           | Locale \| Nothing (untyped) | locale dropdown                               | locale selector           | broken  | Choosing a locale does not work.                                              |
| is_leap_year · length_of_year · century · quarter · length_of_month | —                | —                           | —                                             | —                         | n/a     | No arguments, so no widget to assess.                                         |
| first_of_month · end_of_month                                       | —                | —                           | — (declared `Integer`, returns a Date)        | —                         | n/a     | No arguments, so no widget to assess.                                         |
| day_of_year · day_of_week                                           | —                | —                           | —                                             | —                         | n/a     | No arguments, so no widget to assess.                                         |
| start_of                                                            | period           | Date_Period (untyped)       | Date_Period dropdown                          | Date_Period dropdown      | works   | Inserts the full name (`Date_Period.Month`), not the auto-scoped `..Month`.   |
| end_of                                                              | period           | Date_Period (untyped)       | Date_Period dropdown                          | Date_Period dropdown      | works   | Inserts the full name (`Date_Period.Month`), not the auto-scoped `..Month`.   |
| next                                                                | period           | Date_Period                 | Date_Period dropdown                          | Date_Period dropdown      | works   |                                                                               |
| previous                                                            | period           | Date_Period                 | Date_Period dropdown                          | Date_Period dropdown      | works   |                                                                               |
| until                                                               | end              | Date (untyped)              | date picker                                   | text box                  | missing | Needs a date picker.                                                          |
| days_until                                                          | end              | Date (untyped)              | date picker                                   | text box                  | missing | Needs a date picker.                                                          |
| days_until                                                          | include_end_date | Boolean (untyped)           | checkbox                                      | checkbox                  | works   |                                                                               |
| date_part                                                           | period           | Date_Period                 | Date_Period dropdown                          | Date_Period dropdown      | works   |                                                                               |
| date_diff                                                           | end              | Date                        | date picker                                   |                           |         |                                                                               |
| date_diff                                                           | period           | Date_Period                 | Date_Period dropdown                          |                           |         |                                                                               |
| date_add                                                            | amount           | Integer                     | number                                        | number                    | works   |                                                                               |
| date_add                                                            | period           | Date_Period                 | Date_Period dropdown                          | Date_Period dropdown      | works   |                                                                               |
| work_days_until                                                     | end              | Date (untyped)              | date picker                                   |                           |         |                                                                               |
| work_days_until                                                     | holidays         | Vector Date (untyped)       | list of dates                                 | —                         | missing | Needs a vector editor whose items use the new date picker.                    |
| work_days_until                                                     | include_end_date | Boolean (untyped)           | checkbox                                      |                           |         |                                                                               |
| add_work_days                                                       | days             | Integer (untyped)           | number                                        | number                    | works   |                                                                               |
| add_work_days                                                       | holidays         | Vector Date (untyped)       | list of dates                                 | —                         | missing | Needs a vector editor whose items use the new date picker.                    |
| to_date_time                                                        | time_of_day      | Time_Of_Day                 | time widget (`Time_Of_Day.default_widget`)    | `<Fixed Time>` dropdown   | missing | Needs a time picker.                                                          |
| to_date_time                                                        | zone             | Time_Zone                   | time zone dropdown                            | time zone dropdown        | works   |                                                                               |
| up_to                                                               | end              | Date                        | date picker                                   | text box                  | missing | Needs the new date picker.                                                    |
| up_to                                                               | include_end      | Boolean                     | checkbox                                      | checkbox                  | works   |                                                                               |
| up_to                                                               | step             | Date_Period \| Period       | Date_Period dropdown / period                 | Date_Period dropdown      | works   |                                                                               |
| down_to                                                             | end              | Date                        | date picker                                   | text box                  | missing | Needs the new date picker.                                                    |
| down_to                                                             | include_end      | Boolean                     | checkbox                                      | checkbox                  | works   |                                                                               |
| down_to                                                             | step             | Date_Period \| Period       | Date_Period dropdown / period                 | Date_Period dropdown      | works   |                                                                               |
| format                                                              | format           | Date_Time_Formatter         | format dropdown (`make_date_format_selector`) |                           |         |                                                                               |
| + · -                                                               | amount           | Period \| Date_Period       | only if in the component browser              |                           |         |                                                                               |
| > · >= · < · <=                                                     | that             | (untyped)                   | only if in the component browser              |                           |         |                                                                               |

**Other Date functions in the component browser** (not listed above):

**User-facing vs hidden** (spec §5's last row; filled in from the Note column):
