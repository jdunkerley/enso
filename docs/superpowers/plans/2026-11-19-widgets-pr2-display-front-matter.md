# Widgets PR 2: Display in the Front Matter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whether an argument shows on a collapsed node is written in its
method's doc front matter
(`arguments: {name: always | selected | when_modified}`) and known before the
engine answers. `selected` is new: the argument also shows while its node is the
sole selection. `display` and `label` leave every `Widget` constructor, and the
`Display` type is deleted.

**Architecture:** The GUI already parses each suggestion's front matter with a
YAML parser (`documentationData`). It gains an `arguments` map, and the call
tree's placeholders take their visibility from it instead of from the widget
query's answer. The engine gains a lint pass (`ArgumentDisplayCheck`) that reads
the same block line by line and warns on an unknown argument, a required
argument or an unknown value. `lintEnso` runs with `-Werror`, so a warning fails
the standard library build. The standard library's 155 `display=` annotations,
and the helper defaults that set display implicitly, are inventoried by script,
cross-checked against the engine's own answers, and rewritten as front matter
before `display` is removed.

**Tech Stack:** Java (engine compiler pass, JUnit), Enso (standard library, test
suites), TypeScript + Vue 3 + zod + `yaml` (GUI), vitest, Playwright, Node
(one-off migration scripts).

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§7
"Display in the front matter"; PR table row 2).

**Depends on:** PR 1b (#891, merged 722582f042) and #850 (merged). Start from
`develop` at or after 722582f042.

## Global Constraints

- Implementation worktree: `C:\Repos\Enso\ide-widgets-pr2`, branch
  `widgets/pr2-display-front-matter`, from `origin/develop`.
- Linux clone for every build and run: `~/enso-widgets-pr2` on WSL
  `Ubuntu-24.04`, helper `~/pr2.sh` (below). Delete both when the PR merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is
  checked out in a worktree.
- Front-matter key and values, exactly: `arguments:` with one
  `<argument name>: <value>` line per argument, value one of `always`,
  `selected`, `when_modified`. `when_modified` is the default and is not written
  by the migration.
- An argument with no default, or whose default starts with `Missing_Argument.`,
  is always shown and may not appear under `arguments:`.
- `selected` means "shown while the node is the **sole** selection" — the same
  `showDetails` the widget tree already provides (#850).
- Behaviour-preserving migration: every argument shown today because its widget
  says `Always` gets `always`; nothing else changes. This PR gives no
  standard-library argument `selected` (owner question, see the end).
- `Choice.Option`'s `label` and `File_Type.Option`'s `label` stay.
- Warning class `Warning.ArgumentDisplay` with `@Persistable` id **797**
  (checked free on develop 722582f042; re-check with `git grep "id = 797"`).
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`, in the
  `- [Description][NNN]` form with a link definition (open the PR as a draft
  first to get `NNN`). The visible change (always-shown arguments appear at
  once; `selected`) gets before/after screenshots on the `pr-screenshots`
  branch.
- Every commit message ends with a blank line and then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Decisions and the evidence for them

Checked in the code on develop 722582f042. Implementers need not re-derive them.

1. **The GUI reads front matter itself; no protocol change.** The engine sends
   each entry's raw doc string (`Suggestion.*.documentation`); the GUI parses
   the `YAMLFrontMatter` block with the `yaml` package
   (`ComponentHelp/metadata.ts` `parseMetadata`) into
   `documentationMetadataSchema`, and `documentationData()`
   (`suggestionDatabase/documentation.ts`) derives `iconName`, `groupIndex` etc.
   `group` and `icon` reach the IDE this way, so `arguments` does too. Nested
   maps already work (`macros`, `macro_for`). The docs-site generator reuses
   `extractMetadata` and its schema is non-strict, so a new key cannot break it.
2. **The engine has no front-matter parser**, and `snakeyaml` is only a test
   dependency of `runtime-compiler`. The lint pass therefore reads the block
   line by line: the format it accepts is exactly the one this plan writes
   (block form, one `name: value` per line). A flow map
   (`arguments: {a: always}`) is a warning telling the author to use the block
   form, so the engine and the GUI cannot disagree.
3. **A compiler pass, not the suggestion builder.** `SuggestionBuilder` runs
   after diagnostics are reported, so a warning added there is never printed.
   Lint passes run in the compile pipeline when linting is on (`Passes.scala`,
   the `UnusedBindings, PrivateBuiltinMethodsCheck, …` list); `lintEnso`
   (`project/EnsoLint.scala`) compiles every standard library with
   `--enable-static-analysis -Werror`, so a warning fails it. That is the spec's
   "an error in the standard library build".
4. **Widgets come only from annotations.** `Widget_Query.resolve_argument`
   evaluates `Meta.get_method_annotation`; a type's `default_widget` is used
   only when an annotation calls it. So the annotations are the whole migration
   surface — but an annotation's display can come from a helper's **default**
   (`Widget_Helpers.make_*` in Table default to `..Always`; most
   `default_widget`s to `..When_Modified`). 392 annotations call a helper
   without `display`, so counting `display=` is not enough: Task 3 computes each
   argument's effective display.
5. **Nested displays matter too.** A `Choice.Option`'s `parameters` carry
   widgets for the arguments of the option's call (e.g. `..Sum` → `column`). The
   GUI applies them as the nested call's `dynamicConfig`, and
   `ArgumentPlaceholder.hideByDefault` reads `display` there. After this PR the
   nested call's own front matter decides (the nested placeholder is built from
   the nested call's `CallInfo.suggestion`), so a nested `display=..Always`
   becomes `arguments: {column: always}` on the option's constructor or method.
6. **One visibility rule in one place.** Today
   `ArgumentPlaceholder.hideByDefault` (`util/callTree.ts`) is read by
   `WidgetApplication.vue` (show or not) and `hiddenParameters.ts`
   (the ＋ menu). It becomes `isHidden(selected)`; `WidgetApplication` passes
   `injectWidgetTree(true)?.showDetails ?? false`; the ＋ menu, which only shows
   while the node is the sole selection, passes `true`, so a `selected` argument
   is never listed while it is visible.
7. **No more pop-in.** `pending()` answered `display: Always` so annotated
   arguments showed while the query ran and hid after. With static display the
   placeholder is right from the first render; `pending()` loses `display`.
8. **`label` is dead.** Never set in Enso (only positional `Nothing`), never
   read by the GUI; only `Single_Choice`/`Multiple_Choice` JSON emit
   `"label":null`.
9. **Positional constructor calls break silently.** Removing two fields shifts
   positions: `Widget.Single_Choice choices Nothing Display.Always` would pass
   `Nothing` as `allow_custom`. Every positional use must be found by grep (Task
   4 lists the patterns) and the annotation sweep re-run.

## Working environment

Check free space on `E:` first (agent clones filled it before), then:

```powershell
git -C C:\Repos\Enso\ide worktree add -b widgets/pr2-display-front-matter C:\Repos\Enso\ide-widgets-pr2 origin/develop
wsl -d Ubuntu-24.04 -e bash -lc 'df -h ~ && git clone /mnt/c/Repos/Enso/ide ~/enso-widgets-pr2 && cd ~/enso-widgets-pr2 && git config core.fileMode false && git fetch /mnt/c/Repos/Enso/ide widgets/pr2-display-front-matter && git checkout -b widgets/pr2-display-front-matter FETCH_HEAD'
```

Create `~/pr2.sh` in WSL (`chmod +x ~/pr2.sh`; not part of the repository). It
mirrors the Windows worktree, uncommitted edits included, before each run. The
exclusions carry PR 1a/1b's lessons: `.git` is a **file** in a worktree (exclude
it without the slash), and the Linux-only jars under `std-bits/tableau/lib/` and
`test/*/polyglot/` must survive the sync.

```bash
#!/usr/bin/env bash
# Widgets PR 2 helpers: pr2.sh <function> [args...]
set -euo pipefail
. ~/.enso-toolchain.sh
WIN=/mnt/c/Repos/Enso/ide-widgets-pr2
LNX=$HOME/enso-widgets-pr2
export ENSO_REPO=$WIN
export CARGO_TARGET_DIR=$HOME/enso-target
sync() {
  rsync -a --delete --exclude=.git --exclude=node_modules/ --exclude=target/ \
    --exclude=built-distribution/ --exclude=dist/ --exclude=.enso/ --exclude=.bloop/ \
    --exclude=.bsp/ --exclude=.metals/ --exclude='*.tsbuildinfo' --exclude=.eslintcache \
    --exclude=/std-bits/tableau/lib/ --exclude='/test/*/polyglot/' \
    "$WIN/" "$LNX/"
}
sbt_run() { sync; (cd "$LNX" && sbt "$@"); }
# The CI way: a full distribution (with the test-helper jars) and build-scripts' runner.
# A NoIndex distribution and a bare `enso --run` give ~238 false Base_Tests failures.
dist() { sync; (cd "$LNX" && sbt ciBuildEngineDistribution); }
stdlib_test() { sync; (cd "$LNX" && corepack pnpm --filter build-scripts run stdlib-test "$@"); }
# Quick runs of one suite against the built distribution, from test/ (root CLAUDE.md trap 1).
enso_test() {
  sync
  (cd "$LNX/test" && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/$1" ${2:+"$2"})
}
enso_run() { sync; (cd "$LNX" && built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$@"); }
pnpm_ready() { sync; (cd "$LNX" && corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile); }
pnpm_run() { sync; (cd "$LNX" && corepack pnpm "$@"); }
"$@"
```

Every Enso run is checked for its count line (`N tests succeeded.`), because a
filter that matches nothing still exits 0 (root CLAUDE.md trap 2).

## File Structure

**Engine**

- Create
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/lint/ArgumentDisplayCheck.java`:
  the lint pass and its line-based front-matter reader.
- Modify
  `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/Warning.java`:
  `record ArgumentDisplay(IdentifiedLocation identifiedLocation, String text)`,
  added to the `permits` list.
- Modify
  `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/IrPersistance.java`:
  `@Persistable(clazz = Warning.ArgumentDisplay.class, id = 797)`.
- Modify
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/Passes.scala`:
  register the pass beside `PrivateBuiltinMethodsCheck.INSTANCE`.
- Create
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/ArgumentDisplayCheckTest.java`.

**GUI**

- Modify `app/gui/src/project-view/components/ComponentHelp/metadata.ts`:
  `arguments` in `documentationMetadataSchema`.
- Modify
  `app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts`:
  `ArgumentDisplay`, `DocumentationData.argumentDisplay`.
- Modify `app/gui/src/providers/openedProjects/suggestionDatabase/lsUpdate.ts`:
  the `argumentDisplay` getter.
- Modify
  `app/gui/src/providers/openedProjects/suggestionDatabase/mockSuggestion.ts`:
  an `arguments` option for test entries.
- Modify `app/gui/src/project-view/util/callTree.ts`: `isHidden(selected)`; the
  factory takes the suggestion's `argumentDisplay`.
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetApplication.vue`
  and `.../WidgetFunction/hiddenParameters.ts`.
- Modify `app/gui/src/project-view/components/ComponentHelp/sections.ts`: the
  help panel drops the `arguments:` block as it drops `group`.
- Modify (Task 4)
  `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`: remove
  `DisplayMode`, `displaySchema`, `withDisplay`, widget `label`.
- Tests beside each (`__tests__/`); Playwright under
  `app/gui/integration-test/`.

**Standard library**

- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`: delete
  `Display`; drop `label`/`display` from `Widget`; `make_single_choice values`.
- Modify every library file that defines a helper with a `display` parameter (71
  definitions) or passes `display` (155 annotations, ~110 inline uses).
- Add `arguments:` front matter to the methods and constructors the inventory
  lists.
- Modify tests: `test/Geo_Tests/src/Geo_Widgets_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`, and any other the
  grep in Task 4 finds.
- Regenerate each touched library's `docs/api/` (`stdlib-api-check`).

**One-off migration scripts** (kept in the SDD workspace
`.superpowers/sdd/2026-11-19-widgets-pr2-display-front-matter/`, not committed):
`inventory.mjs`, `Check_Inventory.enso` (a one-file project folder),
`apply.mjs`.

**Docs**

- `CHANGELOG.md` (one entry); CLAUDE.md files (Task 6 lists them); the wiki's
  front-matter reference.

---

## Task 1: The engine's `arguments:` check

**Files:**

- Create:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/lint/ArgumentDisplayCheck.java`
- Modify:
  `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/Warning.java`
- Modify:
  `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/IrPersistance.java`
- Modify:
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/Passes.scala`
- Test:
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/ArgumentDisplayCheckTest.java`

**Interfaces:**

- Produces:
  `Warning.ArgumentDisplay(IdentifiedLocation identifiedLocation, String text)`
  whose `message` is `text`; the pass `ArgumentDisplayCheck.INSTANCE`; the
  static helper
  `ArgumentDisplayCheck.readArguments(String documentation) -> Result` where
  `Result` is
  `record Result(java.util.LinkedHashMap<String,String> entries, java.util.List<String> problems)`
  (package-visible, used by the test).
- Accepted values: `always`, `selected`, `when_modified`.

- [ ] **Step 1: Find the exact documentation text the pass sees.**
      `DocumentationComments.Doc(documentation)` holds the comment's text. Write
      a scratch test (delete it after) that compiles

  ```enso
  type T
      ## ---
         icon: join
         arguments:
           b: always
         ---
         Summary.
      m self a b=1 = a + b
  ```

  through `WithCompilerContext` (copy the rule from
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java`,
  with `cfg -> cfg.isLintingDisabled(false)`) and prints the `Doc` metadata of
  the `Method.Explicit` for `m` and of a constructor's `Definition.Data`. Note
  in the ledger: whether the leading `---` line and the indentation are kept,
  and whether docs are still attached to `Method.Explicit`/`Definition.Data`
  after `ComplexType` and `GenerateMethodBodies` (the precursors
  `PrivateBuiltinMethodsCheck` uses). The reader below assumes "lines of the
  comment, common indentation possibly kept"; adjust it to what you see.

- [ ] **Step 2: Write the failing tests.**

  ```java
  package org.enso.compiler.test;

  import static org.hamcrest.MatcherAssert.assertThat;
  import static org.hamcrest.Matchers.containsInAnyOrder;
  import static org.hamcrest.Matchers.empty;
  import static org.hamcrest.Matchers.is;

  import java.util.ArrayList;
  import java.util.List;
  import java.util.Map;
  import org.enso.compiler.core.IR;
  import org.enso.compiler.core.ir.Warning;
  import org.enso.compiler.pass.lint.ArgumentDisplayCheck;
  import org.enso.compiler.test.mock.WithCompilerContext;
  import org.enso.pkg.QualifiedName;
  import org.junit.Rule;
  import org.junit.Test;

  public class ArgumentDisplayCheckTest {
    @Rule
    public final WithCompilerContext compilerCtx =
        WithCompilerContext.newBuilder()
            .withModifiedCompilerConfig(cfg -> cfg.isLintingDisabled(false))
            .build();

    private List<String> warnings(String code) {
      var mod = compilerCtx.createModule(QualifiedName.fromString("local.Proj.Main"), code);
      compilerCtx.getCompiler().run(mod);
      var found = new ArrayList<String>();
      mod.getIr()
          .preorder()
          .foreach(
              ir -> {
                ((IR) ir)
                    .getDiagnostics()
                    .toList()
                    .foreach(
                        d -> {
                          if (d instanceof Warning.ArgumentDisplay w) found.add(w.text());
                          return null;
                        });
                return null;
              });
      return found;
    }

    @Test
    public void validBlockGivesNoWarning() {
      var code =
          """
          type T
              ## ---
                 icon: join
                 arguments:
                   b: always
                   c: selected
                   d: when_modified
                 ---
                 Summary.
              m self a b=1 c=2 d=3 = a + b + c + d
          """;
      assertThat(warnings(code), is(empty()));
    }

    @Test
    public void unknownArgumentWarns() {
      var code =
          """
          ## ---
             arguments:
               nope: always
             ---
          f a b=1 = a + b
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter's `arguments` names `nope`, which is not an argument of `f`."));
    }

    @Test
    public void requiredArgumentWarns() {
      var code =
          """
          ## ---
             arguments:
               a: always
             ---
          f a b=1 = a + b
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter's `arguments` lists `a`, which has no default and is always shown."));
    }

    @Test
    public void missingArgumentDefaultCountsAsRequired() {
      var code =
          """
          from Standard.Base.Errors.Common import Missing_Argument
          ## ---
             arguments:
               a: always
             ---
          f a=(Missing_Argument.throw "a") b=1 = a + b
          """;
      // Missing_Argument may not resolve in this harness; the check is textual.
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter's `arguments` lists `a`, which has no default and is always shown."));
    }

    @Test
    public void unknownValueWarns() {
      var code =
          """
          ## ---
             arguments:
               b: sometimes
             ---
          f a b=1 = a + b
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter gives `b` the value `sometimes`; use `always`, `selected` or `when_modified`."));
    }

    @Test
    public void flowMapWarns() {
      var code =
          """
          ## ---
             arguments: {b: always}
             ---
          f a b=1 = a + b
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "Write the front matter's `arguments` as a block, one `name: value` per line."));
    }

    @Test
    public void constructorArgumentsAreChecked() {
      var code =
          """
          type T
              ## ---
                 arguments:
                   b: always
                   z: always
                 ---
              V a b=1
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter's `arguments` names `z`, which is not an argument of `V`."));
    }

    @Test
    public void selfIsNotAnArgument() {
      var code =
          """
          type T
              ## ---
                 arguments:
                   self: always
                 ---
              m self b=1 = b
          """;
      assertThat(
          warnings(code),
          containsInAnyOrder(
              "The front matter's `arguments` names `self`, which is not an argument of `m`."));
    }

    @Test
    public void readerIgnoresOtherKeysAndStopsAtDedent() {
      var result =
          ArgumentDisplayCheck.readArguments(
              "---\nicon: join\narguments:\n  b: always\n  c: selected\ngroup: X\n---\nText.");
      assertThat(result.entries(), is(Map.of("b", "always", "c", "selected")));
      assertThat(result.problems(), is(empty()));
    }

    @Test
    public void noFrontMatterMeansNoEntries() {
      var result = ArgumentDisplayCheck.readArguments("Just text.\n---\narguments:\n  b: always");
      assertThat(result.entries().isEmpty(), is(true));
    }
  }
  ```

  `warnings()` walks the IR with Scala collections from Java; if that does not
  compile as written, collect the diagnostics the way `UnusedImportsTest`'s
  `expectWarning` helper does and keep the assertions unchanged.

  If Step 1 showed the doc text keeps indentation, add a reader test with the
  indented form too. If `Missing_Argument` cannot be imported in this harness,
  replace that test's default with a local `type Missing_Argument` whose `throw`
  method returns its argument — the check compares the default's code text, not
  its resolution.

- [ ] **Step 3: Run them to see them fail.**

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh sbt_run "runtime-compiler/testOnly org.enso.compiler.test.ArgumentDisplayCheckTest"'
  ```

  Expected: compilation failure (`ArgumentDisplayCheck` and
  `Warning.ArgumentDisplay` do not exist).

- [ ] **Step 4: Add the warning.** In `Warning.java`, after
      `NonPrivateBuiltinMethod`, and add `Warning.ArgumentDisplay` to the
      `permits` clause:

  ```java
  /**
   * A problem with the {@code arguments} map of a method's or constructor's documentation front
   * matter, which the IDE reads to decide whether an argument shows on a collapsed node.
   *
   * @param identifiedLocation the location of the method or constructor
   * @param text the message
   */
  record ArgumentDisplay(IdentifiedLocation identifiedLocation, String text) implements Warning {
    @Override
    public String message(Function1<IdentifiedLocation, String> source) {
      return text;
    }
  }
  ```

  In `IrPersistance.java`, after the `NonPrivateBuiltinMethod` line:
  `@Persistable(clazz = Warning.ArgumentDisplay.class, id = 797)`. Check with
  `git log -S "NonPrivateBuiltinMethod.class" --oneline` whether adding that
  warning also bumped a version or serial UID; do the same here if so.

- [ ] **Step 5: Write the pass.** Model it on `PrivateBuiltinMethodsCheck` (same
      precursors, `createForInlineCompilation` returns `null`, `transformModule`
      walks `moduleIr.bindings()`). For each `Method.Explicit` and each
      constructor (`Definition.Type` members, `Definition.Data`) that carries
      `DocumentationComments.Doc` metadata, read the block and warn:

  ```java
  static final java.util.Set<String> VALUES = java.util.Set.of("always", "selected", "when_modified");

  record Result(java.util.LinkedHashMap<String, String> entries, java.util.List<String> problems) {}

  /**
   * The {@code arguments} block of a documentation comment's front matter: the comment must
   * start with a {@code ---} line, the block ends at the next {@code ---} line. Only the block
   * form is read (one {@code name: value} per line, indented under {@code arguments:}).
   */
  static Result readArguments(String documentation) {
    var entries = new java.util.LinkedHashMap<String, String>();
    var problems = new java.util.ArrayList<String>();
    var lines = documentation.lines().toList();
    int first = 0;
    while (first < lines.size() && lines.get(first).isBlank()) first++;
    if (first >= lines.size() || !lines.get(first).strip().equals("---")) {
      return new Result(entries, problems);
    }
    int keyIndent = -1;
    for (int i = first + 1; i < lines.size(); i++) {
      var line = lines.get(i);
      var stripped = line.strip();
      if (stripped.equals("---")) break;
      if (stripped.isEmpty()) continue;
      int indent = line.length() - line.stripLeading().length();
      if (keyIndent >= 0) {
        if (indent > keyIndent) {
          int colon = stripped.indexOf(':');
          if (colon <= 0) {
            problems.add("Write the front matter's `arguments` as a block, one `name: value` per line.");
          } else {
            entries.put(stripped.substring(0, colon).strip(), stripped.substring(colon + 1).strip());
          }
          continue;
        }
        keyIndent = -1;
      }
      if (stripped.startsWith("arguments:")) {
        if (!stripped.substring("arguments:".length()).isBlank()) {
          problems.add("Write the front matter's `arguments` as a block, one `name: value` per line.");
        } else {
          keyIndent = indent;
        }
      }
    }
    return new Result(entries, problems);
  }
  ```

  For each definition, with `name` the method's or constructor's name and `args`
  its `DefinitionArgument`s **without** `self`:

  - each problem → one warning with that text;
  - an entry whose key is not in `args` →
    ``"The front matter's `arguments` names `" + key + "`, which is not an argument of `" + name + "`."``;
  - an entry for an argument whose `defaultValue` is empty, or whose default's
    code (`showCode()`) starts with `Missing_Argument.` →
    ``"The front matter's `arguments` lists `" + key + "`, which has no default and is always shown."``;
  - a value not in `VALUES` →
    ``"The front matter gives `" + key + "` the value `" + value + "`; use `always`, `selected` or `when_modified`."``

  Attach each warning to the definition
  (`definition.getDiagnostics().add(new Warning.ArgumentDisplay(definition.identifiedLocation(), text))`).
  A method's arguments are the `Function.Lambda` arguments of its body after
  `GenerateMethodBodies` (it adds `self` for instance methods; drop the argument
  named `self`). Skip modules where `moduleContext.module().isPrivate()` only if
  the IDE never shows their methods — it does not, so skipping is fine and
  matches `PrivateBuiltinMethodsCheck`.

- [ ] **Step 6: Register it.** In `Passes.scala`, add
      `ArgumentDisplayCheck.INSTANCE` after
      `PrivateBuiltinMethodsCheck.INSTANCE` in the linting list, and import it
      beside `PrivateBuiltinMethodsCheck`. Check
      `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/PassesTest.scala`:
      if it lists the pass order, add the new pass there.

- [ ] **Step 7: Run the tests until they pass.** Same command as Step 3.
      Expected: `Passed: Total 10, Failed 0` (or the count you have). Then run
      `PassesTest` and the formatter check:

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh sbt_run "runtime-integration-tests/testOnly org.enso.compiler.test.PassesTest" "javafmtCheckAll"'
  ```

- [ ] **Step 8: Prove the standard library is still clean** (nothing has
      `arguments:` yet, so this must pass unchanged):

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh sbt_run "all lintEnso"'
  ```

- [ ] **Step 9: Commit.**

  ```bash
  git add engine/runtime-compiler engine/runtime-parser
  git commit -m "Engine: check the arguments map in doc front matter (ArgumentDisplayCheck)"
  ```

---

## Task 2: The GUI reads `arguments:` and applies `always` / `selected`

**Files:**

- Modify: `app/gui/src/project-view/components/ComponentHelp/metadata.ts`
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts`
- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/lsUpdate.ts`
- Modify:
  `app/gui/src/providers/openedProjects/suggestionDatabase/mockSuggestion.ts`
- Modify: `app/gui/src/project-view/util/callTree.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetApplication.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/hiddenParameters.ts`
- Modify: `app/gui/src/project-view/components/ComponentHelp/sections.ts`
- Test:
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/documentation.test.ts`
  (create if absent; otherwise extend),
  `app/gui/src/project-view/util/__tests__/callTree.test.ts`,
  `.../WidgetFunction/__tests__/hiddenParameters.test.ts`,
  `app/gui/src/project-view/components/ComponentHelp/__tests__/sections.test.ts`.

**Interfaces:**

- Produces:
  - `export type ArgumentDisplay = 'always' | 'selected' | 'when_modified'` (in
    `documentation.ts`);
  - `DocumentationData.argumentDisplay: ReadonlyMap<string, ArgumentDisplay>`
    and the getter `entry.argumentDisplay` on every suggestion entry;
  - `Argument.isHidden(selected: boolean): boolean` (replaces `hideByDefault`);
    `ArgumentPlaceholder.display: ArgumentDisplay | undefined`;
  - `hiddenParameters(application)` unchanged in signature, now
    `isHidden(true)`-based.
- Transitional (removed in Task 4): `isHidden` also returns `false` when the
  engine's widget says `DisplayMode.Always`, so the app behaves the same before
  the standard library is migrated.

- [ ] **Step 1: Write the failing parse tests.** Use the existing test helper
      `frontmatter()` from `metadata.ts` and `documentationData` (find the
      existing tests for `documentationData` with
      `git grep -l documentationData app/gui/src -- '*test*'` and extend that
      file):

  ```ts
  import { documentationData } from "@/providers/openedProjects/suggestionDatabase/documentation";
  import { expect, test } from "vitest";

  const doc = (yaml: string) => `---\n${yaml}---\nSummary.`;

  test.each([
    {
      yaml: "arguments:\n  on: always\n  join_kind: selected\n  x: when_modified\n",
      expected: [
        ["on", "always"],
        ["join_kind", "selected"],
        ["x", "when_modified"],
      ],
    },
    { yaml: "icon: join\n", expected: [] },
    // An unknown value drops only that entry.
    {
      yaml: "arguments:\n  a: always\n  b: sometimes\n",
      expected: [["a", "always"]],
    },
    // A non-map is ignored, not fatal to the other keys.
    { yaml: "icon: join\narguments: always\n", expected: [] },
  ])("argumentDisplay from $yaml", ({ yaml, expected }) => {
    const data = documentationData(doc(yaml), undefined, []);
    expect([...data.argumentDisplay.entries()]).toEqual(expected);
  });

  test("arguments: does not disturb the other keys", () => {
    const data = documentationData(
      doc("icon: join\narguments:\n  on: always\n"),
      undefined,
      [],
    );
    expect(data.iconName).toBe("join");
  });
  ```

  `on` is the spec's own example and a YAML 1.1 boolean; the `yaml` package
  defaults to YAML 1.2, where it is a string. The first case proves it.

- [ ] **Step 2: Run to see them fail.**
      `corepack pnpm --filter enso-gui exec vitest run <that test file>` on the
      Windows worktree (vitest is platform-neutral; run `corepack pnpm install`
      there once). Expected: `argumentDisplay` is undefined.

- [ ] **Step 3: Implement the parse.**
  - `metadata.ts`, in `documentationMetadataSchema`:

    ```ts
    /** Per-argument display on a collapsed node: `always`, `selected` or `when_modified`. */
    arguments: z.record(z.string(), z.unknown()).optional().catch(orUndefined),
    ```

  - `documentation.ts`:

    ```ts
    /** Whether an argument with a default shows on a collapsed node (front matter `arguments:`). */
    export type ArgumentDisplay = "always" | "selected" | "when_modified";
    const ARGUMENT_DISPLAYS: ReadonlySet<string> = new Set([
      "always",
      "selected",
      "when_modified",
    ]);
    function isArgumentDisplay(value: unknown): value is ArgumentDisplay {
      return typeof value === "string" && ARGUMENT_DISPLAYS.has(value);
    }
    const warnedArgumentDisplays = new Set<string>();
    function warnUnknownArgumentDisplayOnce(value: unknown) {
      const key = String(value);
      if (warnedArgumentDisplays.has(key)) return;
      warnedArgumentDisplays.add(key);
      console.warn(
        `Unknown argument display in documentation front matter: ${key}`,
      );
    }
    ```

    Add `argumentDisplay: ReadonlyMap<string, ArgumentDisplay>` (doc comment:
    "Per-argument display from the front matter's `arguments:`; absent means
    `when_modified`.") to `DocumentationData`, and in `documentationData()`:

    ```ts
    const argumentDisplay = new Map<string, ArgumentDisplay>();
    for (const [name, value] of Object.entries(metadata?.arguments ?? {})) {
      if (isArgumentDisplay(value)) argumentDisplay.set(name, value);
      else warnUnknownArgumentDisplayOnce(value);
    }
    ```

    and return `argumentDisplay`. Follow `warnUnknownIconNameOnce`'s pattern (it
    is dev-only — match whatever guard it uses).

  - `lsUpdate.ts`:
    `get argumentDisplay() { return this.documentationData.argumentDisplay }`
    beside `iconName`.
  - Fix every type error the new required field causes
    (`corepack pnpm --filter enso-gui run typecheck` or the package's `vue-tsc`
    script; objects literally typed as `DocumentationData` need
    `argumentDisplay: new Map()`).
  - `mockSuggestion.ts` `makeDocumentation`: accept
    `arguments?: Record<string, ArgumentDisplay>` and pass it to
    `frontmatter({ aliases, group, icon, arguments })`.

- [ ] **Step 4: Run the parse tests until they pass.**

- [ ] **Step 5: Write the failing visibility tests.** In `callTree.test.ts`,
      next to the existing placeholder tests (read how they build
      `ArgumentApplication`s from a mock suggestion; reuse that helper), add:

  ```ts
  describe("ArgumentPlaceholder.isHidden", () => {
    // `f a b=1 c=2 d=3 e=(Missing_Argument.throw "e")`, front matter:
    // b: always, c: selected (d unlisted → when_modified).
    const cases = [
      { name: "a", selected: false, hidden: false }, // no default
      { name: "e", selected: false, hidden: false }, // Missing_Argument default
      { name: "b", selected: false, hidden: false }, // always
      { name: "c", selected: false, hidden: true }, // selected, node not selected
      { name: "c", selected: true, hidden: false }, // selected, node selected
      { name: "d", selected: false, hidden: true }, // when_modified
      { name: "d", selected: true, hidden: true },
    ];
    test.each(cases)(
      "$name selected=$selected → hidden=$hidden",
      ({ name, selected, hidden }) => {
        const placeholder = placeholderNamed(name); // build `f` with no arguments applied
        expect(placeholder.isHidden(selected)).toBe(hidden);
      },
    );
  });
  ```

  Write `placeholderNamed` with the file's existing helpers: a callable mock
  entry made with `makeMethod`/`makeModuleMethod` (from `mockSuggestion.ts`)
  whose documentation is
  `makeDocumentation({ arguments: { b: 'always', c: 'selected' } })` and whose
  arguments are `a` (no default), `b`/`c`/`d` (defaults `1`/`2`/`3`) and `e`
  (default `Missing_Argument.throw "e"`).

  In `hiddenParameters.test.ts` add: "a `selected` argument is not in
  the ＋ menu" (it is shown whenever the menu is) and "a `when_modified`
  argument is". Keep the existing "configured to always show" case but drive it
  by front matter.

- [ ] **Step 6: Run to see them fail.**

- [ ] **Step 7: Implement visibility.**
  - `callTree.ts`:
    - `ArgumentFactory` gains a fourth constructor parameter
      `private display: ReadonlyMap<string, ArgumentDisplay> | undefined`; both
      call sites pass `suggestion?.argumentDisplay` (`FromInterpretedInfix` and
      the prefix path; `suggestion` is already destructured from `callInfo`).
    - `placeholder()` passes `this.display?.get(info.name)` as the new last
      constructor argument of `ArgumentPlaceholder`
      (`public display: ArgumentDisplay | undefined`). Update every other
      `new ArgumentPlaceholder(` (grep; tests included).
    - Replace `get hideByDefault()` on `Argument` with
      `isHidden(_selected: boolean): boolean { return false }`, and on
      `ArgumentPlaceholder` with:

      ```ts
      /**
       * Whether the argument is hidden on its node: an unset argument with a default, unless its
       * method's front matter shows it (`always`, or `selected` while its node is the sole
       * selection). A hidden argument is in its call's ＋ menu.
       */
      override isHidden(selected: boolean): boolean {
        if (!this.argInfo.hasDefault || isRequiredArgument(this.argInfo)) return false
        // Transitional until the standard library's widgets lose `display` (Task 4).
        if (this.dynamicConfig?.display === DisplayMode.Always) return false
        switch (this.display ?? 'when_modified') {
          case 'always':
            return false
          case 'selected':
            return !selected
          case 'when_modified':
            return true
        }
      }
      ```

  - `WidgetApplication.vue`: import `injectWidgetTree` from
    `@/providers/widgetTree`; `const tree = injectWidgetTree(true)`;
    `const showArgument = computed(() => !application.value.argument.isHidden(tree?.showDetails ?? false))`.
  - `hiddenParameters.ts`: `argument.isHidden(true)` instead of
    `argument.hideByDefault`, with a comment: "The menu shows only while the
    node is the sole selection, so `selected` arguments are visible then."
    Update the file's `@file` comment.
  - Grep for any other `hideByDefault` and update it (none expected beyond these
    two).

- [ ] **Step 8: Run the visibility tests until they pass.**

- [ ] **Step 9: The help panel hides the block.** `sections.ts`
      `withoutFrontMatterGroup` drops the `group` line by regex. Generalise it
      to also drop an `arguments:` line and every following line indented deeper
      than it; rename it `withoutFrontMatterIdeKeys` (update its callers and its
      doc comment: "the `group` and `arguments` keys: the help panel shows the
      category in its top bar, and argument display is the node's business").
      Test in `sections.test.ts` (extend the existing `withoutFrontMatterGroup`
      test): a front matter with `icon`, `group`, `arguments:` + two entries,
      `aliases` keeps exactly `icon` and `aliases`.

- [ ] **Step 10: Run the GUI's unit suite, lint and typecheck** on the Linux
      clone (organize-imports corrupts SFCs only on Linux, #19):

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh pnpm_ready && cd ~/enso-widgets-pr2 && corepack pnpm --filter enso-gui exec vitest run && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run typecheck'
  ```

  (Use the script names in `app/gui/package.json` if they differ.) Expected: all
  green.

- [ ] **Step 11: Commit.**

  ```bash
  git add app/gui
  git commit -m "GUI: argument display from the front matter's arguments map (always, selected)"
  ```

---

## Task 3: Migrate the standard library's display to front matter

The Widget constructors still take `display` in this task; nothing is removed.
The task adds front matter only, proved equal to today's behaviour.

**Files:**

- Create (SDD workspace, not committed):
  `.superpowers/sdd/2026-11-19-widgets-pr2-display-front-matter/inventory.mjs`,
  `.../Check_Inventory/` (a one-file Enso project), `.../apply.mjs`,
  `.../inventory.json`, `.../nested.md`.
- Modify: the `distribution/lib/Standard/**.enso` files the inventory lists.
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso` (the two
  `tables` TODO comments, lines ~272 and ~3307).

**Interfaces:**

- Consumes: Task 1's check (it validates every entry this task writes) and
  `Widget_Query.resolve_call` (PR 1a).
- Produces: front matter `arguments:` blocks; `inventory.json` rows
  `{file, line, module, type, method, argument, expression, display, source}`
  where `display` is `"Always" | "When_Modified" | "manual"` and `source` names
  the rule that decided it.

- [ ] **Step 1: Write the static inventory.** `inventory.mjs <repo root>` scans
      `distribution/lib/Standard/*/0.0.0-dev/src/**/*.enso`:

  1. **Helper defaults.** Every definition line (not starting with `@`, ending
     in `=` after trimming, inside or outside a `type` block) with a `display`
     parameter default — the regex
     `/\bdisplay\s*(?::\s*Display\s*)?=\s*(?:\.\.|Display\.)(Always|When_Modified)\b/`
     on a line whose first token is the definition's name. Key it as
     `<Qualifier>.<name>`: the enclosing `type`'s name, or the module's file
     name for a module-level definition. Also record the bare `<name>`; if a
     bare name maps to two different defaults, the bare key is ambiguous.
  2. **Annotations.** Each run of `@<arg> <expr>` lines above a definition
     (method, extension method `Type.name`, or constructor inside a `type`). For
     each, the effective display:
     - an explicit `display=..X` / `display=Display.X` in `<expr>` →
       `source: "explicit"`;
     - else a positional `..Always` / `Display.Always` / `..When_Modified` /
       `Display.When_Modified` token → `"positional"`;
     - else the callee: strip one leading `(`, an optional lambda head
       (`\w+->`), and take the first dotted identifier; look up its last two
       segments in the helper defaults, then its last segment if unambiguous →
       `"helper:<key>"`;
     - else a direct `Widget.<Ctor>` / `<Ctor>` constructor of `Widget`
       (`Single_Choice`, `Vector_Editor`, `Multiple_Choice`, `Boolean_Input`,
       `Numeric_Input`, `Text_Input`, `Folder_Browse`, `File_Browse`,
       `Secret_Browse`, `Any_To_Target`) → `When_Modified`, `"constructor"`;
     - else `"manual"`.
  3. **Module and type names.** `module` is
     `Standard.<Lib>.<path under src, dots, without .enso>` (`Main.enso` is the
     library itself, `Standard.<Lib>.Main`); `type` is the enclosing type's
     qualified name, the extension's type as written for `Type.method`, or the
     module for a module method.

  Write `inventory.json` and print counts by `display` and `source`. Expected
  roughly: 155 explicit/positional (142 Always, 13 When_Modified) and ~390
  helper-derived; investigate any `manual` count above ~30.

- [ ] **Step 2: Cross-check against the engine.** The engine's own answer is the
      truth wherever it can be computed. `Check_Inventory/src/Main.enso` imports
      every library that appears in `inventory.json`
      (`from Standard.Base import all`, `from Standard.Table import all`,
      `from Standard.Database import all`, `from Standard.AWS import all`, … one
      line per library), reads the file and, for each row, calls

  ```enso
  answer = Widget_Query.resolve_call Nothing row.module row.type row.method [row.argument] subject_is_type=True
  ```

  and extracts the argument's `widget.display.constructor` (or `"unresolved"`
  for an `error` or a `null` widget — lambdas over `self` and table helpers fail
  with a type as the subject, which is expected). Print one line per row:
  `<module> <type> <method> <argument> static=<display> engine=<display>`, then
  the number of rows where both are known and differ. Run it on the **develop**
  distribution built in this clone (Task 1's build is develop plus an engine
  check):

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh dist && ~/pr2.sh enso_run /mnt/c/Repos/Enso/ide-widgets-pr2/.superpowers/sdd/2026-11-19-widgets-pr2-display-front-matter/Check_Inventory'
  ```

  **Gate:** zero disagreements, and every `manual` row resolved by reading its
  helper. Record the counts (rows, engine-resolved, agreed, manual) and each
  fixed disagreement in the ledger. A disagreement means the static rule is
  wrong for that shape — fix `inventory.mjs`, not the row.

- [ ] **Step 3: Nested displays.** List the inline uses that are neither an
      annotation nor a parameter default:

  ```bash
  git grep -n -E "display\s*=\s*(\.\.|Display\.)(Always|When_Modified)" -- 'distribution/lib/Standard/*.enso' | grep -v -E ":\s*@" | grep -v -E "display\s*:"
  ```

  For each, decide in `nested.md` (one row each: file:line, what the widget is
  for, decision):
  - **The returned widget of a helper** (its `display` is the helper's result
    for the annotated argument) — already covered by Step 1's helper rule or the
    explicit argument; no front matter.
  - **A widget in a `Choice.Option`'s `parameters`** (e.g.
    `Option "Sum" "..Sum" [["column", make_column_name_selector display=..Always]]`)
    with `Always` → front matter `arguments: {column: always}` on the option's
    target: resolve `..Sum` against the parameter's type (here
    `Aggregate_Column.Sum`), or the qualified name written in the option. If the
    same target argument is `Always` in one option and not in another, `always`
    wins — note it.
  - **A Vector_Editor's `item_editor`** — the item editor's own display is never
    read (items are not arguments); only its options' `parameters` matter, as
    above.

- [ ] **Step 4: Apply.** `apply.mjs` takes `inventory.json` plus a small
      hand-written list from `nested.md` (`{file, definitionLine, argument}`),
      and for each definition with at least one `always` argument:
  - if its doc comment starts `## ---`, insert before the closing `---` line (or
    append under an existing `arguments:`):

    ```
           arguments:
             <argument>: always
    ```

    indented like the block's other keys (the `##` column + 3), entries 2
    deeper;

  - if its doc comment has no front matter, turn `## <first line>` into
    `## ---`, the `arguments:` block, `---` and then `<first line>` on its own
    line at the doc's text indentation;
  - if it has no doc comment, add `## ---` / block / `---` above its
    annotations.

  Arguments in the order of the definition's parameters. Do not write
  `when_modified`. Write nothing for an argument without a default (Task 1's
  check would reject it; today such arguments are always shown regardless).

- [ ] **Step 5: The `tables` TODOs.** `Table.union` / `Table.from_union`
      (`Table.enso` ~272 and ~3307) had `display=Display.Always` before PR 1b
      deleted their broken annotations. If `tables` has a default, add
      `tables: always` to each front matter; if it has none it is always shown
      already. Either way delete the two `#` TODO comments.

- [ ] **Step 6: Check it.** Build and lint; the check rejects any wrong name,
      required argument or typo:

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh sbt_run "all lintEnso"'
  ```

  Then re-run Step 2's cross-check with a mode that reads the **front matter**
  instead of the static guess (parse the inserted blocks back out of the
  sources) and compares with the engine's `display`: expected zero
  disagreements. Then rebuild the GUI-facing view: open three representative
  modules' diffs (one Table helper-derived, one AWS explicit, one nested option
  target) and confirm the blocks by eye.

- [ ] **Step 7: Commit** (the scripts stay uncommitted in the SDD workspace).

  ```bash
  git add distribution/lib/Standard
  git commit -m "Standard library: argument display in the doc front matter"
  ```

---

## Task 4: Remove `display`, `label` and `Display`

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`
- Modify: every file defining a helper with a `display` parameter, every call
  passing `display`, every positional use (greps below).
- Modify: `test/Geo_Tests/src/Geo_Widgets_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`, and any other the
  greps find.
- Modify:
  `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`,
  `app/gui/src/project-view/util/callTree.ts` and the GUI tests that build
  `DisplayMode` (listed below).
- Modify: each touched library's `docs/api/*.md` (regenerated).

**Interfaces:**

- Produces (Enso): `Widget.Single_Choice values allow_custom=True`,
  `Widget.Vector_Editor item_editor item_default`,
  `Widget.Multiple_Choice values quote_values=False`, `Widget.Boolean_Input`,
  `Widget.Numeric_Input minimum maximum step decimal_places allow_outside`,
  `Widget.Text_Input quote_values suggestions syntax`, `Widget.Folder_Browse`,
  `Widget.File_Browse existing_only action file_types`, `Widget.Secret_Browse`,
  `Widget.Any_To_Target`, `Widget.With_JSON_Cache parent json`;
  `make_single_choice values:Vector -> Widget`.
- Produces (JSON): no `"display"` and no widget-level `"label"` keys.
- Produces (GUI): no `DisplayMode`; `isHidden` without the transitional line.

- [ ] **Step 1: Failing Enso test first.** In
      `test/Base_Tests/src/Metadata_Spec.enso` (or `Widget_Query_Spec.enso`,
      wherever widget JSON is asserted) add:

  ```enso
  group_builder.specify "widget JSON carries no display or label" <|
      json = (Widget.Single_Choice [Choice.Option "A" "'A'"]).to_json
      json . should_equal '{"constructor":"Single_Choice","values":[{"label":"A","value":"\'A\'","parameters":[],"icon":""}]}'
      (Widget.Text_Input).to_json . should_equal '{"constructor":"Text_Input"}'
  ```

  Run it (`~/pr2.sh dist` then
  `~/pr2.sh enso_test Base_Tests "display or label"`); expected: FAIL (both keys
  are still emitted).

- [ ] **Step 2: `Metadata.enso`.** Delete `type Display`. Remove `label` and
      `display` from every constructor (Interfaces above), from the
      constructors' `## Arguments` docs, and from `to_json`'s patterns and
      output:

  ```enso
  to_json self -> Text = case self of
      Widget.Single_Choice values _ ->
          values_json = if values.length == 0 then '[]' else '[' + (values.map v-> v.to_json).join ',' + ']'
          '{"constructor":"Single_Choice","values":' + values_json + '}'
      Widget.Vector_Editor item_editor item_default ->
          '{"constructor":"Vector_Editor","item_editor":' + item_editor.to_json + (if item_default==Nothing then ',"item_default":"_"' else ',"item_default":' + item_default.to_json) + '}'
      Widget.Multiple_Choice values _ ->
          values_json = if values.length == 0 then '[]' else '[' + (values.map v-> v.to_json).join ',' + ']'
          '{"constructor":"Multiple_Choice","values":' + values_json + '}'
      Widget.Boolean_Input -> '{"constructor":"Boolean_Input"}'
      Widget.Numeric_Input minimum maximum _ _ _ ->
          '{"constructor":"Numeric_Input"' + (if minimum.is_nothing then '' else ',"minimum":' + minimum.to_json) + (if maximum.is_nothing then '' else ',"maximum":' + maximum.to_json) + '}'
      Widget.Text_Input _ _ syntax ->
          '{"constructor":"Text_Input"' + (if syntax.is_nothing then '' else ',"syntax":' + syntax.to_json) + '}'
      Widget.Folder_Browse -> '{"constructor":"Folder_Browse"}'
      Widget.File_Browse existing_only _ file_types ->
          '{"constructor":"File_Browse","existing_only":' + (if existing_only then "true" else "false") + ',"file_types":' + file_types.to_json + '}'
      Widget.Secret_Browse -> '{"constructor":"Secret_Browse"}'
      Widget.With_JSON_Cache _ json -> json
      _ -> self.to_js_object.to_json
  ```

  In `to_js_object`, drop the `field_names.at i == "label"` special case (keep
  the non-Nothing filter). `make_single_choice values:Vector -> Widget` ends
  `Widget.Single_Choice (values.map make_option)`. Check the `File_Action` doc
  comment ("In-lined JSON representation of the Display") and correct it to "of
  the File_Action". Fix `Base/…/docs/api/Metadata.md` by regeneration (Step 7).

  Check the JSON against the GUI's widget schema (`configuration.ts`
  `widgetConfigurationSchema`): a key the GUI requires must still be emitted —
  notably check whether the GUI's `Single_Choice` / `Multiple_Choice` schema
  requires `label` and loosen it in Step 5 before relying on the new JSON.

- [ ] **Step 3: Helpers and calls.** Remove the `display` parameter from all 71
      helper definitions and the argument from every call:

  ```bash
  git grep -n -E "\bdisplay\s*(:\s*Display\s*)?=" -- 'distribution/lib/Standard/*.enso'
  git grep -n -E "\(display\s*:\s*Display" -- 'distribution/lib/Standard/*.enso'
  git grep -n -E "Display\.(Always|When_Modified|Expanded_Only)|\.\.(Always|When_Modified|Expanded_Only)\b" -- 'distribution/lib/Standard/*.enso' 'test/*.enso'
  git grep -n -E "import .*Metadata\.Display|Metadata import .*Display|\bDisplay\b" -- 'distribution/lib/Standard/*.enso' 'test/*.enso'
  ```

  The last two must end empty apart from unrelated `..Always`-named constructors
  of other types (check each: e.g. a `Display` of a table visualisation is not
  this type). In `Table/…/Internal/Widget_Helpers.enso`, `_with_table_cache`
  keys built from `display.to_text` lose that part — keep the rest of each key
  unchanged and keep keys distinct between helpers.

- [ ] **Step 4: Positional uses.** Removing `label` (and `display`) shifts
      positions. Find every positional application of the changed constructors
      and every pattern match on them:

  ```bash
  git grep -n -E "(Single_Choice|Multiple_Choice|Vector_Editor|Boolean_Input|Numeric_Input|Text_Input|Folder_Browse|File_Browse|Secret_Browse|Any_To_Target)\b[^=\n]*\bNothing\b" -- 'distribution/lib/Standard/*.enso' 'test/*.enso'
  git grep -n -E "Widget\.(Single_Choice|Multiple_Choice|Vector_Editor|Boolean_Input|Numeric_Input|Text_Input|Folder_Browse|File_Browse|Secret_Browse|Any_To_Target)( _)+" -- 'distribution/lib/Standard/*.enso' 'test/*.enso'
  ```

  Known: `test/Geo_Tests/src/Geo_Widgets_Spec.enso:19`,
  `test/SQLite_Tests/src/Widgets_Spec.enso:41,50,56`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso:22,28`
  (`Single_Choice choices Nothing Display.Always` → `Single_Choice choices`) and
  `:50` (`Widget.Vector_Editor item _ _ _` → `Widget.Vector_Editor item _`).
  Also drop their `import Standard.Base.Metadata.Display` lines.

- [ ] **Step 5: GUI.** In `configuration.ts` delete `DisplayMode`,
      `displaySchema`, `withDisplay`/`WithDisplay`, the `.merge(withDisplay)` on
      each kind, `display` in `pending()`, and widget-level `label` on
      `Single_Choice`/`Multiple_Choice` (keep `Choice.label`, `FileType.label`).
      `FunctionCall.parameters` becomes
      `Map<string, WidgetConfiguration | null>`. In `callTree.ts`,
      `DynamicConfig` becomes `WidgetConfiguration` and the transitional
      `DisplayMode.Always` line in `isHidden` goes. Update the tests that
      construct `DisplayMode` (`callTree.test.ts:41-65,469`,
      `hiddenParameters.test.ts:78`, `formatForPath.test.ts`,
      `configuration.test.ts`, `widgetQueryAnswer.test.ts`,
      `widgetRegistry.test.ts:198`): drop `display` from fixtures; a test that
      relied on `Always` to show an argument now gets front matter through its
      mock suggestion (`makeDocumentation({ arguments: … })`). Add one
      `configuration.test.ts` case: an answer still carrying `display` and
      `label` (an older library) parses, and the keys are dropped.

- [ ] **Step 6: Run everything Enso touches,** the CI way:

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh dist && ~/pr2.sh sbt_run "all lintEnso" && for s in Base_Tests Table_Tests SQLite_Tests Geo_Tests Format_Discovery_Tests Visualization_Tests AWS_Tests Microsoft_Tests Snowflake_Tests Google_Api_Test Examples_Tests; do echo "== $s"; ~/pr2.sh stdlib_test $s 2>&1 | tail -5; done'
  ```

  (Take the exact suite names from `tools/ci/stdlib-test-map.yaml`; skip ones
  that need credentials the same way CI does.) Expected: the Step 1 test passes;
  every suite's count line shows 0 failed, compared with the same suites on
  develop (run them there first if a failure looks unrelated — root `CLAUDE.md`,
  "Attribute CI failures carefully").

- [ ] **Step 7: Annotation sweep.** Re-run Task 3's cross-check in a third mode:
      every row's annotation must now resolve to a widget **or** fail exactly as
      it did on develop (same rows unresolved). A row that resolved on develop
      and now errors is a positional-shift bug. Expected: zero such rows. Then
      regenerate API docs for every touched library:

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc 'cd ~/enso-widgets-pr2 && corepack pnpm --filter build-scripts run stdlib-api-check'
  ```

  Copy each library's regenerated `docs/api/` back into the Windows worktree
  (`rsync -a --delete built-distribution/enso-engine-*/enso-*/lib/Standard/<Lib>/0.0.0-dev/docs/api/ /mnt/c/Repos/Enso/ide-widgets-pr2/distribution/lib/Standard/<Lib>/0.0.0-dev/docs/api/`
  for each touched `<Lib>`), then re-run `stdlib-api-check` after
  `~/pr2.sh sync`: expected clean.

- [ ] **Step 8: GUI checks** (as Task 2 Step 10). Expected green.

- [ ] **Step 9: Commit.**

  ```bash
  git add distribution test app/gui
  git commit -m "Widgets lose display and label; Display is deleted"
  ```

---

## Task 5: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/lsHandler.ts`
- Modify: `app/gui/integration-test/mock/data/mockSuggestions.json` (or the
  module the mock suggestion database is built from)
- Modify: `app/gui/integration-test/project-view/argumentAccess.spec.ts`,
  `widgets.spec.ts`, `autoImports.spec.ts`, `dataReadImports.spec.ts`

**Interfaces:**

- Consumes: Task 2's `arguments:` parsing; Task 4's widget JSON.

- [ ] **Step 1: Mocks.** In `lsHandler.ts` `initialMockWidgetConfigurations`
      (and anything building widget JSON for the mock), remove every `display`
      (`Always` at ~402, 432, 480, 520, 526, 529; `When_Modified` at ~543) and
      widget-level `label`. For each removed `Always` on a **top-level**
      argument of a mocked method, add that argument to the method's front
      matter in the mock suggestion database (`arguments:\n  <name>: always`),
      so the specs see the same nodes. Nested `Always`s go on the mocked
      constructor's entry. Specs that write raw
      `display: { constructor: 'Always' }`
      (`widgets.spec.ts:367,462,491,553,559,621,664,670`,
      `autoImports.spec.ts:72`, `dataReadImports.spec.ts:44`): drop the key and,
      where the test needs the argument visible, rely on the front matter
      instead.

- [ ] **Step 2: Run the affected specs and read the failures** before changing
      any assertion. A changed `.WidgetTopLevelArgument` count or
      `showHiddenArguments` result must be explained by a front-matter
      difference, not papered over:

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh pnpm_ready && cd ~/enso-widgets-pr2/app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/widgets.spec.ts integration-test/project-view/argumentAccess.spec.ts integration-test/project-view/autoImports.spec.ts integration-test/project-view/dataReadImports.spec.ts --workers=2'
  ```

- [ ] **Step 3: New test — `selected`.** In `argumentAccess.spec.ts`, beside
      "selecting a node does not show hidden arguments": give a mocked method an
      argument with `selected` in its front matter and assert:
  1. not selected: the argument is not shown;
  2. sole selection: it is shown (with its name), and it is **not** in
     the ＋ menu (`openAddArgumentMenu` lists only the others);
  3. two nodes selected: it is not shown;
  4. deselected: hidden again.

- [ ] **Step 4: New test — no pop-in.** In `widgets.spec.ts`: an `always`
      argument is visible while its widget query is still pending (hold the
      mock's answer with the existing `clearMockWidgetConfigurations`/
      `restoreMockWidgetConfigurations` or a delayed response) and stays visible
      when the query fails.

- [ ] **Step 5: Run the full project-view suite three times on this branch** and
      compare with develop (timing-sensitive suite; root CLAUDE.md):

  ```bash
  wsl -d Ubuntu-24.04 -e bash -lc '~/pr2.sh pnpm_ready && cd ~/enso-widgets-pr2/app/gui && corepack pnpm exec playwright test --project="Integration Tests" --workers=2 --repeat-each=3'
  ```

  Expected: only the failures that also fail on develop (PR 1b saw `codeFont` ×2
  and `collapsingAndEntering` on its base).

- [ ] **Step 6: Commit.**

  ```bash
  git add app/gui/integration-test
  git commit -m "Playwright: front-matter display mocks; selected and no-pop-in tests"
  ```

---

## Task 6: Docs, changelog, screenshots, PR

**Files:**

- Modify: `CHANGELOG.md`
- Modify CLAUDE.md files that describe display:
  `app/gui/src/providers/openedProjects/suggestionDatabase/CLAUDE.md`,
  `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`
  (the ＋ menu section, ~178-194),
  `app/gui/src/project-view/components/ComponentHelp/CLAUDE.md`, the widget
  registry's CLAUDE.md (find it beside `configuration.ts`),
  `distribution/lib/Standard/Base/CLAUDE.md` (or the closest one covering
  `Metadata.enso`), `engine/runtime-compiler/CLAUDE.md` (the lint passes) —
  `git grep -l -i "display" -- '*CLAUDE.md'` for any other.
- Wiki: the page that lists front-matter keys (`git grep`-equivalent over the
  wiki checkout: search for `macro_for`; see `docs/CLAUDE.md` for how to read
  the wiki locally).

- [ ] **Step 1: Draft PR for the number.** Push and open a draft PR titled
      "Widgets PR 2: argument display in the doc front matter (`always`,
      `selected`)" to get `NNN`.

- [ ] **Step 2: Changelog entry** under `# Next Release` → `#### Enso IDE`:

  ```
  - [Arguments a component always shows appear on its node at once, and a
    library can show an argument only while its node is selected][NNN]
  ```

  with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` among the link
  definitions. Run `corepack pnpm exec prettier --check CHANGELOG.md`.

- [ ] **Step 3: CLAUDE.md and wiki.** Describe: the `arguments:` key and its
      three values; the rule (no default → shown; otherwise the front matter);
      that the engine's `ArgumentDisplayCheck` validates it and `lintEnso` fails
      on it; that widgets have no `display`/`label`. In the wiki's front-matter
      list add `arguments` beside `group`/`icon` with the spec's `join` example.

- [ ] **Step 4: Screenshots** on the `pr-screenshots` branch (worktree
      `C:\Repos\Enso\ide-prshots`): a node with a `selected` argument,
      unselected and selected; a `join` node before (develop) and after (no
      pop-in is not visible in a still; one before/after of the settled node
      suffices). Link them in the PR body.

- [ ] **Step 5: PR body.** Summary; the decisions above (short); the inventory
      numbers (rows, engine-agreed, manual, nested targets); what was **not**
      verified (e.g. suites needing cloud credentials); the owner's installer
      checklist:
  - a Table `join`: `on` shows immediately, before the engine answers;
  - a node using `Aggregate_Column.Sum`: its `column` shows as before;
  - the ＋ menu lists the same arguments as on develop for `read`, `aggregate`,
    `filter`;
  - the Documentation panel shows no `arguments:` block. End with `Closes` lines
    only if a ticket is fully done (none expected; #850 is merged). Mark ready.

- [ ] **Step 6: Commit and push** the changelog/docs commit; watch CI.

---

## Task 7: Final verification

- [ ] Linux, from a clean `~/pr2.sh sync`: `all lintEnso`;
      `runtime-compiler/testOnly *ArgumentDisplayCheckTest`; the Task 4 suite
      loop; GUI vitest, lint, typecheck; the Task 5 Playwright run ×3;
      `node tools/ci/check-workflows.mjs`; `stdlib-api-check`.
- [ ] `git grep -n -E "\bDisplay\.(Always|When_Modified|Expanded_Only)|DisplayMode|hideByDefault" -- distribution test app/gui/src app/gui/integration-test`
      → empty.
- [ ] Ledger: inventory counts; nested decisions; any `always`-wins conflicts.
- [ ] Ask the owner for an installer test (Windows by default; a dmg only if
      asked) before merge — this is a feature.

---

## Owner questions (before Task 3)

1. Should any standard-library argument become `selected` in this PR (the spec's
   example is `join`'s `join_kind`)? The plan says **no** — behaviour-preserving
   — and leaves `selected` to later per-method choices.
