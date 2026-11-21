# Widgets PR 6a: Resolvers With Declared Dependencies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A widget that depends on the user's input says so in its signature: a
resolver's parameters are the call's subject, the arguments of the call it
reads, by name, and `search`. `Widget_Query.resolve_call` reads those
parameters, passes each declared argument's value (and the search text), and
tells the IDE what each dynamic argument depends on
(`{"widget":…,"resolver":{"dependencies":[…],"searchable":…}}`). Every widget
helper that reads `cache` is rewritten as a resolver, group C's
`default_widget`s become `Widget.from` conversions returning a
`Widget.Resolver`, the database table-name pickers become searchable, and
`cache`, `_with_table_cache`, `_table_key`, `TableValueCache`'s widget use and
`Widget.With_JSON_Cache` are deleted. A compiler lint fails the standard library
build on a resolver parameter that is none of the three. Today's GUI keeps
working unchanged; PR 6b makes it re-query only on a declared dependency.

**Architecture:** A resolver is a function. Its first open parameter receives
the call's subject; every other open parameter is a dependency: the name of an
argument of the annotated method, defaulted to `Nothing`, or
`search : Text = ""`. `Widget_Resolver.signature_of f` reads the open parameters
with `Meta.meta f . arguments pending=True defaulted=True` (pre-applied ones are
configuration, not dependencies) and `Widget_Resolver.check` compares them with
the method's argument names, which a new engine builtin,
`Meta.get_method_argument_names`, gives exactly. `resolve_call` looks each
dependency's value up by expression id (`Runtime.value_for_uuid`, as `cache`
did), skips the resolver when one is an error (`"unavailable"`), applies the
function positionally (subject, then each dependency's value or `Nothing`, and
the search text), and times the run (a run over 10 s is logged at Warning). A
type whose default needs the subject returns `Widget.Resolver f` from its
`Widget.from` conversion. The same rule is checked statically by a new lint
pass, `ResolverSignatureCheck`, beside `ArgumentDisplayCheck`, which `lintEnso`
runs with `-Werror`.

**Tech Stack:** Enso (Base, Table, Database, DuckDB, AWS, Tableau, Google,
Microsoft), Java (engine runtime builtin, compiler lint pass), JUnit, the stdlib
test suites, the Enso benchmark harness.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§2
group C; §3 "Resolvers: widgets that depend on input"; §6 "Queries, caching and
performance" — entry points, argument values, time limits, schema-keyed cache,
targets; §8 "Query plumbing and the import"; PR table row 6, split into 6a and
6b by owner decision 1).

**Depends on:** PR 5b
(`docs/superpowers/plans/2026-11-21-widgets-pr5b-column-pickers.md`) merged (and
so 5a). PR 4 (#917) merged or not: nothing here needs it (see "Interfaces
assumed"). **Start after 5b merges**, from `origin/develop` at or after its
merge commit.

**Followed by:** PR 6b
(`docs/superpowers/plans/2026-11-21-widgets-pr6b-resolvers-gui.md`): the GUI
re-queries only on a declared dependency or `search`, falls back with a note or
a loading marker, and has the search box.

## Owner decisions

**Decided 2026-11-21 (owner)**, shared with PR 6b (the numbers are the same in
both plans):

1. **PR 6 is split into 6a (engine and libraries) and 6b (GUI).**
   - **6a:** resolvers with declared dependencies (`self`, named call arguments,
     `search`) in `Widget_Query.resolve_call`; the answer shape
     `{resolver: dependencies, searchable}`; group C conversions returning
     `Widget.Resolver`; every remaining `cache` helper migrated; deleted:
     `cache`, `_with_table_cache`, `_table_key`, `TableValueCache`'s widget use,
     `With_JSON_Cache` and `Standard.Visualization.Widgets`.
   - **6b:** re-query only when a declared dependency or `search` changes; a
     dependency that is an error falls back to the type default with a note; the
     2 s time-box with a loading marker; the `search` box.
2. **`search`:** built end to end with ONE real user, the database table-name
   pickers, DuckDB first. Redshift and Hyper only if they fit the same shape
   cheaply, otherwise follow-ups (decision E below). Debounce 250 ms, latest
   wins (6b). A resolver without `search` returns its full list and the GUI
   filters locally.
3. **Slow resolvers:** time-boxed at 2 s in the GUI (6b): after that the
   argument shows its fallback (the type default) with a loading marker, and the
   result replaces it when it arrives; the run is not cancelled. A run over 10 s
   is logged at Warning (engine, this PR, Task 4).
4. **The resolver rule is enforced in the standard library build:** a resolver
   whose parameter is not the subject, a named argument of the call, or `search`
   fails the build (Task 5 writes the lint pass, Task 9 switches it on in
   `lintEnso`), and at run time it is reported as the widget's error (Task 4,
   step `"resolver"`).

**The 6a / 6b question (owner decision 1 asked for a recommendation):**
_Recommended: 6a is backward compatible with today's GUI, so 6a and 6b merge
independently._ Every change to the answer is additive and today's GUI ignores
what it does not know: its zod objects strip unknown keys, so
`{"widget":W,"resolver":{…}}` parses as `{"widget":W}`, and
`{"widget":null,"resolver":{…},"unavailable":{…}}` as "no widget" (the GUI then
uses the type default, as for any `null`). `resolve_call`'s new parameters
(`search`, `type_defaults`, `revision`) are defaulted and come after today's
seven, which today's GUI passes positionally. Today's GUI sends every argument's
expression id and re-queries on every change of the node, so a resolver always
sees current values and `search` is `""` (the full list). `resolve_type` for a
group C type answers `{"widget":null,"resolver":{…}}`, which today's GUI reads
as "no default" without a schema-mismatch report, and every group C argument
keeps an annotation in 6a. So 6a is shippable alone (its installer behaves as
today), and 6b can be reviewed against a merged engine. Merging back to back
would couple two long CI runs and two owner tests for no gain. Task 10 pins the
compatibility with a GUI unit test on today's schema.

**Open decisions (owner), with a recommendation each:**

- **A. How the subject is spelled.** The spec writes the subject parameter as
  `self` (`_join_on_widget self (right …)`). Enso forbids that in a module
  function, where every widget helper lives: compiling
  `modfn self (right = Nothing) = …` at the top of a module gives
  `error: Self argument cannot be used in static methods` (checked 2026-11-21 on
  the WSL build). A method of the subject's type could take `self`, but an
  instance method cannot be referenced as a function value without applying it
  (`Tbl.res` raises `No_Such_Method`), so an annotation cannot name it.
  _Recommended: the resolver's **first** open parameter receives the subject,
  under any name_ (`table`, `connection`, `self` in a lambda), which is how all
  ~150 function annotations take it today; it is reported as `"self"` in
  `dependencies`. The owner's rule (decision 4) then reads "a parameter after
  the first that is not a named argument of the call or `search` is an error".
  Alternative: the subject must be named `self_arg` (the convention of the
  Google and Azure helpers), and every helper's first parameter is renamed.
- **B. Configuration parameters and defaults.** Helpers such as
  `make_table_name_selector connection add_custom:Boolean=True` leave a
  defaulted parameter open, which the rule would read as a dependency on an
  argument `add_custom` that does not exist. And Enso cannot apply an argument
  by a name held in a `Text`, so `resolve_call` passes dependencies
  positionally. _Recommended:_ (i) a configuration parameter is pre-applied in
  the annotation (`@query (make_table_name_selector add_custom=True)`; a
  pre-applied argument is not listed by `Meta.meta f . arguments`), and the
  lint's message says so; (ii) **every dependency parameter defaults to
  `Nothing`** (the spec already says "resolvers are written for `Nothing`"), so
  passing `Nothing` positionally for a dependency with no value is exactly the
  default; the lint checks the default. Alternative: an engine builtin that
  applies arguments by name, and configuration parameters exempt when no
  argument has their name (which would let a misspelt dependency pass).
- **C. Where the check runs.** _Recommended: a compiler lint pass,
  `ResolverSignatureCheck`_ (`Warning.ResolverSignature`), beside
  `ArgumentDisplayCheck`, so `lintEnso -Werror` (the standard library build)
  fails on it, with a JUnit test. It finds every resolver by walking each
  method's argument annotations in the IR (the same annotations the suggestion
  builder lists for the IDE) and resolves an annotation's head the way the
  compiler resolves names (`BindingsMap`); a head it cannot resolve to a method
  or a lambda (a computed function) is itself a warning ("write a resolver as a
  lambda or a reference to a method"). Plus the run-time check in `resolve_call`
  (decision 4) for user libraries. Alternative: an Enso test that sweeps every
  standard library method through `resolve_call` (complete only if the sweep
  enumerates every module, which nothing in Base can do today).
- **D. Resolver type defaults and the call's arguments.** A group C type default
  is used by every method with an argument of that type, so its dependencies
  cannot be checked against one method. _Recommended:_ for a type default
  resolver, a dependency that the call does not have is passed `Nothing` without
  an error (the Google defaults read `credentials`, which every method using
  them has); the lint checks only annotations.
- **E. Who else gets `search`.** DuckDB's table-name pickers are the shared
  Database helpers `make_table_name_selector` and
  `make_table_name_with_schema_selector`
  (`Database/…/Connection/Connection.enso:635,644`), which every JDBC connection
  uses (SQLite, Postgres, Snowflake, SQL Server, Redshift, DuckDB), and
  `Connection.tables` already takes `name_like` (line 182). _Recommended: add
  `search` to the two shared helpers_, so Redshift (which uses
  `make_table_name_with_schema_selector`) gets it at no extra cost; tests on
  DuckDB and SQLite (local), and Postgres in its CI job. **Hyper is a
  follow-up:** `make_table_selector` lists a schema's tables through the Tableau
  reader, which has no name filter, so `search` there would only filter in Enso
  what the GUI already filters locally.

## Interfaces assumed from earlier PRs

Check each exists before Task 1; if a PR renamed one, use its name and say so in
the PR body.

| From                                         | Interface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR 1a/1b (merged, #891)                      | `Widget_Query.resolve_call value module_name type_name method_name argument_names uuids subject_is_type`; `resolve_argument method argument subject cache`; `Argument_Result.Resolved widget json` / `Failed failure`; `Widget_Failure`; `log_failure`; `_cache_from uuids`; `_inputs_key`. `Standard.Visualization.Widgets` **was already deleted by #891** (722582f042): nothing to delete here but stale mentions (Task 11 greps).                                                    |
| PR 3a/3b (merged)                            | `Widget_Query.resolve_type type_name` and `resolve_type_argument`; `Widget.from (that : X.type)` conversions; `test/Base_Tests/src/Type_Default_Spec.enso`.                                                                                                                                                                                                                                                                                                                              |
| PR 5a plan, Tasks 2–4                        | `Widget_Columns`, `Column_Kind`; `Widget.Column_Name` / `Column_Names` / `Column_Vector` / `Order_By` with `from`; `Widget.column_sources self -> Vector (Text \| Nothing)`; `Widget_Query.columns_json sources subject cache` and the answer's `,"columns":{…}`.                                                                                                                                                                                                                        |
| PR 5b plan, Task 4 and the Migration map     | Table's builders emit references; `_with_table_cache` **removed from every helper 5b rewrote** and kept only on `parse_type_selector`, `make_format_chooser_for_type` and `make_fill_nothing_default_widget` (5b decision 9); join's right columns are `Widget.Column_Name from="right"` (so `make_join_condition_selector` no longer reads `cache "right"`, and `_table_key` has no caller left but `_with_table_cache`); YXDB's `_column_widget` deleted (`Column_Name from="table"`). |
| PR 5b plan, Task 7                           | `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso` (with `sort`, `get`, `cross_tab` and the `In_Memory_Recomputed` backend), `Widget_Query_Report.enso`, `test/Table_Tests/src/In_Memory/Widget_Size_Spec.enso`, the SQLite size group; 5b's before/after TSVs in its PR body.                                                                                                                                                                                                        |
| PR 4 plan, Task 1 (only if merged before 6a) | `Widget.Union kinds include_nothing`. `Widget.column_sources` already recurses into it (5a/5b's Shared files). A `Widget.Resolver` inside a `Union`'s kinds is rejected like any nested resolver (Task 2).                                                                                                                                                                                                                                                                               |

## Shared files

PR 6b and later work touch some of the same files; PR 4 may still be open.

| File                                                                        | 4                             | 6a                                                                       | Avoiding conflicts                                                   |
| --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `Base/…/src/Metadata.enso`                                                  | `Union` after `Any_To_Target` | `Resolver` after the pickers; `With_JSON_Cache` and its branches deleted | Different anchors; whoever merges second rebases and keeps both.     |
| `Base/…/docs/api/Metadata.md` and every regenerated `docs/api`              | yes                           | yes                                                                      | Never hand-merge: regenerate (`bin/enso --docs api`) after a rebase. |
| `test/Base_Tests/src/Metadata_Spec.enso`                                    | `"Widget to_json"`            | new group `"Widget.Resolver"`                                            | Separate groups.                                                     |
| `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/…` (Task 10) | —                             | one compatibility test file, new                                         | 6b deletes or rewrites it with the new schema (its Task 1).          |

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr6a`, branch
  `widgets/pr6a-resolvers`, from `origin/develop` after PR 5b merges. Linux
  clone `~/enso-widgets-pr6a` on WSL `Ubuntu-24.04` (source
  `~/.enso-toolchain.sh`); helper `~/pr6a.sh` = `~/pr1b.sh` from the PR 1b plan
  ("Working environment") with `WIN=/mnt/c/Repos/Enso/ide-widgets-pr6a`,
  `LNX=$HOME/enso-widgets-pr6a` and the exclude `--exclude=.git`. Check
  `df -h ~` and `E:` first. Delete the worktree, clone and script when the PR
  merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree. Every commit ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Backward compatible with today's GUI** (see "The 6a / 6b question"): no
  field of today's answer changes meaning; new fields and parameters only. The
  only GUI file this PR adds is the compatibility test (Task 10).
- **Behaviour-preserving for every migrated widget**: with every dependency set
  as today's GUI sets it, each migrated resolver gives the widget the old
  `cache` helper gave (pinned by tests written against the old helper first,
  Tasks 6–8).
- The rule (owner decision 4, decisions A–B): first open parameter = subject;
  every other open parameter is an argument name of the annotated method,
  defaulted to `Nothing`, or `search : Text = ""`.
- No `Widget.from (that : Any)`. A `Widget.Resolver` is only ever an argument's
  whole widget, never nested inside another widget.
- Avoid `Vector` allocation where a direct lookup works (owner rule): read the
  open parameters once per resolver (`Meta.meta … . arguments`); look a
  dependency up by name in the parsed `uuids` object, not by building lists;
  check an argument name with the method's names in one pass.
- **Changelog: none.** Open the PR with the `CI: No changelog needed` label.
- `sbt "all lintEnso"` green (`-Werror`). Regenerate the API docs of every
  changed library and run
  `corepack pnpm --filter build-scripts run stdlib-api-check`.
- Stdlib suites only against a full distribution (`buildEngineDistribution`);
  check each run's `N tests succeeded.` line (a filter matching nothing exits
  0).
- **Verify on Linux** (WSL `Ubuntu-24.04`) for every Enso suite and the engine
  tests; the GUI compatibility test also on Windows.
- **Stop at green CI; do not merge.** The owner merges.

## The JSON

```
argument, static                {"widget":W}                                                          (unchanged)
argument, resolver              {"widget":W,"resolver":{"dependencies":["self","right"],"searchable":false}}
argument, column picker (5a)    {"widget":W,"resolver":{"dependencies":["self"],"searchable":false}}
argument, resolver failed       {"error":{"step":"resolver","message":…},"resolver":{…}}
argument, dependency an error   {"widget":null,"resolver":{…},"unavailable":{"dependency":"right","message":…}}
argument, bad signature         {"error":{"step":"resolver","message":"The resolver's parameter `rihgt` is not an argument of Table.join, nor `search`."}}
resolve_type, resolver default  {"widget":null,"resolver":{"dependencies":["self"],"searchable":false}}
```

- `dependencies` lists `"self"` first when the resolver takes the subject
  (always, by decision A, unless it has no open parameter), then the dependency
  names in parameter order. `search` is never listed; `searchable` says whether
  the resolver declares it.
- A column picker's `dependencies` are its `column_sources`, `""` written
  `"self"`. A widget with pickers from two sources depends on both.
- `"unavailable"` comes with `widget: null`: the GUI uses the argument's type
  default (6b adds the note).
- `step` `"resolver"` joins `"lookup"`, `"annotation"` and `"type_default"`.

`resolve_call`'s signature after this PR (the first seven unchanged):

```enso
resolve_call (value : Any) (module_name : Text) (type_name : Text) (method_name : Text) (argument_names : Vector Text) (uuids : Text = "{}") (subject_is_type : Boolean = False) (search : Text = "") (type_defaults : Text = "{}") (revision : Text = "") -> Text
```

- `uuids` keeps its meaning (argument name → expression id); 6b sends only the
  declared dependencies.
- `search`: the text typed in the argument; passed to every resolver among
  `argument_names` that declares `search` (6b asks one argument at a time while
  searching).
- `type_defaults`: JSON `{argument: type name}` for arguments the GUI wants
  resolved through their type's resolver default when they have no annotation
  (6b; `"{}"` today).
- `revision`: not used by the resolution. 6b changes it when a dependency's
  value changes without its expression changing, so the visualization is
  re-evaluated.
- **Echo:** when `search` or `revision` is not empty, the answer repeats it
  after `arguments`: `{"arguments":[…],"search":"abc","revision":"7"}`. 6b drops
  an answer whose echo is not the latest it asked for (latest wins). With both
  empty the answer is byte-for-byte today's.

## File Structure

- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetMethodArgumentNamesNode.java`
  (beside `GetMethodAnnotationNode.java`).
- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso`
  (builtin stub after line 37), `src/Meta.enso` (public wrapper after
  `get_method_annotation`, line 463).
- Create
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Resolver.enso`:
  `Resolver_Signature`, `signature_of`, `check`, `apply`.
- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`:
  `Widget.Resolver`; `With_JSON_Cache` deleted (Task 11).
- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`.
- Create
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/lint/ResolverSignatureCheck.java`;
  modify `engine/runtime-compiler/src/main/scala/org/enso/compiler/Passes.scala`
  (register it, Task 9) and the `Warning` IR type `ArgumentDisplayCheck` uses
  (add `ResolverSignature`); test
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/ResolverSignatureCheckTest.java`.
- Modify (migration): `Table/…/Internal/Widget_Helpers.enso`, `Table.enso`,
  `Column.enso`, `Simple_Expression.enso`, `Generate_Rows_Range.enso`;
  `Database/…/Connection/Connection.enso`; `DuckDB/…/DuckDB_Connection.enso`,
  `DuckDB_GeoFormat.enso`; `AWS/…/Database/Redshift/Redshift_Connection.enso`;
  `Tableau/…/Hyper_File.enso`; `Google/…/Google_Analytics.enso`,
  `Google_Analytics_Account.enso`, `Google_Analytics_Property.enso`;
  `Microsoft/…/Azure_Credential.enso`, `Azure_Storage.enso`;
  `Base/…/Data/Time/Date.enso`, `Date_Time.enso`; plus every annotation the lint
  reports in Task 9.
- Modify `std-bits/table/src/main/java/org/enso/table/util/TableValueCache.java`
  only if `getOrCompute` loses its last caller (Task 11; the table view keeps
  `get`/`put`).
- Tests: `test/Base_Tests/src/Widget_Resolver_Spec.enso` (new, + `Main.enso`),
  `Widget_Query_Spec.enso`, `Metadata_Spec.enso`, `Type_Default_Spec.enso`,
  `Data/Time/Date_Spec.enso`;
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `Internal/Widget_Helpers_Spec.enso`;
  `test/SQLite_Tests/src/Widgets_Spec.enso`; `test/DuckDB_Tests` (its widgets
  spec, or a new `Widgets_Spec.enso`); `test/AWS_Tests`, `test/Tableau_Tests`,
  `test/Google_Api_Test`, `test/Microsoft_Tests` (their widget checks, offline
  only);
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java`.
- Benchmark: `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso`.
- GUI (compatibility only):
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/resolverAnswerCompat.test.ts`.
- Docs: Base, Table, Database `CLAUDE.md`; `engine/runtime-compiler/CLAUDE.md`
  (the new pass).

---

## Task 1: `Meta.get_method_argument_names`

The run-time check needs the method's argument names; `resolve_call` today knows
only the names it was asked about.

**Files:**

- Create:
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetMethodArgumentNamesNode.java`
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso`
  (after line 37), `distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso`
  (after `get_method_annotation`, line 464)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java`,
  `test/Base_Tests/src/Widget_Query_Spec.enso`

**Interfaces:**

- Produces:

```enso
## The names of the parameters of exactly the method `type_name.method_name`
   defined in `module_name` (looked up as `get_method_annotation` does), `self`
   excluded, in order. A missing module, type or method raises the error
   `get_method_annotation` raises.
Meta.get_method_argument_names (module_name : Text) (type_name : Text) (method_name : Text) -> Vector Text
```

- [ ] **Step 1: Failing tests.** In `MethodLookupTest.java`, beside the
      `get_method_annotation` cases, a module with `type T` and
      `m self a (b = 1) = a`, a static `s x = x`, an extension `T.e self y = y`
      and a module method `f p q = p`: assert `["a", "b"]`, `["x"]`, `["y"]`,
      `["p", "q"]`, and the `No_Such_Method` error for `T.nope`. In
      `Widget_Query_Spec.enso`, a group `"Meta.get_method_argument_names"`:

```enso
        group_builder.specify "lists a method's parameters, self excluded" <|
            Meta.get_method_argument_names spec_module sample_type "two" . should_equal ["first", "second"]
            Meta.get_method_argument_names spec_module spec_module "add_defaults" . should_equal ["a", "b", "c"]
            Meta.get_method_argument_names spec_module sample_type "nope" . should_fail_with No_Such_Method
```

- [ ] **Step 2: Run, verify they fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh sbt_run "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest"'
```

Expected: compile error, the builtin does not exist.

- [ ] **Step 3: Implement.** Copy `GetMethodAnnotationNode`'s lookup (module →
      type or module → the method's `Function`) and return the function's schema
      argument names (`FunctionSchema.getArgumentInfos()`), dropping the first
      when it is `self`, as an Enso `Vector` of `Text`. Register it the way
      `Meta.get_method_annotation` is registered (`@BuiltinMethod`
      `type = "Meta", name = "get_method_argument_names"`). Stub in
      `Meta_Helpers.enso`:
      `get_method_argument_names_builtin module_name type_name method_name = @Builtin_Method "Meta.get_method_argument_names"`;
      public wrapper in `Meta.enso` with the doc above
      (`@Tail_Call Meta_Helpers.get_method_argument_names_builtin …`).
- [ ] **Step 4: Run, verify they pass**; then
      `Base_Tests "get_method_argument_names"` against a rebuilt distribution.
- [ ] **Step 5: Commit**
      `Meta.get_method_argument_names: a method's parameters, looked up exactly`.

## Task 2: `Widget.Resolver` and `Widget_Resolver`

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`
  (constructor after the column pickers; `to_json` branch; `to_text`)
- Create:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Resolver.enso`
- Test: new `test/Base_Tests/src/Widget_Resolver_Spec.enso` (+ register in
  `test/Base_Tests/src/Main.enso` beside `Widget_Columns_Spec`)

**Interfaces:**

- Produces:

```enso
## In Metadata.enso, type Widget:
    ## A widget computed from the call: `function`'s first parameter receives
       the call's subject, every other parameter an argument of the call by
       name (defaulted to `Nothing`) or `search`. Only ever an argument's whole
       widget: nested in another widget, its JSON is an error.
    Resolver function:Function

## Standard.Base.Metadata.Widget_Resolver
type Resolver_Signature
    ## `subject`: the first open parameter's name (`Nothing`: none).
       `dependencies`: the other open parameters but `search`, in order.
       `parameters`: every open parameter, in order (what `apply` fills).
    Value (subject : Text | Nothing) (dependencies : Vector Text) (searchable : Boolean) (parameters : Vector Text)

    ## '{"dependencies":["self",…],"searchable":…}'
    to_json self -> Text

## The signature of a resolver: its open parameters (pending, defaulted;
   pre-applied ones are configuration and not listed).
signature_of (resolver : Function) -> Resolver_Signature

## The first rule violation, or `Nothing`. `call_arguments`: the method's
   argument names (`Nothing`: a type default, decision D, not checked).
check (signature : Resolver_Signature) (call_arguments : Vector Text | Nothing) (method_name : Text) -> Text | Nothing

## Applies the resolver positionally: the subject, then for each other
   parameter `search` or `value_of name` (`Nothing` when unset).
apply (resolver : Function) (signature : Resolver_Signature) subject (value_of : Text -> Any) (search : Text) -> Any
```

- [ ] **Step 1: Failing tests** (`Widget_Resolver_Spec.enso`):

```enso
from Standard.Base import all
import Standard.Base.Metadata.Choice
import Standard.Base.Metadata.Widget
import Standard.Base.Metadata.Widget_Resolver

from Standard.Test import all

on_right table (right = Nothing) (search : Text = "") =
    Widget.Single_Choice [Choice.Option (table.to_text + "|" + right.to_text + "|" + search)]

subject_only table = Widget.Text_Input

configured table (flag : Boolean = False) (right = Nothing) = Widget.Single_Choice [Choice.Option (flag.to_text + right.to_text)]

add_specs suite_builder =
    suite_builder.group "Widget_Resolver.signature_of" group_builder->
        group_builder.specify "the subject, the dependencies in order, search apart" <|
            s = Widget_Resolver.signature_of on_right
            s.subject . should_equal "table"
            s.dependencies . should_equal ["right"]
            s.searchable . should_be_true
            s.parameters . should_equal ["table", "right", "search"]
            s.to_json . should_equal '{"dependencies":["self","right"],"searchable":true}'

        group_builder.specify "a pre-applied configuration parameter is not a dependency" <|
            s = Widget_Resolver.signature_of (configured flag=True)
            s.dependencies . should_equal ["right"]
            s.searchable . should_be_false

        group_builder.specify "a lambda's parameters count the same way" <|
            Widget_Resolver.signature_of (t-> Widget.Text_Input) . subject . should_equal "t"

    suite_builder.group "Widget_Resolver.check" group_builder->
        group_builder.specify "accepts argument names and search" <|
            Widget_Resolver.check (Widget_Resolver.signature_of on_right) ["right", "on"] "Table.join" . should_equal Nothing

        group_builder.specify "names a parameter that is not an argument" <|
            message = Widget_Resolver.check (Widget_Resolver.signature_of on_right) ["on"] "Table.join"
            message . should_equal "The resolver's parameter `right` is not an argument of Table.join, nor `search`."

        group_builder.specify "an open configuration parameter is reported with the fix" <|
            message = Widget_Resolver.check (Widget_Resolver.signature_of configured) ["right"] "T.m"
            message . should_contain "`flag`"
            message . should_contain "pre-apply"

        group_builder.specify "a type default is not checked against a call" <|
            Widget_Resolver.check (Widget_Resolver.signature_of on_right) Nothing "T" . should_equal Nothing

    suite_builder.group "Widget_Resolver.apply" group_builder->
        group_builder.specify "fills the subject, each dependency by name and search" <|
            s = Widget_Resolver.signature_of on_right
            w = Widget_Resolver.apply on_right s "T" (name-> if name == "right" then "R" else Nothing) "se"
            w . should_equal (Widget.Single_Choice [Choice.Option "T|R|se"])

        group_builder.specify "an unset dependency is Nothing, its default" <|
            s = Widget_Resolver.signature_of on_right
            w = Widget_Resolver.apply on_right s "T" (_-> Nothing) ""
            w . should_equal (Widget.Single_Choice [Choice.Option "T|Nothing|"])

    suite_builder.group "Widget.Resolver" group_builder->
        group_builder.specify "cannot be nested in another widget" <|
            nested = Widget.Vector_Editor item_editor=(Widget.Resolver subject_only) item_default="_"
            nested.to_json . should_fail_with Illegal_Argument

main filter=Nothing =
    suite = Test.build suite_builder-> add_specs suite_builder
    suite.run_with_filter filter
```

(`check`'s message for an open defaulted parameter whose name is no argument:
"The resolver's parameter `flag` is not an argument of T.m, nor `search`:
pre-apply it in the annotation (`(resolver flag=…)`) if it is configuration.")

- [ ] **Step 2: Run, verify they fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh dist && ~/pr6a.sh enso_test Base_Tests "Widget_Resolver" 2>&1 | tail -15'
```

- [ ] **Step 3: Implement.**
  - `signature_of`: one call to
    `Meta.meta resolver . arguments pending=True defaulted=True`; walk it once
    with `Vector.build` for `dependencies` (skip the first and `"search"`). An
    empty list gives `Value Nothing [] False []`.
  - `to_json`: `["self"]` first only when `subject` is set; build the text
    directly (`'{"dependencies":[' + … + '],"searchable":' + … + '}'`) without
    an intermediate vector of the names.
  - `check`: for each dependency, `call_arguments.contains name` (the method's
    names are a short vector; `contains` is the direct lookup here). The
    default-is-`Nothing` half of decision B is the lint's (Task 5): Meta does
    not expose defaults.
  - `apply`: fold over `signature.parameters`: the first gets `subject`,
    `"search"` gets `search`, any other `value_of name`; apply positionally
    (`acc value`), so every open parameter is filled in order.
  - `Widget.Resolver`: `to_json` →
    `Error.throw (Illegal_Argument.Error "A Widget.Resolver can only be an argument's whole widget.")`;
    `to_text` → `"Widget.Resolver"`. `Widget.column_sources` gives `[]` for it.
- [ ] **Step 4: Run, verify they pass**; `Base_Tests` in full; lint.
- [ ] **Step 5: Commit**
      `Widget.Resolver and Widget_Resolver: a resolver's signature, check and application`.

## Task 3: `resolve_type` answers a resolver default

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`
  (`resolve_type_argument`, lines 105-114; `Argument_Result`)
- Test: `test/Base_Tests/src/Type_Default_Spec.enso`

**Interfaces:**

- Produces:
  `Argument_Result.Dynamic widget:(Widget | Nothing) json:Text signature:Resolver_Signature unavailable:Text`
  (`unavailable`: `""` or the `,"unavailable":{…}` text), whose `to_json` is
  `{"widget":<json>,"resolver":<signature>[,"unavailable":…]}`, and
  `Argument_Result.Failed failure signature:(Resolver_Signature | Nothing)` (the
  signature, when known, follows the error as `,"resolver":…`). Every existing
  `Argument_Result.Failed f` call gains `Nothing`.
- `resolve_type` of a type whose conversion gives `Widget.Resolver f` answers
  `{"widget":null,"resolver":{…}}`.

- [ ] **Step 1: Failing test.** In `Type_Default_Spec.enso`, a test-local type
      with a resolver default:

```enso
type Needs_Subject
    Value

Widget.from (that : Needs_Subject.type) = Widget.Resolver (table (right = Nothing) -> Widget.Text_Input)
```

```enso
        group_builder.specify "a resolver default is announced, not run" <|
            Widget_Query.resolve_type (spec_module + ".Needs_Subject") . should_equal '{"widget":null,"resolver":{"dependencies":["self","right"],"searchable":false}}'
```

(If a lambda with a defaulted parameter does not parse, write the resolver as a
module function in the spec file; the test is about the answer.)

- [ ] **Step 2: Run, verify it fails** (`Base_Tests "Type_Default"`).
- [ ] **Step 3: Implement** in `resolve_type_argument`: when the conversion's
      result is a `Widget.Resolver f`, return
      `Argument_Result.Dynamic Nothing "null" (Widget_Resolver.signature_of f) ""`.
- [ ] **Step 4: Run** `Base_Tests` in full.
- [ ] **Step 5: Commit**
      `Widget_Query.resolve_type announces a resolver default`.

## Task 4: `resolve_call` runs resolvers with their dependencies

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`
  (`resolve_call` lines 62-75 and its doc; `resolve_argument` lines 127-137;
  `_cache_from` becomes `_values_from`; new private `_run_resolver`,
  `_unavailable_json`, `_picker_signature`)
- Test: `test/Base_Tests/src/Widget_Query_Spec.enso`

**Interfaces:**

- Consumes: Task 1's `Meta.get_method_argument_names`; Task 2's
  `Widget_Resolver.*`; Task 3's `Argument_Result.Dynamic`; 5a's
  `Widget.column_sources` and `columns_json`.
- Produces: the signature and JSON in "The JSON".
  `resolve_argument (method) (argument) subject (value_of : Text -> Any) (search : Text) (call_arguments : Vector Text) (type_default : Text | Nothing) -> Argument_Result`.
  **The legacy `cache` path stays until Task 11**: a function whose open
  parameters contain `cache` is still applied as today (`f cache=… subject`),
  with no `resolver` field, so the libraries keep working while Tasks 6–8
  migrate them one at a time.

Resolution of one argument, in order:

1. The annotation (`Meta.get_method_annotation`). A `Widget` (not a resolver) →
   `Resolved`, plus `resolver` when it has column sources (dependencies `"self"`
   for `Nothing`, otherwise the source name). A `Function` or a
   `Widget.Resolver f` → step 3 with `call_arguments`.
2. No annotation and the argument is in `type_defaults` → `Widget.from` of that
   type; a `Widget.Resolver f` → step 3 with `call_arguments = Nothing`
   (decision D); anything else → the widget, as `resolve_type` would.
3. Signature; `Widget_Resolver.check` → `Failed` at step `"resolver"` with the
   message (and no `resolver` field: the signature is wrong). Each dependency's
   value `value_of name`: the first that `is_error` →
   `Dynamic Nothing "null" signature (_unavailable_json name value)` and an Info
   log (`log_failure`'s dedup key, at Info). Otherwise time
   `Widget_Resolver.apply …` with `System.nano_time` (as
   `Duration.time_execution` does); over 10 s → one Warning ("The resolver of
   `<arg>` of <method> took <n> s."); a result that is not a `Widget` or is an
   error → `Failed … step="resolver"` with the signature; otherwise
   `Dynamic widget json signature ""`.

- [ ] **Step 1: Failing tests** in `Widget_Query_Spec.enso`. New methods on
      `Sample` and module functions (the spec's existing `_choice_of_cache` and
      its test stay until Task 11):

```enso
    @arg _choice_of_other
    of_other self (arg = 0) (other = 0) = arg + other

    @arg _choice_of_search
    searching self (arg = 0) = arg

    @arg _misspelt
    misspelt self (arg = 0) (other = 0) = arg + other

    @arg _slow_choice
    slow self (arg = 0) = arg
```

```enso
private _choice_of_other subject (other = Nothing) -> Widget =
    _ = subject
    Widget.Single_Choice [Choice.Option other.to_text]

private _choice_of_search subject (search : Text = "") -> Widget =
    _ = subject
    Widget.Single_Choice [Choice.Option ("found " + search)]

private _misspelt subject (othr = Nothing) -> Widget =
    _ = [subject, othr]
    Widget.Text_Input
```

```enso
    suite_builder.group "Widget_Query.resolve_call runs resolvers" group_builder->
        resolver_json deps searchable = ',"resolver":{"dependencies":' + deps.to_json + ',"searchable":' + searchable.to_json + '}'

        group_builder.specify "a dependency's value reaches the resolver, and is announced" <|
            values = Widget_Query.values_from_lookup (name-> if name == "other" then 42 else Nothing)
            result = Widget_Query.resolve_argument (method "of_other") "arg" sample values "" ["arg", "other"] Nothing
            result.to_json . should_equal '{"widget":{"constructor":"Single_Choice","values":[{"label":"42","value":"42"}]}' + (resolver_json ["self", "other"] False) + '}'

        group_builder.specify "an unset dependency is Nothing" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "of_other" ["arg"] . parse_json
            json.get "arguments" . first . second . get "widget" . get "values" . first . get "label" . should_equal "Nothing"

        group_builder.specify "search reaches a searchable resolver" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "searching" ["arg"] "{}" False "abc" . parse_json
            result = json.get "arguments" . first . second
            result.get "widget" . get "values" . first . get "label" . should_equal "found abc"
            result.get "resolver" . get "searchable" . should_be_true

        group_builder.specify "a dependency that is an error skips the resolver" <|
            values = Widget_Query.values_from_lookup (_-> Error.throw (Illegal_Argument.Error "bad right"))
            result = Widget_Query.resolve_argument (method "of_other") "arg" sample values "" ["arg", "other"] Nothing
            json = result.to_json . parse_json
            json.get "widget" . should_equal Nothing
            json.get "unavailable" . get "dependency" . should_equal "other"
            json.get "unavailable" . get "message" . should_contain "bad right"

        group_builder.specify "a parameter that is no argument is the widget's error" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "misspelt" ["arg"] . parse_json
            error = json.get "arguments" . first . second . get "error"
            error.get "step" . should_equal "resolver"
            error.get "message" . should_contain "`othr`"

        group_builder.specify "a column picker announces its sources" <|
            ## Uses 5a's Fake_Table in this file: `pick`'s `other` is `Column_Name from="other"`.
            json = Widget_Query.resolve_call (Fake_Table.Value ["A"]) spec_module fake_type "pick" ["column", "other"] . parse_json
            json.get "arguments" . first . second . get "resolver" . get "dependencies" . should_equal ["self"]
            json.get "arguments" . second . second . get "resolver" . get "dependencies" . should_equal ["other"]

        group_builder.specify "search and revision are echoed, only when set" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "searching" ["arg"] "{}" False "abc" "{}" "7" . parse_json
            json.get "search" . should_equal "abc"
            json.get "revision" . should_equal "7"
            Widget_Query.resolve_call sample spec_module sample_type "probe" ["arg"] . should_not_contain '"revision"'

        group_builder.specify "a static widget has no resolver field" <|
            Widget_Query.resolve_call sample spec_module sample_type "probe" ["arg"] . should_equal '{"arguments":[["arg",{"widget":{"constructor":"Boolean_Input"}}]]}'

        group_builder.specify "type_defaults resolves an unannotated argument through its type's resolver" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "plain" ["arg"] "{}" False "" ('{"arg":"' + spec_module + '.Needs_Subject"}') . parse_json
            json.get "arguments" . first . second . get "resolver" . get "dependencies" . should_equal ["self", "right"]

        group_builder.specify "a run over 10 s is logged at Warning, once" <|
            ## `Widget_Query.slow_threshold_ms` is a private constant (10000); the
               test lowers it through `Widget_Query.with_slow_threshold 1` and a
               resolver that sleeps 5 ms (`Thread.sleep`).
            logged = Widget_Query.with_slow_threshold 1 <|
                Widget_Query.resolve_call sample spec_module sample_type "slow" ["arg"]
                Widget_Query.last_slow_warning
            logged . should_contain "took"
```

(`Needs_Subject` and its conversion move from Task 3's spec into a place both
specs can import, or are duplicated in this file; `values_from_lookup`,
`with_slow_threshold` and `last_slow_warning` are `private: true` helpers
exposed for the tests, as `resolve_type_argument` is. If a scoped threshold is
awkward in Enso, make the threshold a parameter of a private
`_run_resolver … (slow_ms : Integer = 10000)` and test that function directly.)

- [ ] **Step 2: Run, verify they fail** (`Base_Tests "Widget_Query"`).
- [ ] **Step 3: Implement.**
  - `resolve_call`: the three new defaulted parameters; read
    `Meta.get_method_argument_names` once per query (a lookup error leaves the
    existing `"lookup"` failure path unchanged); parse `type_defaults` once;
    `value_of = _values_from uuids` (today's `_cache_from`, renamed: name →
    `Runtime.value_for_uuid`, absent → `Nothing`).
  - `resolve_argument` per "Resolution of one argument" above. Keep the error
    subject short cut (`_no_widgets`) and `log_failure` for `Failed`.
  - `_inputs_key` (the log dedup key) gains the search text, so a failing
    searchable resolver logs once per search, not once per keystroke of the same
    text.
  - The answer keeps `,"columns":{…}` from 5a, then `,"search":…` and
    `,"revision":…` when not empty ("Echo" in "The JSON").
  - Doc comment of `resolve_call`: the new parameters and the answer forms.
- [ ] **Step 4: Run, verify they pass**; `Base_Tests`, `Table_Tests`,
      `SQLite_Tests` in full (the legacy `cache` path keeps every library
      green); lint.
- [ ] **Step 5: Commit**
      `Widget_Query: resolvers get their declared dependencies and search, and are announced`.

## Task 5: `ResolverSignatureCheck`, the lint pass

**Files:**

- Create:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/lint/ResolverSignatureCheck.java`
- Modify: the `Warning` type where `ArgumentDisplay` is defined (find it with
  `git grep -n "ArgumentDisplay" engine/runtime-parser engine/runtime-compiler`)
  — add `ResolverSignature(location, message)`
- Test:
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/ResolverSignatureCheckTest.java`
  (model: `ArgumentDisplayCheckTest.java`)

**Not registered in `Passes.scala` yet** (Task 9 registers it once the libraries
comply, so `lintEnso` is not red in between).

**Interfaces:**

- Produces: `ResolverSignatureCheck.INSTANCE` (a `MiniPassFactory`, like
  `ArgumentDisplayCheck`), running after name resolution (`precursorPasses`: the
  pass that resolves global names, and `GenericAnnotations`). For each method
  (and constructor) with argument annotations, for each annotation expression:
  - a `Widget…` constructor, `..Name`, a `Widget.from …` call, a literal or any
    expression whose head resolves to a **constructor** or to a method with no
    open parameter → nothing to check;
  - a **lambda** → its parameters;
  - a name or an application whose head resolves (`BindingsMap`) to a module
    method or a static method in this or another module → that method's
    parameters (from its IR; `self` of a module method dropped), minus the
    applied positional arguments (from the front) and the applied named ones;
  - anything else that evaluates to a function (a local variable, a computed
    function) → warning "Write a resolver as a lambda or a reference to a
    method, so its parameters can be checked."

  The open parameters are checked with the rule: the first is the subject; each
  other is `search` (with a `Text` type or none, default `""`), or an argument
  name of the annotated method **with default `Nothing`** (decision B).
  Messages:
  - "The resolver of `<arg>` (`<head>`) has a parameter `<p>` that is not an
    argument of `<method>`, nor `search`. Pre-apply it in the annotation if it
    is configuration (`(<head> <p>=…)`)."
  - "The resolver of `<arg>` reads `<p>`, which must default to `Nothing`."

- [ ] **Step 1: Failing tests** (`ResolverSignatureCheckTest.java`, compiling
      small modules the way `ArgumentDisplayCheckTest` does and asserting the
      warnings):
  - `@on _w` with `_w t (right = Nothing) = …` on `join self right on = …` → no
    warning;
  - `_w t (rihgt = Nothing)` → one warning naming `rihgt`;
  - `_w t (right = 5)` → the default warning;
  - `_w t (flag = True)` → the pre-apply message; `@on (_w flag=True)` → none;
  - `@on (t -> (right = Nothing) -> …)` if lambdas take defaults, else a lambda
    with only the subject → none;
  - `@on Widget.Text_Input`, `@on (Widget.Single_Choice [])`,
    `@on (Widget.from Locale)` → none;
  - a helper in another module (`import project.Helpers` … `@on Helpers.w`) →
    checked like a local one (one positive and one negative case);
  - `@on f` where `f` is a local variable bound to a lambda → the "write a
    resolver as…" warning;
  - the search parameter: `(search : Text = "")` → none; `(search = 1)` → the
    default warning.
- [ ] **Step 2: Run, verify they fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh sbt_run "runtime-compiler/testOnly org.enso.compiler.test.ResolverSignatureCheckTest"'
```

- [ ] **Step 3: Implement.** Follow `ArgumentDisplayCheck`'s structure (a mini
      pass over module bindings; warnings attached to the annotation's
      location). Read the annotations as `SuggestionBuilder` does (it lists the
      annotated argument names for the IDE; reuse its accessor rather than
      re-deriving). For a head in another module, get its IR through the
      resolved `BindingsMap.ResolvedModuleMethod`'s module. If that IR is not
      available when the pass runs (the spike question of this task), stop and
      report to the owner with the two ways on: move every resolver next to the
      method it serves (same module, always checkable), or add a
      runtime-integration test that compiles each standard library and checks
      every annotated argument through `Widget_Resolver.check`. Keep the static
      check for same-module heads and lambdas either way.
- [ ] **Step 4: Run, verify they pass**; `runtime-compiler/test` in full.
- [ ] **Step 5: Commit**
      `ResolverSignatureCheck: a resolver's parameters are the subject, arguments or search`.

## Task 6: Table's resolvers

The Table helpers that read `cache`, rewritten as resolvers. Each first gets a
test written against today's helper (with `cache`), so the migration is proved
equal.

**Files:**

- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Widget_Helpers.enso`
  (`make_filter_condition_selector` ~line 170 and `_get_column_value_type` ~455;
  `make_join_condition_selector` ~231; `make_rename_name_vector_selector` ~283;
  `make_format_chooser_for_selection` ~337; `make_format_chooser_for_parse`
  ~349; `_with_table_cache` / `_table_key` / `TableValueCache` import ~476-488;
  re-find the lines after 5b)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`
  (`make_fill_nothing_default_widget` ~4096; annotations at `rename_columns`
  ~1203, `parse` ~1709, `format` ~1831, `filter` ~2352, `join` ~3021,
  `fill_nothing` ~3713)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Column.enso` (`parse`
  ~1813)
- Test: `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `test/Table_Tests/src/Internal/Widget_Helpers_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`

**Interfaces:**

| Helper (after 5b)                                      | Becomes                                                                                                                     | Dependencies         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `make_filter_condition_selector table cache=Nothing`   | `make_filter_condition_selector table (column = Nothing)`; `_get_column_value_type table column` takes the value            | `self`, `column`     |
| `make_join_condition_selector table cache=Nothing`     | `make_join_condition_selector table` (5b left it reading nothing; drop the parameter if still there)                        | `self`               |
| `make_rename_name_vector_selector table cache=Nothing` | `make_rename_name_vector_selector table (column_map = Nothing)`                                                             | `self`, `column_map` |
| `make_format_chooser_for_selection table cache`        | `make_format_chooser_for_selection table (columns = Nothing)`                                                               | `self`, `columns`    |
| `make_format_chooser_for_parse table cache`            | `make_format_chooser_for_parse table (type = Nothing)`                                                                      | `self`, `type`       |
| `make_fill_nothing_default_widget table cache=Nothing` | `make_fill_nothing_default_widget table (columns = Nothing)`                                                                | `self`, `columns`    |
| `parse_type_selector`, `make_format_chooser_for_type`  | unchanged, minus `_with_table_cache` (static; `make_format_chooser_for_type` is a plain function of its value types, cheap) | —                    |

`Simple_Expression`'s call `Widget_Helpers.make_filter_condition_selector table`
keeps working (the dependency defaults to `Nothing`, today's behaviour there).
Every annotation keeps its form
(`@filter Widget_Helpers.make_filter_condition_selector`): the function is now a
resolver whose signature the GUI is told.

- [ ] **Step 1: Pin today's widgets.** Before changing a helper, add to
      `Table_Widgets_Spec.enso` one test per helper that calls it with a mock
      `cache` and records its `to_json` (`filter` with `column` = `"B"` on a
      table whose `B` is Char; `rename_columns` with `column_map` = `["A"]`;
      `format` with `columns` = `["D"]` (a date column); `parse` with `type` =
      `Value_Type.Date`; `fill_nothing` with `columns` = `["B"]`). Run them:
      they pass on today's code. Then rewrite each to call
      `Widget_Query.resolve_argument` with `Widget_Query.values_from_lookup`
      giving the same value, and assert the same widget JSON **plus** the
      `resolver` field (e.g. `["self","column"]`). Add for `filter` "a column
      that is an error makes the argument unavailable"
      (`unavailable.dependency == "column"`).
- [ ] **Step 2: Run, verify the rewritten tests fail** (the helpers still take
      `cache`, so their signatures announce `cache`).
- [ ] **Step 3: Implement** per the table. Delete `_with_table_cache`,
      `_table_key`, the `TableValueCache` import and `With_JSON_Cache` from
      `Widget_Helpers.enso`'s import line. `_get_column_value_type` takes the
      column's value instead of `cache` (same cases: `Nothing`, `Text` → `get`,
      `Expression` → `evaluate_expression`, a column).
- [ ] **Step 4: Run** `Table_Tests`, `SQLite_Tests` in full; lint. The join test
      of 5b (`Column_Name from="right"`) must be unchanged.
- [ ] **Step 5: Commit**
      `Table: the widget helpers that read cache are resolvers`.

## Task 7: Group C — type defaults that are resolvers

**Files:**

- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Simple_Expression.enso`
  (`default_widget` ~88 → module-private `_simple_expression_widget`; add the
  conversion), `Generate_Rows_Range.enso` (`default_widget` ~69), `Table.enso`
  (`@value Simple_Expression.default_widget` ~2714,
  `@over Generate_Rows_Range.default_widget` ~4024)
- Modify:
  `distribution/lib/Standard/Google/0.0.0-dev/src/Google_Analytics_Account.enso`
  (`Google_Analytics_Account_Filter.default_widget` ~88),
  `Google_Analytics_Property.enso` (~87), `Google_Analytics.enso` (`@property`
  ~42, 121, 139; `@account` ~99)
- Modify: `distribution/lib/Standard/DuckDB/0.0.0-dev/src/DuckDB_GeoFormat.enso`
  (`default_widget` ~34), `DuckDB_Connection.enso` (`@format` ~784)
- Test: `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `test/Base_Tests/src/Type_Default_Spec.enso` (nothing Base-side; the
  conversions live in their libraries), the Google and DuckDB widget tests

**Interfaces:**

| Type                              | Conversion (in the type's module)                                                             | Resolver                                                     | Dependencies          |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| `Simple_Expression`               | `Widget.from (that : Simple_Expression.type) = Widget.Resolver _simple_expression_widget`     | `_simple_expression_widget table` (body of `default_widget`) | `self`                |
| `Generate_Rows_Range`             | `Widget.from (that : Generate_Rows_Range.type) = Widget.Resolver _generate_rows_range_widget` | `_generate_rows_range_widget table`                          | `self`                |
| `Google_Analytics_Account_Filter` | `… = Widget.Resolver _account_filter_widget`                                                  | `_account_filter_widget _ (credentials = Nothing)`           | `self`, `credentials` |
| `Google_Analytics_Property`       | `… = Widget.Resolver _property_widget`                                                        | `_property_widget _ (credentials = Nothing)`                 | `self`, `credentials` |
| `DuckDB_GeoFormat`                | `… = Widget.Resolver _geo_format_widget`                                                      | `_geo_format_widget connection`                              | `self`                |

- Every annotation that called `X.default_widget` becomes `@arg (Widget.from X)`
  (it evaluates to the `Widget.Resolver`, which `resolve_call` runs: Task 4 step
  1). They stay in 6a so today's GUI keeps them (decision 1's compatibility); 6b
  deletes the ones whose argument type is exactly `X`.
- `default_widget` is deleted from all five types (the spec's last ones).
- The spec's "Google_Analytics_Account" is `Google_Analytics_Account_Filter`
  (`Google_Analytics_Account.enso:73`); recorded in the spec amendment.

- [ ] **Step 1: Failing tests.** `Table_Widgets_Spec.enso`:

```enso
        group_builder.specify "Simple_Expression's type default is a resolver of the table" <|
            Widget_Query.resolve_type "Standard.Table.Simple_Expression.Simple_Expression" . should_equal '{"widget":null,"resolver":{"dependencies":["self"],"searchable":false}}'

        group_builder.specify "set's value resolves Simple_Expression's widget against the table" <|
            t = Table.new [["A", [1]], ["B", ["x"]]]
            json = Widget_Query.resolve_call t "Standard.Table.Table" "Standard.Table.Table.Table" "set" ["value"] . parse_json
            result = json.get "arguments" . first . second
            result.get "resolver" . get "dependencies" . should_equal ["self"]
            result.get "widget" . get "constructor" . should_equal "Single_Choice"
```

      Same shape for `expand_to_rows`'s `over` (Generate_Rows_Range). DuckDB:
      `write_spatial_file`'s `format` resolves to a `Single_Choice` whose last
      option's parameter `driver_name` lists the connection's drivers. Google
      (offline): `Widget_Query.resolve_type` of both Google types answers the
      resolver with `["self","credentials"]`; with no credentials the property
      widget falls back as today (`Text_Input` on error) — call the resolver
      directly with `credentials = Nothing` in an environment without Google
      credentials and assert it does not raise.

- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** per the table. Each conversion has `private: true`
      front matter and a one-line doc, as 3a's conversions do.
- [ ] **Step 4: Run** `Table_Tests`, `SQLite_Tests`, `DuckDB_Tests`,
      `Google_Api_Test` (offline groups) in full; lint; regenerate API docs.
- [ ] **Step 5: Commit**
      `Group C: Simple_Expression, Generate_Rows_Range, Google and DuckDB_GeoFormat defaults are resolvers`.

## Task 8: The other libraries' `cache` helpers

**Files and interfaces:**

| Helper                                                                                            | Becomes                                                                                                                                                                                                            | Dependencies                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| AWS `Redshift_Connection.enso:536` `_make_staging_bucket_widget connection cache=Nothing`         | `_make_staging_bucket_widget connection (staging_bucket_credentials = Nothing)`                                                                                                                                    | `self`, `staging_bucket_credentials` |
| DuckDB `DuckDB_Connection.enso:851` `_column_names_widget connection single_choice cache`         | `_column_names_widget connection (table = Nothing)` and `_column_name_widget connection (table = Nothing)` (the `single_choice=True` use, `@column` ~397) — two resolvers, no configuration parameter (decision B) | `self`, `table`                      |
| Tableau `Hyper_File.enso:122` `make_table_selector hyper_file cache=Nothing`                      | `make_table_selector hyper_file (schema = Nothing)`                                                                                                                                                                | `self`, `schema`                     |
| Microsoft `Azure_Credential.enso:99` `make_subscription_selector self_arg cache`                  | `make_subscription_selector _ (cred = Nothing) (environment = Nothing)`                                                                                                                                            | `self`, `cred`, `environment`        |
| Google `Google_Analytics.enso:150,163` `_make_metrics/_dimensions_vector_selector self_arg cache` | `… _ (property = Nothing) (credentials = Nothing)`                                                                                                                                                                 | `self`, `property`, `credentials`    |
| Base `Date.enso:1333` `make_day_picker value cache` (used by `Date.new` and `Date_Time.new`)      | `make_day_picker _ (year = Nothing) (month = Nothing)`                                                                                                                                                             | `self`, `year`, `month`              |

YXDB's `_column_widget` was deleted by 5b; check with
`git grep -n "_column_widget" distribution/lib/Standard/YXDB`.

- [ ] **Step 1: Pin today's widgets, then the resolver form** (as Task 6 Step
      1), one test per helper, offline only:
  - Base `Date_Spec.enso`: `Date.new`'s `day` with `year` 2024 and `month` 2 →
    `Numeric_Input` max 29; with `month` 2 and `year` 2023 → 28; unset → 31;
    dependencies `["self","year","month"]`;
  - DuckDB (in-memory connection): `create_index`'s `key_columns` with `table` =
    a created table's name → `Multiple_Choice` of its columns; unset → the
    `Vector_Editor` of `Text_Input`; `create_spatial_index`'s `column` → the
    `Single_Choice` with `<Custom>` first;
  - Hyper: the test file under `test/Tableau_Tests` with `schema` = `"Extract"`
    → its tables; dependencies `["self","schema"]`;
  - Redshift, Azure, Google: only the signature (the dependencies list) and that
    the resolver with every dependency `Nothing` returns a widget without
    network access failing the test (they catch and fall back today; keep that).
- [ ] **Step 2: Run, verify the resolver-form tests fail.**
- [ ] **Step 3: Implement** per the table; annotations unchanged except DuckDB
      `@column _column_name_widget`. Inside, `cache.if_not_nothing <| cache "x"`
      becomes the parameter `x`.
- [ ] **Step 4: Run** `Base_Tests`, `DuckDB_Tests`, `Tableau_Tests`,
      `AWS_Tests`, `Microsoft_Tests`, `Google_Api_Test` (each to the extent it
      runs offline; record which groups were skipped for want of credentials);
      lint; regenerate API docs.
- [ ] **Step 5: Commit**
      `Libraries: every widget helper that read cache is a resolver`.

## Task 9: Searchable table names, the lint switched on, configuration pre-applied

**Files:**

- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Connection/Connection.enso`
  (`make_table_name_selector` ~635, `make_table_name_with_schema_selector` ~644)
- Modify:
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/Passes.scala`
  (register `ResolverSignatureCheck` beside `ArgumentDisplayCheck`)
- Modify: every annotation `lintEnso` then reports (expected: the Database
  selectors' `add_custom` / `include_any` / `schema_black_list`, and other
  helpers with defaulted configuration)
- Test: `test/DuckDB_Tests` (widgets spec),
  `test/SQLite_Tests/src/Widgets_Spec.enso`

**Interfaces:**

```enso
make_table_name_selector connection (add_custom : Boolean = True) (search : Text = "") -> Widget
make_table_name_with_schema_selector connection (schema_black_list : Vector = []) (search : Text = "") -> Widget
```

With `search` empty, exactly today's list. Otherwise
`connection.tables name_like=(_like_pattern search)` (and `schema="*"` for the
schema variant), where `_like_pattern` escapes `\`, `%` and `_` with `\` and
wraps the text in `%…%`. Matching is the database's own (JDBC metadata
patterns): case-sensitive on some backends; the GUI's local filter still applies
to what comes back. The `<Table_Name>` / `<Raw_SQL>` options stay at the end.

- [ ] **Step 1: Failing tests.** DuckDB (in-memory, tables `Sales_2024`,
      `sales_2025`, `Costs`, `a_b`, `aXb`):

```enso
        group_builder.specify "query's table names are searchable" <|
            json = Widget_Query.resolve_call connection "Standard.DuckDB.DuckDB_Connection" "Standard.DuckDB.DuckDB_Connection.DuckDB_Connection" "query" ["query"] "{}" False "ales" . parse_json
            result = json.get "arguments" . first . second
            result.get "resolver" . get "searchable" . should_be_true
            labels = result.get "widget" . get "values" . map (o-> o.get "label")
            labels . should_contain "Sales_2024"
            labels . should_not_contain "Costs"

        group_builder.specify "search escapes LIKE wildcards" <|
            ## `a_b` must not match `aXb`.
            json = Widget_Query.resolve_call connection "Standard.DuckDB.DuckDB_Connection" "Standard.DuckDB.DuckDB_Connection.DuckDB_Connection" "query" ["query"] "{}" False "a_b" . parse_json
            labels = json.get "arguments" . first . second . get "widget" . get "values" . map (o-> o.get "label")
            labels . should_contain "a_b"
            labels . should_not_contain "aXb"

        group_builder.specify "an empty search gives today's full list" <|
            ## Compare with the list `make_table_name_with_schema_selector` gave before this task (pinned first).
```

      Record what `"sales"` (lower case) returns on DuckDB and pin it (the
      backend's case rule), and the same three tests for SQLite's `query`
      (`make_table_name_selector`). The SQL log
      (`ENSO_SQL_LOG_PATH`, as 5a's test) shows one metadata call per search.

- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** the helpers. Then register the lint pass and run:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh sbt_run "all lintEnso" 2>&1 | grep -E "ResolverSignature|warning" | sort | uniq | tee ~/pr6a-lint.txt | head -80'
```

      For each report: pre-apply a configuration parameter in the annotation
      (`@query (make_table_name_with_schema_selector schema_black_list=schema_black_list)`
      already is; `@query make_table_name_selector` becomes
      `@query (make_table_name_selector add_custom=True)` — or give the helper
      no defaulted configuration and add a second helper, whichever reads
      better at that site), or rename a parameter that is really a dependency.
      Never weaken the check to pass a site. Repeat until the list is empty.
      Put the list (site → fix) in the PR body.

- [ ] **Step 4: Run** `DuckDB_Tests`, `SQLite_Tests`, `Table_Tests`,
      `Base_Tests` in full; `sbt "all lintEnso"` green; the Postgres suite runs
      in CI.
- [ ] **Step 5: Commit**
      `Database: table names are searchable; the resolver rule is enforced by lintEnso`.

## Task 10: Today's GUI reads the new answers

**Files:**

- Create:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/resolverAnswerCompat.test.ts`

- [ ] **Step 1: Write the test** against today's unchanged schemas (it pins
      decision 1's compatibility; 6b replaces it):

```ts
import { describe, expect, test } from "vitest";
import {
  functionCallFromAnswer,
  widgetQueryAnswerSchema,
} from "../configuration";

describe("today's GUI reads 6a's answers", () => {
  test("a resolver answer is its widget", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          "on",
          {
            widget: { type: "Widget", constructor: "Text_Input" },
            resolver: { dependencies: ["self", "right"], searchable: false },
          },
        ],
      ],
    });
    expect(functionCallFromAnswer(answer).parameters.get("on")).toMatchObject({
      kind: "Text_Input",
    });
  });

  test("an unavailable dependency is no widget", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          "on",
          {
            widget: null,
            resolver: { dependencies: ["self", "right"], searchable: false },
            unavailable: { dependency: "right", message: "bad" },
          },
        ],
      ],
    });
    expect(functionCallFromAnswer(answer).parameters.get("on")).toBeNull();
  });

  test("a resolver's error stays an error", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        [
          "on",
          {
            error: { step: "resolver", message: "x" },
            resolver: { dependencies: [], searchable: false },
          },
        ],
      ],
    });
    expect(functionCallFromAnswer(answer).errors?.get("on")?.step).toBe(
      "resolver",
    );
  });
});
```

      Add the `resolve_type` case to the same file by importing the answer
      schema `typeDefaults.ts` uses (export it if it is not exported; that is
      the only change to a GUI source file):
      `{"widget":null,"resolver":{…}}` parses as `{widget: null}`.

- [ ] **Step 2: Run** (Windows and WSL):

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/resolverAnswerCompat.test.ts
```

      Expected: PASS without any schema change. A failure means today's GUI
      would break: stop and report (decision 1 would then need back-to-back
      merges).

- [ ] **Step 3: Commit**
      `GUI test: today's widget schema reads the resolver answers`.

## Task 11: Delete `cache` and `With_JSON_Cache`

**Files:**

- Modify: `Widget_Query.enso` (the legacy `cache` branch of `resolve_argument`;
  `uuids` doc: "for resolvers' dependencies")
- Modify: `Metadata.enso` (`With_JSON_Cache` constructor, its `to_text`,
  `to_json`, `to_js_object` branches; `to_text` then needs no override if only
  `With_JSON_Cache` needed it)
- Modify: `test/Base_Tests/src/Widget_Query_Spec.enso` (`_choice_of_cache` and
  its test become the resolver form),
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso` (any remaining
  `With_JSON_Cache` unwrapping, lines ~53-71 before 5b)
- Modify: `std-bits/table/…/TableValueCache.java` — delete `getOrCompute` if
  `git grep -n getOrCompute` finds no caller (the table view uses `get`/`put`,
  `In_Memory_Viz_Source.enso:33-37`, `Viz_Helpers.enso:118-121`)

- [ ] **Step 1: Failing test.** In `Widget_Query_Spec.enso`, a function
      annotation whose open parameters are `_` and `cache` is now a rule
      violation: `error.get "message" . should_contain "`cache`"` (step
      `"resolver"`).
- [ ] **Step 2: Run, verify it fails** (the legacy branch still applies it).
- [ ] **Step 3: Delete** the legacy branch and `With_JSON_Cache`. Then:

```bash
git grep -nE "\bcache\b" -- 'distribution/lib/Standard/*.enso' | grep -viE "TableValueCache|cache_|_cache|ir.?cache|cached"
git grep -n "With_JSON_Cache\|_with_table_cache\|_table_key\|Visualization.Widgets\|get_widget_json" -- distribution test app/gui/src ':!**/docs/api/**'
```

      Both must print nothing (the first may list unrelated words; read each).

- [ ] **Step 4: Run** every suite of "Verify" below; lint; regenerate API docs
      of every library touched; `stdlib-api-check`.
- [ ] **Step 5: Commit** `Widgets: cache and With_JSON_Cache are gone`.

## Task 12: The benchmark against the §6 targets

**Files:**

- Modify: `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso` (5b's version:
  `queries` and `backends`)
- Modify: `test/Table_Tests/src/In_Memory/Widget_Size_Spec.enso` and the SQLite
  group (5b), adding the migrated methods

- [ ] **Step 1: Record the "before"** on the 5b merge commit, in the Linux clone
      (as 5b's Task 7 Step 1):

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh dist && cd ~/enso-widgets-pr6a/test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Benchmarks/src/Widgets/Widget_Query_Report.enso" | tee ~/pr6a-before.tsv'
```

      (Use a second clone at the 5b merge commit, or run before Task 6 is
      synced.)

- [ ] **Step 2: Extend** `queries` with
      `["fill_nothing", ["columns", "default"]]`,
      `["rename_columns", ["column_map"]]`, `["format", ["columns", "format"]]`,
      `["parse", ["columns", "type", "format"]]` (whichever 5b did not add), and
      one resolver query with a dependency set: `filter`'s `filter` with `uuids`
      naming `column` (the bench passes a lookup; if the report cannot fake an
      expression id, call `Widget_Query.resolve_argument` with
      `values_from_lookup` and time that). Add the same methods to the size
      test.
- [ ] **Step 3: Record the "after"** (`~/pr6a-after.tsv`) and put both tables in
      the PR body: per backend and method, cold/warm ms and KB, before → after,
      the 20 ms / 50 KB targets marked. A method over 20 ms warm: name its
      cause. In particular `set` (Simple_Expression, now a resolver of `self`)
      and `filter` (the column's type now arrives by name instead of through
      `cache`). The size test must pass.
- [ ] **Step 4: Commit** `Widget benchmark: the resolvers, before and after`.

## Task 13: Docs, spec, PR

- [ ] **Step 1: Docs.**
  - Base `CLAUDE.md` (the `resolve_call` paragraph, line ~67): resolvers, the
    rule, the answer forms, `search`, `type_defaults`, `revision`, the 10 s
    warning, `Meta.get_method_argument_names`; "a widget never reads `cache`".
  - Table `CLAUDE.md`: write a dependency as a parameter named after the
    argument, defaulted to `Nothing`; never cache a widget on the table.
  - Database `CLAUDE.md`: the searchable table-name helpers.
  - `engine/runtime-compiler/CLAUDE.md`: `ResolverSignatureCheck` beside
    `ArgumentDisplayCheck` (what it resolves, the cross-module fallback if Task
    5 needed it).
- [ ] **Step 2: Verify** (Linux):

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6a.sh dist && for s in Base_Tests Table_Tests SQLite_Tests DuckDB_Tests Tableau_Tests AWS_Tests Microsoft_Tests Google_Api_Test Geo_Tests XML_Tests YXDB_Tests Visualization_Tests Examples_Tests; do echo "== $s"; ~/pr6a.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done; ~/pr6a.sh sbt_run "all lintEnso" "runtime-compiler/test" "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest"; cd ~/enso-widgets-pr6a && corepack pnpm --filter build-scripts run stdlib-api-check && corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry'
```

- [ ] **Step 3: PR** with the `CI: No changelog needed` label; body: the JSON,
      the rule, the migration table (helper → dependencies), the lint sweep's
      list, the benchmark tables, decisions taken and any still open, "today's
      GUI is unaffected (Task 10); PR 6b adds the GUI". Link it to the thread.
      **Stop at green CI; do not merge.**
