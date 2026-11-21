# Widgets PR 5a: `Widget_Columns`, `Column_Kind` and Declarative Column Pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Base gains the data type a column picker reads (`Widget_Columns`: the
names, kinds and type names of a table's columns), the kind vocabulary
(`Column_Kind`, replacing Visualization's `Viz_Kind`), the four declarative
picker constructors (`Widget.Column_Name`, `Column_Names`, `Column_Vector`,
`Order_By`), and `Widget_Query.resolve_call` sends each column list it needs
once, beside the arguments. Table and Row convert to `Widget_Columns` from their
schema alone. No annotation uses the pickers yet, so nothing a user sees
changes; PR 5b switches the GUI and the libraries over.

**Architecture:** A picker is a small reference,
`{"constructor":"Column_Name", "from":null,"kinds":["Numeric"],…}`, that the
engine never expands. `resolve_call` walks the widgets it resolved for the
column sources they name (`""` for the call's subject, otherwise an argument's
name), converts each source's value once with `Widget_Columns.from`, and adds
`"columns":{"<source>":{names,kinds,type_names}}` to the answer. The conversion
for `Table` goes through the table's implementation: in memory it reads each
column's `value_type`; in a database it reads only the SQL types already known,
so it never queries. `Viz_Kind` is deleted and every chart uses `Column_Kind`.

**Tech Stack:** Enso (Base, Table, Database, Visualization), the stdlib test
suites.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§5
"Column pickers by conversion", §6 "Schema-keyed cache" and targets; PR table
row 5, split into 5a and 5b by this plan — owner decision 1 below).

**Depends on:** PR 1a/1b (merged: `Widget_Query.resolve_call`). Independent of
PRs 3b and 4; may run in parallel with both (see "Shared files").

**Followed by:** PR 5b
(`docs/superpowers/plans/2026-11-21-widgets-pr5b-column-pickers.md`): the GUI
expands the references, the libraries migrate, the benchmark is re-run.

## Owner decisions needed

Shared with PR 5b (the numbers are the same in both plans).

1. **Split PR 5 into 5a (Base and libraries, invisible) and 5b (GUI and
   migration, visible)?** _Recommended: yes_, as PRs 1 and 3 were split. 5a is
   reviewable as pure Enso with exact JSON tests; 5b carries the GUI, the ~90
   annotation rewrites, the benchmark and the changelog entry. 5a must merge
   first (5b's GUI needs the `columns` block).
2. **Database columns whose type is not known yet.** The spec says a database
   table's schema "is already in memory, so no query is made". That holds for
   names, but a computed column's SQL type
   (`SQL_Type_Reference.Computed_By_Database`,
   `Database/…/Internal/SQL_Type_Reference.enso:20`) is fetched lazily with one
   query **per column** on first `value_type` (`get_or_compute`, line 119).
   _Recommended: never query_ — a new `SQL_Type_Reference.known` gives the type
   if it is already in hand, otherwise the column is kind `Other` with type name
   `""`. Combined with decision 3 an unknown column is still offered by every
   kind-filtered picker, so nothing is hidden. Alternative: one
   `prepare_fetch_types_query` for the whole table per schema (one query, cached
   in the references with `cache_computed_type`).
3. **What `kinds` filters.** _Recommended: a column is offered when `kinds` is
   empty, its kind is listed, or its kind is `Other`_ — `Other` covers Mixed,
   unknown and unsupported types, which today's typed pickers include
   (`make_column_ref_by_name_selector_for_type` adds `..By_Type ..Mixed`). The
   GUI applies it (5b).
4. **Annotation form.** The spec writes `@columns ..Column_Names`. An annotation
   has no expected type, so an autoscoped `..Column_Names` cannot resolve there,
   and no standard-library annotation uses `..` today. _Recommended:
   `@columns (Widget.Column_Names)`_ (and `Widget.Column_Name …` etc.), the form
   every typed annotation already uses (`@pattern Widget.Text_Input`). Task 3
   adds a test that pins this (if `..` does resolve, the test says so and the
   owner may choose it). Spec examples amended.
5. **The picker flags.** The spec names `kinds` and `from` and allows "a flag on
   the picker" for table extras. _Recommended set_ (each replaces exactly one
   existing helper parameter, so the migration in 5b is one-to-one):

   | Constructor     | Fields (all defaulted)                                                                                                                                                            | Replaces                                                                                                                                            |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `Column_Name`   | `kinds:(Vector Column_Kind)=[]`, `from:(Text\|Nothing)=Nothing`, `expression:Boolean=False`, `reference:Boolean=False`, `extra:(Vector Choice)=[]`, `columns_first:Boolean=False` | `make_column_name_selector` (`add_expression`), `make_column_ref_by_name_selector` (`reference=True`, constants as `extra`), `…_for_type` (`kinds`) |
   | `Column_Names`  | `kinds`, `from`, `regex:Boolean=False`, `by_type:Boolean=False`                                                                                                                   | `make_column_name_multi_selector` (`add_regex`, `add_by_type`)                                                                                      |
   | `Column_Vector` | `kinds`, `from`                                                                                                                                                                   | `make_column_name_vector_selector`                                                                                                                  |
   | `Order_By`      | `from`, `name_only:Boolean=False`                                                                                                                                                 | `make_order_by_selector`                                                                                                                            |

6. **Engine-side caching.** With references the engine no longer copies column
   lists; what remains per query is one `Widget_Columns.from` per source (a pass
   over the schema). _Recommended: no engine cache for it in 5a_; 5b measures it
   against the 20 ms target and the GUI caches the expansion on the schema
   (decision 8 in 5b). `_with_table_cache` / `TableValueCache` /
   `With_JSON_Cache` stay untouched in 5a.
7. **Where the types live.** _Recommended:_
   `Standard.Base.Metadata.Column_Kind.Column_Kind` and
   `Standard.Base.Metadata.Widget_Columns.Widget_Columns` (one module each,
   under `Base/src/Metadata/`, beside `Widget_Query.enso`), not exported from
   `Standard.Base`'s `Main` (as `Widget` is not).

## Shared files (parallel with PRs 3b and 4)

| File                                      | 3b                                                     | 4                             | 5a                                                | Avoiding conflicts                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Base/…/src/Metadata.enso`                | constructors after `Secret_Browse`; conversions at end | `Union` after `Any_To_Target` | pickers after `With_JSON_Cache`; `column_sources` | Each PR adds its constructors and `to_json` branches at its own anchor; whoever merges second rebases and keeps both (no line is edited by two PRs). |
| `Base/…/docs/api/Metadata.md` (generated) | yes                                                    | yes                           | yes                                               | Never hand-merge: after a rebase, regenerate (`bin/enso --docs api`) and commit the result.                                                          |
| `test/Base_Tests/src/Metadata_Spec.enso`  | —                                                      | `"Widget to_json"` group      | new group `"Column pickers to_json"`              | Separate groups.                                                                                                                                     |
| `test/Base_Tests/src/Main.enso`           | (3a's `Type_Default_Spec`)                             | —                             | adds `Widget_Columns_Spec`                        | One added line each; trivial rebase.                                                                                                                 |
| `Base/…/CLAUDE.md`                        | group D note                                           | `Widget.Union`                | the pickers                                       | Separate paragraphs.                                                                                                                                 |

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr5a`, branch
  `widgets/pr5a-widget-columns`, from `origin/develop`. Linux clone
  `~/enso-widgets-pr5a` on WSL `Ubuntu-24.04` (source `~/.enso-toolchain.sh`);
  helper `~/pr5a.sh` = `~/pr1b.sh` from the PR 1b plan ("Working environment")
  with `WIN=/mnt/c/Repos/Enso/ide-widgets-pr5a`, `LNX=$HOME/enso-widgets-pr5a`
  and the exclude `--exclude=.git`. Check `df -h ~` and `E:` first. Delete the
  worktree, clone and script when the PR merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree.
- **Behaviour-preserving.** Every existing annotation gives exactly the JSON it
  gave before; an answer with no picker in it has no `columns` field. No GUI
  file changes.
- **Changelog: none.** Open the PR with the `CI: No changelog needed` label.
- `Widget_Columns.from` reads **only the schema**: never rows, never a query.
- No `Widget.from (that : Any)` and no `Widget_Columns.from (that : Any)`.
- Avoid `Vector` allocation where a direct lookup works (owner rule): build the
  three vectors of `Widget_Columns` in one pass; no `to_vector`/`take` copies.
- `sbt "all lintEnso"` stays green (`-Werror`). Regenerate the API docs of every
  changed library and run
  `corepack pnpm --filter build-scripts run stdlib-api-check`.
- Stdlib suites only against a full distribution (`buildEngineDistribution`);
  check each run's `N tests succeeded.` line (a filter matching nothing exits
  0).
- Merge on green (an invisible change; the owner's installer test is for 5b).

## The JSON

```
Widget_Columns   {"names":["A","B"],"kinds":["Numeric","Textual"],"type_names":["Integer","Char"]}
Column_Name      {"constructor":"Column_Name","kinds":[],"from":null,"expression":false,"reference":false,"extra":[],"columns_first":false}
Column_Names     {"constructor":"Column_Names","kinds":[],"from":null,"regex":false,"by_type":false}
Column_Vector    {"constructor":"Column_Vector","kinds":[],"from":null}
Order_By         {"constructor":"Order_By","from":null,"name_only":false}
answer           {"arguments":[…],"columns":{"":{…},"right":{…}}}
```

`kinds` are `Column_Kind` constructor names; `extra` is a list of
`Choice.to_json`; `from: null` is the call's subject (key `""` in `columns`).
`columns` is present only when at least one widget in the answer names a source,
and holds only sources whose value converts (an unset argument, or one without a
conversion, is absent; the GUI then falls back, 5b).

## File Structure

- Create
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Column_Kind.enso`.
- Create
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Columns.enso`.
- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`: the four
  constructors, their `to_json`, `Widget.column_sources`.
- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`: the
  `columns` block.
- Modify `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`, `Row.enso`,
  `Internal/In_Memory_Table_Implementation.enso`, `Internal/Viz_Helpers.enso`;
  create `Internal/Column_Kinds.enso`.
- Modify
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso`,
  `Internal/SQL_Type_Reference.enso`.
- Modify
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Column_Kind.enso`
  (delete `Viz_Kind`), `Scatter_Plot.enso` only if it names `Viz_Kind` (it uses
  `is_numeric` / `is_date_or_time`, which stay).
- Tests: `test/Base_Tests/src/Metadata_Spec.enso`, new
  `test/Base_Tests/src/Widget_Columns_Spec.enso` (+ `Main.enso`),
  `test/Base_Tests/src/Widget_Query_Spec.enso`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`,
  `test/Visualization_Tests/src/Viz_Table_Spec.enso`,
  `test/Visualization_Tests/src/Table_Conversions_Spec.enso`.
- Regenerate `docs/api/*.md` of Base, Table, Database, Visualization.
- Modify `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`,
  `distribution/lib/Standard/Table/0.0.0-dev/CLAUDE.md` (create from the
  project-structure skill if missing).

---

## Task 1: `Column_Kind` in Base; `Viz_Kind` goes

**Files:**

- Create:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Column_Kind.enso`
- Create:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Column_Kinds.enso`
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Viz_Helpers.enso`
  (import at line 8; `column_kind` lines 18-27)
- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Column_Kind.enso`
  (`type Viz_Kind` lines 9-37 deleted; `Viz_Column_Kind.Value (kind : Viz_Kind)`
  line 48, `is_numeric` 53, `is_date_or_time` 58-59, `infer` 66-76)
- Test: `test/Visualization_Tests/src/Viz_Table_Spec.enso` (lines 4, 23, 55-58),
  `test/Visualization_Tests/src/Table_Conversions_Spec.enso` (lines 12, 24), new
  `test/Base_Tests/src/Widget_Columns_Spec.enso`

**Interfaces:**

- Produces:

```enso
## Standard.Base.Metadata.Column_Kind
type Column_Kind
    Numeric
    Textual
    Logical
    Date_Only
    Date_And_Time
    Time_Only
    Other

    ## The kind of one value held in memory; `Nothing` is `Other`.
    of_value value -> Column_Kind

    ## `'"Numeric"'` etc.: the constructor's name as a JSON string.
    to_json self -> Text
```

and, in Table,
`Column_Kinds.of_value_type (value_type : Value_Type) -> Column_Kind` (the
mapping `Viz_Helpers.column_kind` has today: numeric → `Numeric`, text →
`Textual`, boolean → `Logical`, `Date` → `Date_Only`, `Date_Time _` →
`Date_And_Time`, `Time` → `Time_Only`, else `Other`).

- [ ] **Step 1: Failing tests.** New
      `test/Base_Tests/src/Widget_Columns_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Metadata.Column_Kind.Column_Kind

from Standard.Test import all

add_specs suite_builder =
    suite_builder.group "Column_Kind" group_builder->
        group_builder.specify "of a value held in memory" <|
            Column_Kind.of_value 1 . should_equal Column_Kind.Numeric
            Column_Kind.of_value 1.5 . should_equal Column_Kind.Numeric
            Column_Kind.of_value "a" . should_equal Column_Kind.Textual
            Column_Kind.of_value True . should_equal Column_Kind.Logical
            Column_Kind.of_value (Date.new 2020) . should_equal Column_Kind.Date_Only
            Column_Kind.of_value (Date_Time.new 2020) . should_equal Column_Kind.Date_And_Time
            Column_Kind.of_value (Time_Of_Day.new 12) . should_equal Column_Kind.Time_Only
            Column_Kind.of_value Nothing . should_equal Column_Kind.Other
            Column_Kind.of_value [1] . should_equal Column_Kind.Other

        group_builder.specify "as JSON is its name" <|
            Column_Kind.Date_And_Time.to_json . should_equal '"Date_And_Time"'

main filter=Nothing =
    suite = Test.build suite_builder-> add_specs suite_builder
    suite.run_with_filter filter
```

Register it in `test/Base_Tests/src/Main.enso` (import beside
`Type_Default_Spec`, line 98; `Widget_Columns_Spec.add_specs suite_builder`
beside line 190). In the two Visualization specs replace
`from Standard.Visualization.Viz_Column_Kind import Viz_Kind` with
`import Standard.Base.Metadata.Column_Kind.Column_Kind` and every `Viz_Kind.`
with `Column_Kind.` (their expectations do not otherwise change).

- [ ] **Step 2: Run, verify they fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr5a.sh dist && ~/pr5a.sh enso_test Base_Tests "Column_Kind" 2>&1 | tail -15; ~/pr5a.sh enso_test Visualization_Tests 2>&1 | grep -E "tests (succeeded|failed)|Compile error" | head'
```

Expected: `Column_Kind` cannot be found.

- [ ] **Step 3: Implement.**
  - `Column_Kind.enso`: the type with `private: true`-less constructors (public:
    library annotations name them, `kinds=[Column_Kind.Numeric]`), each with a
    one-line doc; `of_value` a `case value of` over `_ : Integer`, `_ : Float`
    (and `_ : Number` for `Decimal`), `_ : Text`, `_ : Boolean`, `_ : Date_Time`
    before `_ : Date`, `_ : Time_Of_Day`, `_ -> Other`;
    `to_json self = (Meta.meta self . constructor . name).to_json`.
  - `Viz_Column_Kind.enso`: delete `type Viz_Kind`; import
    `Standard.Base.Metadata.Column_Kind.Column_Kind`;
    `Value (kind : Column_Kind) (display_name : Text)`;
    `is_numeric`/`is_date_or_time` compare with `Column_Kind.*`; `infer` keeps
    its display names ("Integer", "Float", "Char"…) and uses `Column_Kind.*`.
  - Table `Internal/Column_Kinds.enso`: `of_value_type` (moved from
    `Viz_Helpers.column_kind`'s `kind` expression); `Viz_Helpers.column_kind`
    becomes
    `Viz_Column_Kind.Value (Column_Kinds.of_value_type value_type) value_type.to_name`
    and drops the `Viz_Kind` import.
  - `git grep -n Viz_Kind -- distribution test app` must print nothing but
    generated docs, which Step 5 regenerates.

- [ ] **Step 4: Run, verify they pass**: `Base_Tests` and `Visualization_Tests`
      in full, `sbt "all lintEnso"`.

- [ ] **Step 5: Regenerate API docs** (Base, Table, Visualization) and run
      `stdlib-api-check` (the commands of the PR 4 plan's Task 1 Step 5, with
      this clone).

- [ ] **Step 6: Commit**

```bash
git commit -m "Column_Kind in Base replaces Visualization's Viz_Kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: `Widget_Columns` and the Table and Row conversions

**Files:**

- Create:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Columns.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso` (add the
  conversion near the other conversions at the end, e.g. after
  `Viz_Cell.from (that:Table)` line 4137)
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Table_Implementation.enso`
  (beside `column_names`, line 479)
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso`
  (beside `column_names`, line 475)
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/SQL_Type_Reference.enso`
  (after `get`, line 40)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Row.enso` (after
  `Viz_Table.from (that:Row)`, line 150)
- Test: `test/Base_Tests/src/Widget_Columns_Spec.enso`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`

**Interfaces:**

- Produces:

```enso
## Standard.Base.Metadata.Widget_Columns
type Widget_Columns
    Value (names : Vector Text) (kinds : Vector Column_Kind) (type_names : Vector Text)
    to_json self -> Text      # '{"names":[…],"kinds":[…],"type_names":[…]}'

Widget_Columns.from (that : Table) -> Widget_Columns     # Table.enso
Widget_Columns.from (that : Row) -> Widget_Columns       # Row.enso: kinds from the values, type_names ""
SQL_Type_Reference.known self -> SQL_Type | Nothing      # never queries
```

The `Table` conversion calls
`that.implementation.widget_columns that.underlying` (the dispatch every `Table`
method uses, `column_names` at `Table.enso:2871`). In memory: one pass over
`columns`, `Column_Kinds.of_value_type c.value_type` and `c.value_type.to_name`.
In a database: one pass over `internal_columns`; `ref.known` →
`connection.type_mapping.sql_type_to_value_type` → kind and name; `Nothing` →
`Column_Kind.Other` and `""`.

- [ ] **Step 1: Failing tests.**

`Widget_Columns_Spec.enso` (Base: JSON only):

```enso
    suite_builder.group "Widget_Columns" group_builder->
        group_builder.specify "as JSON" <|
            columns = Widget_Columns.Value ["A", 'B "C"'] [Column_Kind.Numeric, Column_Kind.Other] ["Integer", ""]
            columns.to_json . should_equal '{"names":["A","B \\"C\\""],"kinds":["Numeric","Other"],"type_names":["Integer",""]}'
```

`Table_Widgets_Spec.enso`, a new group:

```enso
    suite_builder.group "Widget_Columns.from" group_builder->
        group_builder.specify "an in-memory table: names, kinds and Value_Type names, in order" <|
            t = Table.new [["i", [1, 2]], ["f", [1.5, 2]], ["s", ["a", "b"]], ["b", [True, False]], ["d", [Date.new 2020, Date.new 2021]], ["m", [1, "a"]]]
            columns = Widget_Columns.from t
            columns.names . should_equal ["i", "f", "s", "b", "d", "m"]
            columns.kinds . should_equal [Column_Kind.Numeric, Column_Kind.Numeric, Column_Kind.Textual, Column_Kind.Logical, Column_Kind.Date_Only, Column_Kind.Other]
            columns.type_names . should_equal ["Integer", "Float", "Char", "Boolean", "Date", "Mixed"]

        group_builder.specify "a row: names, kinds from its values" <|
            row = (Table.new [["i", [1]], ["s", ["a"]]]).rows.first
            columns = Widget_Columns.from row
            columns.names . should_equal ["i", "s"]
            columns.kinds . should_equal [Column_Kind.Numeric, Column_Kind.Textual]

        group_builder.specify "a recomputed table with the same schema converts equal" <|
            t1 = Table.new [["a", [1]], ["b", ["x"]]]
            t2 = t1.set (t1.at "a" + 1) as="a"
            (Widget_Columns.from t1) . should_equal (Widget_Columns.from t2)
```

(Check the `type_names` row against `Value_Type.to_name` for each type before
asserting; `Float` may print as `Float` — use what `to_name` gives.)

`SQLite_Tests/src/Widgets_Spec.enso`, a new group:

```enso
    suite_builder.group "Widget_Columns.from a database table" group_builder->
        group_builder.specify "reads the known schema and makes no query" <|
            connection = Database.connect (SQLite.In_Memory)
            t = (Table.new [["a", [1, 2]], ["b", ["x", "y"]]]).select_into_database_table connection "wc" temporary=True
            computed = t.set (expr "[a] + 1") as="c"
            log = File.create_temporary_file "widget_columns_sql" ".log"
            columns = Test_Environment.unsafe_with_environment_override "ENSO_SQL_LOG_PATH" log.path <|
                Widget_Columns.from computed
            columns.names . should_equal ["a", "b", "c"]
            columns.kinds.take 2 . should_equal [Column_Kind.Numeric, Column_Kind.Textual]
            (log.exists.not || log.read . is_empty) . should_be_true
```

(Use the imports the file already has for `Database`, `SQLite`, `expr`; add
`import Standard.Test.Test_Environment` and the two Metadata imports. If the
computed column `c`'s type is already known after `set`, its kind is `Numeric`;
if not, `Other` — assert only the first two and the empty log.)

- [ ] **Step 2: Run, verify they fail** (`Base_Tests "Widget_Columns"`,
      `Table_Tests "Widget_Columns.from"`, `SQLite_Tests "Widget_Columns"`).

- [ ] **Step 3: Implement** per Interfaces. `SQL_Type_Reference.known`:

```enso
    ## ---
       private: true
       ---
       The SQL type if it is already known, without querying: `Nothing` for a
       type the database has not been asked for yet.
    known self -> SQL_Type | Nothing = case self of
        SQL_Type_Reference.Computed_By_Database ref -> case ref.get of
            t : SQL_Type -> t
            _ -> Nothing
        SQL_Type_Reference.Overridden value -> value
        SQL_Type_Reference.Null -> Nothing
```

Build the three vectors with `Vector.build` in one loop over the columns.
Conversions carry `private: true` front matter and a one-line doc, as 3a's
`Widget.from` conversions do.

- [ ] **Step 4: Run, verify they pass**; the three suites in full;
      `sbt "all lintEnso"`.

- [ ] **Step 5: Commit**
      `Widget_Columns: a table's column names, kinds and type names, from its schema`.

## Task 3: The declarative pickers

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso` (imports;
  constructors after `With_JSON_Cache`, line 124; `to_json` branches before the
  `_ ->` fallback, line 157; new method `column_sources`)
- Test: `test/Base_Tests/src/Metadata_Spec.enso` (new group
  `"Column pickers to_json"`)

**Interfaces:**

- Produces: the four constructors with the fields of owner decision 5; JSON as
  in "The JSON"; `Widget.column_sources self -> Vector (Text | Nothing)`: the
  distinct `from` values of every picker in the widget, recursing through
  `Single_Choice`/`Multiple_Choice` values (`Choice.parameters`, nested value
  vectors), `Vector_Editor.item_editor`, `With_JSON_Cache.parent` and, once PR 4
  is in, `Union.kinds`.

- [ ] **Step 1: Failing tests** (`Metadata_Spec.enso`):

```enso
    suite_builder.group "Column pickers to_json" group_builder->
        group_builder.specify "Column_Name with its defaults" <|
            Widget.Column_Name . to_json . should_equal '{"constructor":"Column_Name","kinds":[],"from":null,"expression":false,"reference":false,"extra":[],"columns_first":false}'

        group_builder.specify "Column_Name with kinds, a source and extras" <|
            w = Widget.Column_Name kinds=[Column_Kind.Numeric] from="right" reference=True extra=[Choice.Option "<Nothing>" "Nothing"]
            json = w.to_json . parse_json
            json.get "kinds" . should_equal ["Numeric"]
            json.get "from" . should_equal "right"
            json.get "reference" . should_be_true
            json.get "extra" . first . get "value" . should_equal "Nothing"

        group_builder.specify "Column_Names, Column_Vector and Order_By" <|
            Widget.Column_Names regex=True . to_json . should_equal '{"constructor":"Column_Names","kinds":[],"from":null,"regex":true,"by_type":false}'
            Widget.Column_Vector . to_json . should_equal '{"constructor":"Column_Vector","kinds":[],"from":null}'
            Widget.Order_By name_only=True . to_json . should_equal '{"constructor":"Order_By","from":null,"name_only":true}'

        group_builder.specify "column_sources finds pickers at any depth, once each" <|
            nested = Widget.Single_Choice [Choice.Option "Equals" "..Equals" [["left", Widget.Column_Name], ["right", Widget.Column_Name from="right"]]]
            editor = Widget.Vector_Editor item_editor=nested item_default="_"
            editor.column_sources . should_equal [Nothing, "right"]
            (Widget.Vector_Editor item_editor=Widget.Column_Name item_default="_").column_sources . should_equal [Nothing]
            Widget.Text_Input.column_sources . should_equal []
```

(Owner decision 4 is pinned in Task 4, where a real annotation
`@column (Widget.Column_Name)` is resolved through `resolve_call`. To check
whether `..Column_Name` could work instead, add there one throwaway method
annotated `@column ..Column_Name`, run, and report what `resolve_call` answers;
delete it before committing.)

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement.** Import `project.Metadata.Column_Kind.Column_Kind`
      (no cycle: `Column_Kind.enso` imports nothing from `Metadata`). Each
      constructor with a doc comment listing its fields (as `Text_Input`'s at
      lines 102-106). `to_json` branches build the JSON literally
      (`kinds.map .to_json`, `from` → `null` or `from.to_json`,
      `extra.map .to_json`), in the field order of "The JSON". `column_sources`:
      a private recursive helper that appends into a `Vector.build` builder only
      when the source is not yet in it (a picker list is short; no intermediate
      vectors).

- [ ] **Step 4: Run, verify they pass**; `Base_Tests` in full; lint.

- [ ] **Step 5: Commit**
      `Declarative column pickers: Column_Name, Column_Names, Column_Vector, Order_By`.

## Task 4: `resolve_call` sends the column lists once

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`
  (`resolve_call` lines 62-75; `Argument_Result` lines 227-246; new private
  `_columns_json`)
- Test: `test/Base_Tests/src/Widget_Query_Spec.enso` (new group
  `"Widget_Query.resolve_call sends each column list once"`),
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`

**Interfaces:**

- Consumes: `Widget.column_sources` (Task 3), `Widget_Columns.from` (Task 2),
  `_cache_from uuids` (line 300: looks an argument's value up by name).
- Produces: the answer `{"arguments":[…],"columns":{…}}` described in "The
  JSON"; unchanged (`{"arguments":[…]}`) when no resolved widget names a source.

- [ ] **Step 1: Failing tests.** In `Widget_Query_Spec.enso`, define in the spec
      file a test-local table-like type and methods annotated with pickers:

```enso
type Fake_Table
    Value names:(Vector Text)

    @column (Widget.Column_Name)
    @other (Widget.Column_Name from="other")
    pick self column other = [column, other]

    @column Widget.Text_Input
    plain self column = column

Widget_Columns.from (that : Fake_Table) = Widget_Columns.Value that.names (that.names.map _-> Column_Kind.Other) (that.names.map _-> "")
```

```enso
    suite_builder.group "Widget_Query.resolve_call sends each column list once" group_builder->
        fake_type = spec_module + ".Fake_Table"

        group_builder.specify "the subject's columns, keyed by the empty source" <|
            json = Widget_Query.resolve_call (Fake_Table.Value ["A", "B"]) spec_module fake_type "pick" ["column"] . parse_json
            json.get "columns" . get "" . get "names" . should_equal ["A", "B"]
            json.get "arguments" . first . second . get "widget" . get "constructor" . should_equal "Column_Name"

        group_builder.specify "another argument's columns, by its name" <|
            mock_cache name = if name == "other" then Fake_Table.Value ["X"] else Nothing
            json = Widget_Query.columns_json [Nothing, "other"] (Fake_Table.Value ["A"]) mock_cache
            json . should_equal ',"columns":{"":{"names":["A"],"kinds":["Other"],"type_names":[""]},"other":{"names":["X"],"kinds":["Other"],"type_names":[""]}}'

        group_builder.specify "a source that is not set is absent" <|
            Widget_Query.columns_json ["other"] (Fake_Table.Value ["A"]) (_-> Nothing) . should_equal ""

        group_builder.specify "no picker, no columns field" <|
            Widget_Query.resolve_call (Fake_Table.Value ["A"]) spec_module fake_type "plain" ["column"] . should_equal '{"arguments":[["column",{"widget":{"constructor":"Text_Input"}}]]}'

        group_builder.specify "a source without a conversion is absent" <|
            Widget_Query.columns_json [Nothing] 42 (_-> Nothing) . should_equal ""
```

`spec_module` (`"enso_dev.Base_Tests.Widget_Query_Spec"`, line 16) is the file's
own constant. `columns_json` is exposed with `private: true` front matter for
the tests, as `resolve_type_argument` is (line 105).

In `Table_Widgets_Spec.enso`, an end-to-end check against a real `Table` with a
test-local extension method annotated with `(Widget.Column_Names)`:

```enso
@columns (Widget.Column_Names)
Table.widget_test_pick self columns = columns
```

```enso
        group_builder.specify "a Table's answer carries its columns once" <|
            t = Table.new [["a", [1]], ["b", ["x"]]]
            json = Widget_Query.resolve_call t "enso_dev.Table_Tests.In_Memory.Table_Widgets_Spec" "Standard.Table.Table.Table" "widget_test_pick" ["columns"] . parse_json
            json.get "columns" . get "" . get "kinds" . should_equal ["Numeric", "Textual"]
```

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement.** Add
      `columns_json (sources : Vector) subject (cache : Function) -> Text` (`""`
      or `',"columns":{…}'`). In `resolve_call`, after `entries` (line 69), from
      the `Argument_Result.Resolved widget _` results collect
      `widget.column_sources` (distinct, in first-seen order), call
      `columns_json`, and append its text before the closing `}`. In
      `columns_json`, for each source:
      `value = if source.is_nothing then subject else cache source`; skip
      `Nothing`, errors and values whose `Widget_Columns.from value` fails
      (catch `No_Such_Conversion` and any dataflow error; a panic in a
      conversion is logged with `log_failure` at step `"columns"` and the source
      skipped). Emit `,"columns":{` + `"<source or empty>":<json>` + `}` only
      when at least one source was converted. Keep the error-subject short cut
      (`_no_widgets`) unchanged.

- [ ] **Step 4: Run, verify they pass**; `Base_Tests`, `Table_Tests`,
      `SQLite_Tests` in full; lint; regenerate API docs; `stdlib-api-check`.

- [ ] **Step 5: Commit**
      `Widget_Query: send each column list a widget names once`.

## Task 5: Docs, PR

- [ ] **Step 1: Docs.** Base `CLAUDE.md`: `Column_Kind`, `Widget_Columns` (read
      only the schema; a table-like type in another library adds its own
      `Widget_Columns.from`), the four pickers and their flags, the `columns`
      block. Table `CLAUDE.md`: `Column_Kinds.of_value_type`; the database
      never-query rule (`SQL_Type_Reference.known`).
- [ ] **Step 2: Verify**:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr5a.sh dist && for s in Base_Tests Table_Tests SQLite_Tests Visualization_Tests Geo_Tests; do echo "== $s"; ~/pr5a.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done; ~/pr5a.sh sbt_run "all lintEnso"; cd ~/enso-widgets-pr5a && corepack pnpm --filter build-scripts run stdlib-api-check'
```

- [ ] **Step 3: PR** with the `CI: No changelog needed` label; body: the JSON,
      the owner decisions taken, "no annotation uses the pickers yet (PR 5b)".
      Merge on green (`gh pr merge --squash`, no `--delete-branch`); then remove
      the worktree, branch, clone and `~/pr5a.sh`.
