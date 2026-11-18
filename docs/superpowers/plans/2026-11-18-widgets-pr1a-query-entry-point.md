# Widgets PR 1a: Widget Query Entry Point — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Standard.Base` gains the IDE's widget query entry point,
`Standard.Base.Metadata.Widget_Query.resolve_call`. It finds the called method
exactly (module, type, name) and answers, per argument, a widget or an error.
Each error is logged once, and each query is timed under the performance-timings
setting. The engine builtins it needs, `Meta.call_module_method` (which PR 1b
uses for in-frame queries) and a benchmark come with it. The widget tests move
to the libraries that own the code. The GUI is untouched: it keeps calling
`Standard.Visualization.Widgets.get_widget_json`, which stays exactly as it is
until PR 1b.

**Architecture:** Three small engine builtins (`Meta.get_method_annotation`,
`Meta.find_type_or_module`, `Meta.get_module_method`, over one Java
`MethodLookup`) look a definition up by module, type and name rather than by
dispatch on a value. `Widget_Query.resolve_call`, a module method so that the
GUI can call it by method pointer in PR 1b, evaluates today's annotations
unchanged through them. It turns failures into per-argument errors, which it
logs once through a Java `LogOnce`, and runs inside `Progress.run`.
`Meta.call_module_method` lets an expression evaluated in a user's module call a
library's entry point without importing it.

**Tech Stack:** Enso (Base, Table, Database, SQLite, Geo, test projects,
Benchmarks), Java 21 / Truffle (engine builtins, `std-bits/base`), sbt.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md

## Global Constraints

- Implementation worktree: `C:\Repos\Enso\ide-widgets-pr1a`, branch
  `widgets/pr1a-query-entry-point`, from `develop`.
- Linux clone for every build and run: `~/enso-widgets-pr1a` on WSL
  `Ubuntu-24.04` (helper script `~/pr1a.sh`, below). Delete it when the PR is
  merged.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is
  checked out in a worktree.
- **The GUI and `Standard.Visualization` are not changed.**
  `Standard.Visualization.Widgets.get_widget_json` keeps its body and its JSON.
  PR 1b deletes it.
- Entry point:
  `Standard.Base.Metadata.Widget_Query.resolve_call value module_name type_name method_name argument_names uuids="{}" subject_is_type=False`.
- Answer JSON:
  `{"arguments":[[<name>,{"widget":<Widget JSON or null>}|{"error":{"step":"lookup"|"annotation","message":<text>}}],…]}`.
- `Meta.call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value`:
  the module method applied to `value`, then to each argument.
- Engine failure log: logger `Standard.Base.Metadata.Widget_Query`, WARN, once
  per (module, method, argument, subject type + uuids, step, message) per engine
  session.
- Engine timing: `Progress.run` with handle `Widget_Query.<type>.<method>`,
  logged as `ADVANCE …~<ms>ms` at DEBUG under `Standard.Base.Logging.Progress`
  (Settings → Local → Engine logs → Performance timings, #342).
- `Widget.resolve_type` is **not** in this PR. It belongs to PR 3, which needs
  PR 0's `X.type` conversions.
- `cache` and `Runtime.value_for_uuid` stay; PR 6 replaces them.
- PR label `CI: No changelog needed`: nothing a user can see changes.
- Every commit message ends with a blank line and then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Decisions and the evidence for them

These were checked in the code. Implementers do not need to re-derive them, but
should know why. PR 1b's plan (`2026-11-18-widgets-pr1b-gui-method-pointers.md`)
has the GUI-side ones.

1. **The entry point is a module method, not `Widget.resolve_call`.** A
   method-pointer visualization is prepared by
   `ExecutionService.prepareFunctionCall`
   (`engine/runtime-instrument-common/.../ExecutionService.java:129`). It looks
   up `scope.getType(typeName, false)` and `lookupMethodDefinition(type, name)`
   and pre-applies the type as `self`. Static methods are registered on the
   eigentype (`IrToTruffle.associatedTypeFromResolvedType`,
   `isStatic → getEigentype`), so a static `Widget.resolve_call` is not found
   that way. Every existing preprocessor is a module method. The module is
   `Standard.Base.Metadata.Widget_Query` (`src/Metadata/Widget_Query.enso`,
   beside `Metadata.enso`, as `Data.enso` sits beside `Data/`). Widgets are
   metadata, and Base is always loaded. PR 3 adds `resolve_type` to the same
   module.
2. **Exact lookup needs an engine builtin.**
   `Meta.get_annotation value .name arg` (`GetAnnotationNode`) resolves `.name`
   on the value's types. The `UnresolvedSymbol` is scoped where `.name` was
   written: today that is the user's module, compiled from the `.name`
   positional argument. Moving that into Base would lose the user module's
   extension methods. Dispatch also picks the wrong definition:
   `AnyOrStaticTest.methodOnTypeAndAny` shows a type value dispatching to
   `Any.check_is` rather than the type's own static `check_is`. A static method
   is never found on an instance value. The new `MethodLookup` takes module,
   type and name. It compiles the module (`module.compileScope(ctx)`, as
   `LookupServicesNode` already does at run time) and takes
   `scope.getMethodForType(type, name)`, then the eigentype (static), then the
   type's constructor.
3. **`Meta.find_type_or_module` instead of `Meta.Type.find`.**
   `FindTypeByFqnNode` calls `getType(item, false)`, which returns the module's
   associated type whenever the module and the type share a name
   (`TruffleCompilerModuleScopeBuilder:48` names the associated type after the
   module's last segment). So `Standard.Table.Table.Table` resolves to the
   module, not the type. `MethodLookup.findType` asks for real types first
   (`getType(item, true)`) and falls back to the module. This is reported, not
   fixed, because `Meta.Type.find` is public.
4. **`time_visualization` is not the #342 setting.** It is gated by
   `ENSO_PROFILE_VIZZES` (`Visualization/src/Helpers.enso:53`). Settings → Local
   → Engine logs → Performance timings turns `Standard.Base.Logging.Progress` up
   to DEBUG (`app/common/src/services/engineLogs.ts:107`), and
   `ProgressHandle.close` logs `ADVANCE <handle>+<n>~<ms>ms` there. So
   `resolve_call` wraps itself in `Progress.run`, with a bounded handle name,
   because `ProgressTimingCollector` caps distinct handles at 100,000.
5. **The benchmark goes in `test/Benchmarks`** as
   `src/Widgets/Widget_Query_Bench.enso` (`collect_benches`, registered in
   `Main.enso`), plus `Widget_Query_Report.enso`, which prints the baseline
   table (cold, warm, KB). DuckDB is optional at run time: the CI benchmark job
   also runs off Linux.
6. **`get_widget_json` keeps its body in this PR.** A wrapper over
   `resolve_call` cannot be exact: `get_widget_json` receives the method as
   `.name`, an `UnresolvedSymbol` with no module or type, so a wrapper would
   have to resolve it by dispatch again. It would also have to turn errors back
   into `null`, dropping their logging. Keeping the body is smaller and changes
   nothing the GUI sees. One test in `Visualization_Tests` pins today's
   array-of-pairs shape until PR 1b deletes the module.

## Working environment

Create the worktree and the Linux clone once (check free space on `E:` first;
agent clones filled it before):

```powershell
git -C C:\Repos\Enso\ide worktree add -b widgets/pr1a-query-entry-point C:\Repos\Enso\ide-widgets-pr1a origin/develop
wsl -d Ubuntu-24.04 -e bash -lc 'df -h ~ && git clone /mnt/c/Repos/Enso/ide-widgets-pr1a ~/enso-widgets-pr1a && cd ~/enso-widgets-pr1a && git checkout widgets/pr1a-query-entry-point'
```

Create `~/pr1a.sh` in WSL (`chmod +x ~/pr1a.sh`; it is not part of the
repository). It mirrors the Windows worktree, uncommitted edits included, into
the clone before each run:

```bash
#!/usr/bin/env bash
# Widgets PR 1a helpers: pr1a.sh <function> [args...]
set -euo pipefail
. ~/.enso-toolchain.sh
WIN=/mnt/c/Repos/Enso/ide-widgets-pr1a
LNX=$HOME/enso-widgets-pr1a
export CARGO_TARGET_DIR=$HOME/enso-target
sync() {
  rsync -a --delete --exclude=.git/ --exclude=node_modules/ --exclude=target/ \
    --exclude=built-distribution/ --exclude=dist/ --exclude=.enso/ --exclude=.bloop/ \
    --exclude=.bsp/ --exclude=.metals/ --exclude='*.tsbuildinfo' --exclude=.eslintcache \
    "$WIN/" "$LNX/"
}
dist() { sync; (cd "$LNX" && sbt buildEngineDistributionNoIndex); }
sbt_run() { sync; (cd "$LNX" && sbt "$@"); }
# enso_test <Suite> [filter]: run from test/, the project's parent (root CLAUDE.md trap 1).
enso_test() {
  (cd "$LNX/test" && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/$1" ${2:+"$2"})
}
pnpm_ready() { sync; (cd "$LNX" && corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile); }
pnpm_run() { sync; (cd "$LNX" && corepack pnpm "$@"); }
"$@"
```

Every Enso run is checked for its count line, because a filter that matches
nothing still exits 0 (root CLAUDE.md trap 2). Each step names the
`N tests succeeded.` it expects.

## File Structure

**Engine (Java)**

- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/MethodLookup.java`:
  find a type or module by name, and a method by module + type + name.
- Create `…/builtin/meta/GetMethodAnnotationNode.java`:
  `Meta.get_method_annotation`.
- Create `…/builtin/meta/FindTypeOrModuleNode.java`: `Meta.find_type_or_module`.
- Create `…/builtin/meta/GetModuleMethodNode.java`: `Meta.get_module_method`.
- Create
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java`.

**std-bits**

- Create `std-bits/base/src/main/java/org/enso/base/LogOnce.java`: a bounded
  "first time?" set for the session.

**Standard library**

- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso`:
  three builtin stubs.
- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso`:
  `get_method_annotation`, `find_type_or_module`, `call_module_method`.
- Create
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`:
  `resolve_call`, `resolve_argument`, `log_failure`, `Widget_Method`,
  `Widget_Failure`, `Argument_Result`.
- Regenerate `distribution/lib/Standard/Base/0.0.0-dev/docs/api/`.
- Modify `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`.
- **Not changed:** `distribution/lib/Standard/Visualization/**`.

**Enso tests and benchmark**

- Create `test/Base_Tests/src/Widget_Query_Spec.enso` and
  `test/Base_Tests/src/Base_Widgets_Spec.enso`; modify
  `test/Base_Tests/src/Main.enso`.
- Create `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`; modify
  `test/Table_Tests/src/In_Memory/Main.enso`.
  `test/Table_Tests/src/Internal/Widget_Helpers_Spec.enso` drops its `Widgets`
  import.
- Create `test/SQLite_Tests/src/Widgets_Spec.enso`; modify
  `test/SQLite_Tests/src/Main.enso`.
- Create `test/Geo_Tests/src/Geo_Widgets_Spec.enso`; modify
  `test/Geo_Tests/src/Main.enso`.
- Create `test/Format_Discovery_Tests/src/Data_Read_Widgets_Spec.enso`; modify
  `test/Format_Discovery_Tests/src/Main.enso`.
- Modify `test/Postgres_Tests/src/Library_Discovery_Spec.enso`.
- Delete `test/Visualization_Tests/src/Widgets/` (5 files). Rewrite
  `test/Visualization_Tests/src/Widgets_Spec.enso` to the one old-shape test.
- Modify `tools/ci/stdlib-test-map.yaml`.
- Create `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso` and
  `test/Benchmarks/src/Widgets/Widget_Query_Report.enso`; modify
  `test/Benchmarks/src/Main.enso`.

---

## Task 1: Confirm the fully-qualified-name rule (spike, no commit)

PR 1b's in-frame changes (its Decision 2) rest on this, and
`Meta.call_module_method` (Task 3) exists for them. Ten minutes, before any
code.

**Files:** none in the repository (scratch project under `/tmp` in WSL).

**Interfaces:** Consumes: the built distribution on `develop`. Produces:
evidence for the PR description.

- [ ] **Step 1: Build develop's distribution in the clone**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist'
```

- [ ] **Step 2: Run a project that names `Standard.Visualization` without
      importing it, while Table (which loads Visualization's submodules) is
      imported**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '. ~/.enso-toolchain.sh && rm -rf /tmp/fqn && mkdir -p /tmp/fqn/Fqn/src && printf "name: Fqn\nversion: 0.0.1\nprefer-local-libraries: true\n" > /tmp/fqn/Fqn/package.yaml && printf "from Standard.Base import all\nfrom Standard.Table import all\n\nmain = IO.println (Standard.Visualization.Tree.prepare 1)\n" > /tmp/fqn/Fqn/src/Main.enso && cd /tmp/fqn && ~/enso-widgets-pr1a/built-distribution/enso-engine-*/enso-*/bin/enso --run "$PWD/Fqn"; echo exit=$?'
```

Expected:
`Fully qualified name references a library Standard.Visualization but an import statement for it is missing`.
Record the output for the PR description. If it prints a tree instead, PR 1b's
in-frame changes are still harmless, but say so in the PR (and in PR 1b's).

- [ ] **Step 3: The same through `Standard.Base` works.** After Task 3, rerun
      with
      `main = IO.println (Standard.Base.Meta.call_module_method "Standard.Visualization.Tree" "prepare" [] 1)`;
      expect the tree JSON. Note it for the PR.

---

## Task 2: Engine — find a method exactly

**Files:**

- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/MethodLookup.java`
  (~75 lines)
- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetMethodAnnotationNode.java`
  (~60 lines)
- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/FindTypeOrModuleNode.java`
  (~30 lines)
- Create
  `engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetModuleMethodNode.java`
  (~25 lines)
- Modify
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso`
  (after line 36)
- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso` (after
  `get_annotation`, line 441)
- Create
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java`
  (~110 lines)

**Interfaces:**

- Produces (Java, package-private):
  `MethodLookup.findType(EnsoContext ctx, String qualifiedName) -> Type | null`
  and
  `MethodLookup.findMethod(Node location, String moduleName, String typeName, String methodName) -> Function | DataflowError`.
- Produces (Enso, `Standard.Base.Meta`, all `private: true` in the front
  matter):
  - `get_method_annotation (module_name : Text) (type_name : Text) (method_name : Text) (parameter_name : Text) -> Any`:
    the evaluated annotation, `Nothing`, or a `No_Such_Method` /
    `Module_Does_Not_Exist` error.
  - `find_type_or_module (qualified_name : Text) -> Any`: the type, else the
    module's associated type, else `Module_Does_Not_Exist`.
  - `call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value -> Any`:
    added in Task 3, but its builtin stub lands here.
- Produces (`Meta_Helpers`): `get_method_annotation_builtin`,
  `find_type_or_module_builtin`, `get_module_method_builtin`.

- [ ] **Step 1: Write the failing engine test**

`engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java`:

```java
package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.util.Set;
import org.enso.pkg.QualifiedName;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * `Meta.get_method_annotation`, `Meta.find_type_or_module` and `Meta.call_module_method` find a
 * definition by module, type and name, as the IDE's method pointers name it: exactly that
 * definition, not the one dispatch on a value would pick.
 */
public class MethodLookupTest {
  @Rule public TemporaryFolder tempFolder = new TemporaryFolder();

  @Test
  public void findsExactlyTheNamedDefinition() throws IOException {
    var types =
        new SourceModule(
            QualifiedName.fromString("Types"),
            """
            from Standard.Base import all

            type T
                @x ("constructor x")
                Value x

                @a ("instance a")
                inst self a = a

                @a ("static a")
                stat a = a

                @a ("T's probe")
                probe self a = a

            @a ("Any's probe")
            Any.probe self a = a

            @a ("module a")
            module_method a = a
            """);
    // Not imported by Main: the lookup compiles a registered module itself.
    var ext =
        new SourceModule(
            QualifiedName.fromString("Ext"),
            """
            from Standard.Base import all
            from project.Types import T

            @a ("extension a")
            T.ext self a = a
            """);
    var main =
        new SourceModule(
            QualifiedName.fromString("Main"),
            """
            from Standard.Base import all
            import project.Types

            show r = if r.is_error then "error:" + (Meta.type_of r.catch . to_text) else r.to_text

            main =
                t = "local.Proj.Types.T"
                m = "local.Proj.Types"
                results = Vector.build b->
                    b.append (show (Meta.get_method_annotation m t "inst" "a"))
                    b.append (show (Meta.get_method_annotation m t "stat" "a"))
                    b.append (show (Meta.get_method_annotation m t "Value" "x"))
                    b.append (show (Meta.get_method_annotation "local.Proj.Ext" t "ext" "a"))
                    b.append (show (Meta.get_method_annotation m m "module_method" "a"))
                    b.append (show (Meta.get_method_annotation m "Standard.Base.Any.Any" "probe" "a"))
                    b.append (show (Meta.get_method_annotation m t "probe" "a"))
                    b.append (show (Meta.get_method_annotation m t "inst" "zzz"))
                    b.append (show (Meta.get_method_annotation m t "missing" "a"))
                    b.append (show (Meta.get_method_annotation "local.Proj.Nope" "local.Proj.Nope" "f" "a"))
                    b.append (show (Meta.find_type_or_module t . to_text))
                    b.append (show (Meta.call_module_method m "module_method" [] 5))
                results.join "|"
            """);
    var projDir = tempFolder.newFolder().toPath();
    ProjectUtils.createProject("Proj", Set.of(types, ext, main), projDir);
    ProjectUtils.testProjectRun(
        projDir,
        res ->
            assertEquals(
                "instance a|static a|constructor x|extension a|module a|Any's probe|T's probe"
                    + "|Nothing|error:No_Such_Method|error:Module_Does_Not_Exist|T|5",
                res.asString()));
  }
}
```

(`SourceModule` is in `org.enso.test.utils`, as `ExtensionMethodResolutionTest`
uses it. If the import differs, copy that test's imports.)

- [ ] **Step 2: Run it and see it fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh sbt_run "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest"'
```

Expected: FAIL. The project does not compile: `Meta.get_method_annotation` does
not exist (a `No_Such_Method` on `Meta`).

- [ ] **Step 3: `MethodLookup.java`**

```java
package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.UnresolvedSymbol;
import org.enso.interpreter.runtime.callable.function.Function;
import org.enso.interpreter.runtime.data.Type;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.pkg.QualifiedName;

/**
 * Finds a method by the names an IDE method pointer gives it: the module that defines it, the type
 * (or module) it is defined on, and its name. Unlike dispatch on a value ({@code
 * Meta.get_annotation}), this finds exactly that definition: a static method, an extension method
 * defined in another module, or a method of {@code Any} that the value's own type also defines.
 * Each module is compiled on first use, as {@link LookupServicesNode} does.
 */
final class MethodLookup {
  private MethodLookup() {}

  /**
   * The type named {@code qualifiedName}: one defined in its parent module, or else the module
   * itself (its associated type, which module methods are defined on); {@code null} when neither
   * is loaded. A type wins over a module of the same name: {@code Standard.Table.Table.Table} is
   * the type ({@code Meta.find_type_by_qualified_name} gives the module there).
   */
  @TruffleBoundary
  static Type findType(EnsoContext ctx, String qualifiedName) {
    var name = QualifiedName.fromString(qualifiedName);
    if (name.getParent().isDefined()) {
      var parent = ctx.getTopScope().getModule(name.getParent().get().toString());
      if (parent.isPresent()) {
        var type = parent.get().compileScope(ctx).getType(name.item(), true);
        if (type != null) {
          return type;
        }
      }
    }
    var module = ctx.getTopScope().getModule(qualifiedName);
    return module.isPresent() ? module.get().compileScope(ctx).getAssociatedType() : null;
  }

  /**
   * The function {@code methodName} that the module {@code moduleName} defines on {@code
   * typeName}: an instance method, else a static one, else the type's constructor. A dataflow
   * error ({@code Module_Does_Not_Exist}, {@code No_Such_Method}) when there is none.
   */
  @TruffleBoundary
  static Object findMethod(Node location, String moduleName, String typeName, String methodName) {
    var ctx = EnsoContext.get(location);
    var errors = ctx.getBuiltins().error();
    var module = ctx.getTopScope().getModule(moduleName);
    if (module.isEmpty()) {
      return DataflowError.withDefaultTrace(
          errors.makeModuleDoesNotExistError(moduleName), location);
    }
    var scope = module.get().compileScope(ctx);
    var type = findType(ctx, typeName);
    if (type == null) {
      return DataflowError.withDefaultTrace(errors.makeModuleDoesNotExistError(typeName), location);
    }
    Function function = scope.getMethodForType(type, methodName);
    if (function == null && !type.isEigenType()) {
      function = scope.getMethodForType(type.getEigentype(), methodName);
    }
    if (function == null) {
      var constructor = type.getConstructors().get(methodName);
      if (constructor != null) {
        function = constructor.getConstructorFunction();
      }
    }
    if (function == null) {
      var symbol = UnresolvedSymbol.build(methodName, scope);
      return DataflowError.withDefaultTrace(errors.makeNoSuchMethod(type, symbol), location);
    }
    return function;
  }
}
```

- [ ] **Step 4: The three builtins**

`GetMethodAnnotationNode.java`, which evaluates the annotation as
`GetAnnotationNode.executeAnnotation` does:

```java
package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.dsl.Cached;
import com.oracle.truffle.api.dsl.Specialization;
import com.oracle.truffle.api.frame.VirtualFrame;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.BaseNode;
import org.enso.interpreter.node.callable.thunk.ThunkExecutorNode;
import org.enso.interpreter.node.expression.builtin.text.util.ExpectStringNode;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.Annotation;
import org.enso.interpreter.runtime.callable.function.Function;

@BuiltinMethod(
    type = "Meta",
    name = "get_method_annotation",
    description =
        "The annotation of a parameter of the method a module defines on a type, found by name")
@SuppressWarnings("truffle-splitting")
public abstract class GetMethodAnnotationNode extends BaseNode {
  static GetMethodAnnotationNode build() {
    return GetMethodAnnotationNodeGen.create();
  }

  abstract Object execute(
      VirtualFrame frame, Object moduleName, Object typeName, Object methodName, Object parameter);

  @Specialization
  Object doExecute(
      VirtualFrame frame,
      Object moduleName,
      Object typeName,
      Object methodName,
      Object parameter,
      @Cached ExpectStringNode expectStringNode,
      @Cached ThunkExecutorNode thunkExecutorNode) {
    var found =
        MethodLookup.findMethod(
            this,
            expectStringNode.execute(moduleName),
            expectStringNode.execute(typeName),
            expectStringNode.execute(methodName));
    if (!(found instanceof Function function)) {
      return found;
    }
    var annotation = annotationOf(function, expectStringNode.execute(parameter));
    var ctx = EnsoContext.get(this);
    if (annotation == null) {
      return ctx.getNothing();
    }
    var thunk = Function.thunk(annotation.getExpression().getCallTarget(), frame.materialize());
    return thunkExecutorNode.executeThunk(frame, thunk, ctx.currentState(), getTailStatus());
  }

  @TruffleBoundary
  private static Annotation annotationOf(Function function, String parameter) {
    return function.getSchema().getAnnotation(parameter);
  }
}
```

`FindTypeOrModuleNode.java`:

```java
package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.data.text.Text;
import org.enso.interpreter.runtime.error.DataflowError;

@BuiltinMethod(
    type = "Meta",
    name = "find_type_or_module",
    description = "A type by qualified name, preferring a type to a module of the same name")
public class FindTypeOrModuleNode extends Node {
  @TruffleBoundary
  Object execute(Text qualifiedName) {
    var ctx = EnsoContext.get(this);
    var type = MethodLookup.findType(ctx, qualifiedName.toString());
    if (type != null) {
      return type;
    }
    var error = ctx.getBuiltins().error().makeModuleDoesNotExistError(qualifiedName.toString());
    return DataflowError.withDefaultTrace(error, this);
  }
}
```

`GetModuleMethodNode.java`:

```java
package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives.TruffleBoundary;
import com.oracle.truffle.api.nodes.Node;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.runtime.data.text.Text;

@BuiltinMethod(
    type = "Meta",
    name = "get_module_method",
    description = "The function of a module's method, by the module's and the method's names")
public class GetModuleMethodNode extends Node {
  @TruffleBoundary
  Object execute(Text moduleName, Text methodName) {
    var module = moduleName.toString();
    return MethodLookup.findMethod(this, module, module, methodName.toString());
  }
}
```

- [ ] **Step 5: Enso stubs and wrappers**

`Internal/Meta_Helpers.enso`, after `find_type_by_qualified_name_builtin`:

```enso
get_method_annotation_builtin module_name type_name method_name parameter_name = @Builtin_Method "Meta.get_method_annotation"
find_type_or_module_builtin qualified_name = @Builtin_Method "Meta.find_type_or_module"
get_module_method_builtin module_name method_name = @Builtin_Method "Meta.get_module_method"
```

`Meta.enso`, after `get_annotation` (line 441):

```enso
## ---
   private: true
   ---
   The annotation of the parameter `parameter_name` of exactly the method
   `method_name` that the module `module_name` defines on `type_name`: an
   instance method, a static method or a constructor. `type_name` is a type's
   qualified name, or the module's for a module method. The IDE names methods
   this way (its method pointers), so an extension method or a method of `Any`
   is found even when dispatch on a value would pick another one.

   ## Arguments
    - `module_name`: The qualified name of the module that defines the method.
    - `type_name`: The qualified name of the type (or module) it is defined on.
    - `method_name`: The method's or constructor's name.
    - `parameter_name`: The name of the parameter.

   ## Returns
   The evaluated annotation, or `Nothing` when the parameter has none. A
   `No_Such_Method` or `Module_Does_Not_Exist` error when there is no such
   method.
get_method_annotation (module_name : Text) (type_name : Text) (method_name : Text) (parameter_name : Text) -> Any =
    @Tail_Call Meta_Helpers.get_method_annotation_builtin module_name type_name method_name parameter_name

## ---
   private: true
   ---
   The type named `qualified_name`, or else the module of that name (the type
   its module methods are defined on). A type wins over a module of the same
   name: `Standard.Base.Data.Boolean.Boolean` is the type.

   ## Arguments
    - `qualified_name`: The type's or the module's qualified name.
find_type_or_module (qualified_name : Text) -> Any =
    Meta_Helpers.find_type_or_module_builtin qualified_name
```

- [ ] **Step 6: Build and run the test until it passes** (`call_module_method`
      comes in Task 3: comment out the test's last `b.append` line and the `|5`
      for now, and restore both in Task 3 Step 4)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh sbt_run "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest"'
```

Expected: PASS, `Tests: succeeded 1, failed 0`. If `Ext` is not found (the
result shows `error:Module_Does_Not_Exist` for the fourth entry), the package
does not register modules that nothing imports. Then import `project.Ext` in
Main and note it in the plan's follow-ups: the IDE always has the method's
module loaded, since the node ran it.

- [ ] **Step 7: Format and commit**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh sbt_run "javafmtCheckAll"'
git -C C:\Repos\Enso\ide-widgets-pr1a add engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/MethodLookup.java engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetMethodAnnotationNode.java engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/FindTypeOrModuleNode.java engine/runtime/src/main/java/org/enso/interpreter/node/expression/builtin/meta/GetModuleMethodNode.java engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Meta_Helpers.enso distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Meta.get_method_annotation: find a method by module, type and name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Base — `Meta.call_module_method` and `LogOnce`

**Files:**

- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso` (after
  `find_type_or_module`)
- Create `std-bits/base/src/main/java/org/enso/base/LogOnce.java` (~35 lines)
- Create `test/Base_Tests/src/Widget_Query_Spec.enso` (the `call_module_method`
  group; Task 4 adds the rest)
- Modify `test/Base_Tests/src/Main.enso` (import + `add_specs`, beside
  `Metadata_Spec`)

**Interfaces:**

- Produces
  `Meta.call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value -> Any`.
  It applies the module method to `value`, then to each argument in order. The
  library must be loaded; otherwise it gives a `Module_Does_Not_Exist` error.
- Produces `org.enso.base.LogOnce.firstTime(String key) -> boolean`: `true` the
  first time a key is seen in this engine session (bounded to the 10,000 most
  recent keys).

- [ ] **Step 1: Failing test**

`test/Base_Tests/src/Widget_Query_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Errors.Common.Module_Does_Not_Exist
import Standard.Base.Errors.Common.No_Such_Method
import Standard.Base.Random.Random

from Standard.Test import all

polyglot java import org.enso.base.LogOnce

## This module as the IDE names it.
spec_module = "enso_dev.Base_Tests.Widget_Query_Spec"

add_three a b c = a + b + c

add_specs suite_builder =
    suite_builder.group "Meta.call_module_method" group_builder->
        group_builder.specify "applies a module's method to the value, then to the arguments" <|
            Meta.call_module_method spec_module "add_three" [2, 3] 1 . should_equal 6

        group_builder.specify "fails for a module that is not loaded, or a method it lacks" <|
            Meta.call_module_method "enso_dev.Base_Tests.No_Such_Module" "f" [] 1 . should_fail_with Module_Does_Not_Exist
            Meta.call_module_method spec_module "no_such_method" [] 1 . should_fail_with No_Such_Method

    suite_builder.group "LogOnce" group_builder->
        group_builder.specify "is true only the first time it sees a key" <|
            key = "Widget_Query_Spec " + Random.uuid
            LogOnce.firstTime key . should_be_true
            LogOnce.firstTime key . should_be_false
            LogOnce.firstTime key+"x" . should_be_true

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

In `test/Base_Tests/src/Main.enso`, add `import project.Widget_Query_Spec` after
`import project.Metadata_Spec`, and `Widget_Query_Spec.add_specs suite_builder`
after `Metadata_Spec.add_specs suite_builder`.

- [ ] **Step 2: See it fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh enso_test Base_Tests "call_module_method"'
```

Expected: FAIL. The module does not compile: `call_module_method` and
`org.enso.base.LogOnce` are not found.

- [ ] **Step 3: Implement**

`std-bits/base/src/main/java/org/enso/base/LogOnce.java`:

```java
package org.enso.base;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Remembers which log entries this engine session has written, so that an entry repeated on every
 * evaluation (a widget failing on each keystroke) is written once. Bounded: the least recently seen
 * key is forgotten past {@link #CAPACITY}.
 */
public final class LogOnce {
  private static final int CAPACITY = 10_000;

  private static final Set<String> SEEN =
      Collections.newSetFromMap(
          Collections.synchronizedMap(
              new LinkedHashMap<String, Boolean>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                  return size() > CAPACITY;
                }
              }));

  private LogOnce() {}

  /** Whether {@code key} is seen for the first time (it is remembered from now on). */
  public static boolean firstTime(String key) {
    return SEEN.add(key);
  }
}
```

`Meta.enso`, after `find_type_or_module`:

```enso
## ---
   private: true
   ---
   Applies the method `method_name` of the module `module_name` to `value` and
   then to each of `arguments`, in order. The IDE evaluates expressions in a
   user's module that call a library's IDE entry point (a visualization's next
   page of rows, say). A fully qualified name of a library the module does not
   import does not compile, but `Standard.Base.Meta.call_module_method`
   always does. The library must be loaded.

   ## Arguments
    - `module_name`: The qualified name of the module.
    - `method_name`: The name of a method the module defines.
    - `arguments`: The arguments after `value`.
    - `value`: The first argument.
call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value -> Any =
    function = Meta_Helpers.get_module_method_builtin module_name method_name
    module = Meta_Helpers.find_type_or_module_builtin module_name
    arguments.fold (function module value) applied-> argument-> applied argument
```

- [ ] **Step 4: Pass**

Restore the `call_module_method` line and `|5` in `MethodLookupTest` (Task 2
Step 6).

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh enso_test Base_Tests "call_module_method" && ~/pr1a.sh enso_test Base_Tests "LogOnce" && ~/pr1a.sh sbt_run "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest"'
```

Expected: `2 tests succeeded.` then `1 tests succeeded.` (both with
`0 tests failed.`), and the Java test passes.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a add std-bits/base/src/main/java/org/enso/base/LogOnce.java distribution/lib/Standard/Base/0.0.0-dev/src/Meta.enso test/Base_Tests/src/Widget_Query_Spec.enso test/Base_Tests/src/Main.enso engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/MethodLookupTest.java
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Meta.call_module_method: call a library's entry point without importing it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Base — `Widget_Query.resolve_call`

**Files:**

- Create
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`
  (~230 lines)
- Modify `test/Base_Tests/src/Widget_Query_Spec.enso` (types under test + three
  groups)

**Interfaces:**

- Produces
  `Widget_Query.resolve_call (value : Any) (module_name : Text) (type_name : Text) (method_name : Text) (argument_names : Vector Text) (uuids : Text = "{}") (subject_is_type : Boolean = False) -> Text`.
  The answer is the JSON in Global Constraints.
- `self` for an annotation that is a function: `value` with its warnings
  cleared, or, with `subject_is_type`, `Meta.find_type_or_module type_name`. The
  latter is what today's `_ -> get_widget_json <memberOf>` passed.
- Produces
  `Widget_Query.resolve_argument (method : Widget_Method) (argument : Text) subject (cache : Function) -> Argument_Result`.
- Produces
  `Widget_Query.log_failure (failure : Widget_Failure) (inputs : Text) -> Boolean`:
  `True` when it logged.
- Produces the types:
  - `Widget_Method.Value module_name:Text type_name:Text method_name:Text`, with
    `qualified_name -> Text` (`<type>.<name>`);
  - `Widget_Failure.Value method:Widget_Method argument:Text step:Text message:Text causes:(Vector Text) stack:(Vector Text)`,
    with `to_json` (`{"step":…,"message":…}`) and `log_text`;
  - `Argument_Result.Resolved widget:(Widget | Nothing) json:Text | Argument_Result.Failed failure:Widget_Failure`,
    with `to_json` (`{"widget":…}` / `{"error":…}`).
- Consumes `Meta.get_method_annotation`, `Meta.find_type_or_module` (Task 2),
  `LogOnce` (Task 3), `Progress.run`, `Any.log_internal`.

- [ ] **Step 1: Failing tests**

Add to `test/Base_Tests/src/Widget_Query_Spec.enso` (imports at the top; types
and functions above `add_specs`; groups inside `add_specs`):

```enso
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument
import Standard.Base.Errors.Illegal_State.Illegal_State
import Standard.Base.Metadata.Choice
import Standard.Base.Metadata.Widget
import Standard.Base.Metadata.Widget_Query
from Standard.Base.Metadata.Widget_Query import Argument_Result, Widget_Failure, Widget_Method

sample_type = spec_module + ".Sample"

type Sample
    @label (Widget.Text_Input)
    Value label

    @arg (Widget.Boolean_Input)
    probe self (arg = 0) = arg

    @arg (Widget.Numeric_Input)
    make (arg = 0) = Sample.Value arg

    @arg _choice_of_label
    of_self self (arg = 0) = arg

    @arg _choice_of_cache
    of_cache self (arg = 0) (other = 0) = arg + other

    @arg (Error.throw (Illegal_Argument.Error "no choices" (Illegal_State.Error "the cause")))
    fails_with_error self (arg = 0) = arg

    @arg _panics
    fails_with_panic self (arg = 0) = arg

    @arg ("not a widget")
    not_a_widget self (arg = 0) = arg

    plain self (arg = 0) = arg

    @first (Widget.Boolean_Input)
    @second (Error.throw (Illegal_Argument.Error "second fails"))
    two self (first = 0) (second = 0) = first + second

## Defined on `Any`: a `Sample` value has its own `probe`.
@arg (Widget.Folder_Browse)
Any.probe self (arg = 0) = arg

## An extension method of a type defined elsewhere.
@range (Widget.Secret_Browse)
Text.widget_probe self (range = 0) = range

@arg (Widget.Text_Input)
module_probe (arg = 0) = arg

private _choice_of_label subject -> Widget =
    Widget.Single_Choice [Choice.Option subject.label]

private _choice_of_cache subject cache=Nothing -> Widget =
    Widget.Single_Choice [Choice.Option (cache "other" . to_text)]

private _panics subject = Panic.throw (Illegal_State.Error "boom for "+subject.label)

## The answer for one argument whose widget is `widget`.
answer argument widget = '{"arguments":[[' + argument.to_json + ',{"widget":' + widget.to_json + '}]]}'

## The error part of the answer for the one argument asked for.
error_of answer_json = answer_json.parse_json . get "arguments" . first . second . get "error"
```

Groups (inside `add_specs`):

```enso
    suite_builder.group "Widget_Query.resolve_call finds exactly the method a call names" group_builder->
        sample = Sample.Value "a label"

        group_builder.specify "an instance method" <|
            Widget_Query.resolve_call sample spec_module sample_type "probe" ["arg"] . should_equal (answer "arg" Widget.Boolean_Input)

        group_builder.specify "a method of Any, although the value's own type defines one of that name" <|
            Meta.get_annotation sample .probe "arg" . should_equal Widget.Boolean_Input
            Widget_Query.resolve_call sample spec_module "Standard.Base.Any.Any" "probe" ["arg"] . should_equal (answer "arg" Widget.Folder_Browse)

        group_builder.specify "a static method, called on the type" <|
            Widget_Query.resolve_call Sample spec_module sample_type "make" ["arg"] . should_equal (answer "arg" Widget.Numeric_Input)

        group_builder.specify "a constructor, with the type as the subject (an autoscoped call)" <|
            Widget_Query.resolve_call Nothing spec_module sample_type "Value" ["label"] subject_is_type=True . should_equal (answer "label" Widget.Text_Input)

        group_builder.specify "an extension method defined in another module than its type" <|
            Widget_Query.resolve_call "abc" spec_module "Standard.Base.Data.Text.Text" "widget_probe" ["range"] . should_equal (answer "range" Widget.Secret_Browse)

        group_builder.specify "a module method" <|
            Widget_Query.resolve_call Nothing spec_module spec_module "module_probe" ["arg"] subject_is_type=True . should_equal (answer "arg" Widget.Text_Input)

    suite_builder.group "Widget_Query.resolve_call evaluates annotations as before" group_builder->
        sample = Sample.Value "a label"

        group_builder.specify "a function of self" <|
            Widget_Query.resolve_call sample spec_module sample_type "of_self" ["arg"] . should_equal (answer "arg" (Widget.Single_Choice [Choice.Option "a label"]))

        group_builder.specify "a function of self taking cache, which reads the uuids" <|
            Widget_Query.resolve_call sample spec_module sample_type "of_cache" ["arg"] "{}" . should_equal (answer "arg" (Widget.Single_Choice [Choice.Option "Nothing"]))

        group_builder.specify "no annotation gives a null widget" <|
            Widget_Query.resolve_call sample spec_module sample_type "plain" ["arg"] . should_equal '{"arguments":[["arg",{"widget":null}]]}'

        group_builder.specify "each argument independently, in the order asked" <|
            json = Widget_Query.resolve_call sample spec_module sample_type "two" ["second", "first"]
            arguments = json.parse_json . get "arguments"
            arguments.map .first . should_equal ["second", "first"]
            arguments.first.second.get "error" . get "message" . should_contain "second fails"
            arguments.second.second.get "widget" . get "constructor" . should_equal "Boolean_Input"

    suite_builder.group "Widget_Query.resolve_call gives errors as results" group_builder->
        sample = Sample.Value "a label"

        group_builder.specify "an annotation that is an error" <|
            error = error_of (Widget_Query.resolve_call sample spec_module sample_type "fails_with_error" ["arg"])
            error.get "step" . should_equal "annotation"
            error.get "message" . should_contain "no choices"

        group_builder.specify "an annotation that panics" <|
            error = error_of (Widget_Query.resolve_call sample spec_module sample_type "fails_with_panic" ["arg"])
            error.get "step" . should_equal "annotation"
            error.get "message" . should_contain "boom for a label"

        group_builder.specify "an annotation that is not a Widget" <|
            error = error_of (Widget_Query.resolve_call sample spec_module sample_type "not_a_widget" ["arg"])
            error.get "message" . should_contain "not a Widget"

        group_builder.specify "a method that does not exist" <|
            error = error_of (Widget_Query.resolve_call sample spec_module sample_type "missing" ["arg"])
            error.get "step" . should_equal "lookup"
```

- [ ] **Step 2: See them fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh enso_test Base_Tests "Widget_Query.resolve_call"'
```

Expected: FAIL. `Standard.Base.Metadata.Widget_Query` does not exist (compile
error).

- [ ] **Step 3: Implement `Metadata/Widget_Query.enso`**

```enso
import project.Any.Any
import project.Data.Numbers.Integer
import project.Data.Text.Text
import project.Data.Vector.Vector
import project.Error.Error
import project.Errors.Common.Module_Does_Not_Exist
import project.Errors.Common.No_Such_Method
import project.Function.Function
import project.Meta
import project.Metadata.Widget
import project.Nothing.Nothing
import project.Panic.Caught_Panic
import project.Panic.Panic
import project.Runtime
import project.Warning.Warning
from project.Data.Boolean import Boolean, False, True
from project.Data.Json.Extensions import all
from project.Data.Text.Extensions import all
from project.Logging import all

polyglot java import java.lang.Throwable
polyglot java import org.enso.base.LogOnce

## ---
   private: true
   ---
   The IDE's widget query for a call: for each of `argument_names`, the widget
   the method's annotation gives, or why there is none. The IDE calls it as a
   method-pointer visualization on the call's subject, so nothing is compiled
   in the user's module.

   The method is the one the call names (the IDE's method pointer), found
   exactly: a static method, an extension method or a method of `Any` gets its
   own annotations.

   Each failure is also logged once (`log_failure`), and the query is timed
   under `Standard.Base.Logging.Progress` (the IDE's performance timings).

   ## Arguments
    - `value`: The call's subject (the visualized expression's value).
    - `module_name`: The module that defines the method.
    - `type_name`: The type the method is defined on (the module, for a module
      method).
    - `method_name`: The method's or constructor's name.
    - `argument_names`: The arguments to resolve.
    - `uuids`: JSON mapping argument names to expression ids, read by
      annotations that take `cache`.
    - `subject_is_type`: Whether the subject an annotation sees is the type
      named by `type_name` rather than `value` (a call with no subject
      expression, such as an autoscoped constructor).

   ## Returns
   `{"arguments":[[<name>,{"widget":<widget or null>}|{"error":{"step":…,"message":…}}],…]}`,
   read by `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
   (`widgetQueryAnswerSchema`).
resolve_call (value : Any) (module_name : Text) (type_name : Text) (method_name : Text) (argument_names : Vector Text) (uuids : Text = "{}") (subject_is_type : Boolean = False) -> Text =
    method = Widget_Method.Value module_name type_name method_name
    Progress.run label=method.qualified_name up_to=1 handle_name="Widget_Query."+method.qualified_name action=_->
        subject = if subject_is_type then Meta.find_type_or_module type_name else Warning.clear value
        cache = _cache_from uuids
        inputs = _inputs_key subject uuids
        entries = argument_names.map argument->
            result = resolve_argument method argument subject cache
            _ = case result of
                Argument_Result.Failed failure -> log_failure failure inputs
                _ -> False
            '[' + argument.to_json + ',' + result.to_json + ']'
        '{"arguments":[' + (entries.join ",") + ']}'

## ---
   private: true
   ---
   The widget of one argument, or why there is none. An annotation is a
   `Widget`, or a function of the subject, which may also take `cache`.

   ## Arguments
    - `method`: The method.
    - `argument`: The argument's name.
    - `subject`: What a function annotation is applied to.
    - `cache`: Looks an argument's value up by name or index (`uuids`).
resolve_argument (method : Widget_Method) (argument : Text) subject (cache : Function) -> Argument_Result =
    Panic.catch Any handler=(caught-> Argument_Result.Failed (_failure_from_panic method argument caught)) <|
        annotation = Meta.get_method_annotation method.module_name method.type_name method.method_name argument
        if annotation.is_error && (_is_lookup_error annotation.catch) then Argument_Result.Failed (_failure_from_error method argument "lookup" annotation) else
            widget = case annotation of
                f : Function ->
                    with_cache = Meta.meta f . arguments pending=True defaulted=True . contains "cache"
                    applied = if with_cache then f cache=cache else f
                    applied subject
                _ -> annotation
            _as_result method argument widget

## ---
   private: true
   ---
   Logs `failure` at Warning, once per method, argument, inputs, step and
   message in this engine session: a widget that fails on every keystroke is
   logged once.

   ## Arguments
    - `failure`: The failure.
    - `inputs`: What the result depends on: the subject's type and the uuids.

   ## Returns
   Whether it logged.
log_failure (failure : Widget_Failure) (inputs : Text) -> Boolean =
    key = failure.method.module_name + "|" + failure.method.qualified_name + "|" + failure.argument + "|" + inputs + "|" + failure.step + "|" + failure.message
    first = LogOnce.firstTime key
    if first then Widget_Query.log_internal failure.log_text ..Warning
    first

## ---
   private: true
   ---
   The method a widget query is for, as the IDE's method pointer names it.

   ## Arguments
    - `module_name`: The module that defines the method.
    - `type_name`: The type it is defined on, or the module.
    - `method_name`: Its name.
type Widget_Method
    ## ---
       private: true
       ---
    Value module_name:Text type_name:Text method_name:Text

    ## ---
       private: true
       ---
       `<type>.<name>`.
    qualified_name self -> Text = self.type_name + "." + self.method_name

## ---
   private: true
   ---
   Why the widget of one argument could not be resolved.

   ## Arguments
    - `method`: The method.
    - `argument`: The argument's name.
    - `step`: `"lookup"` (no such method or module) or `"annotation"`
      (evaluating the annotation failed, or did not give a `Widget`).
    - `message`: What went wrong.
    - `causes`: The error's causes, outermost first.
    - `stack`: For a panic, its Enso stack trace.
type Widget_Failure
    ## ---
       private: true
       ---
    Value method:Widget_Method argument:Text step:Text message:Text causes:(Vector Text) stack:(Vector Text)

    ## ---
       private: true
       ---
       The failure as the IDE reads it.
    to_json self -> Text =
        '{"step":' + self.step.to_json + ',"message":' + self.message.to_json + '}'

    ## ---
       private: true
       ---
       The failure as one log entry.
    log_text self -> Text =
        head = "The widget of `" + self.argument + "` of " + self.method.qualified_name + " (defined in " + self.method.module_name + ") failed at the " + self.step + ": " + self.message
        causes = self.causes.map cause-> '\n    caused by: ' + cause
        stack = self.stack.map element-> '\n    at ' + element
        head + (causes.join "") + (stack.join "")

## ---
   private: true
   ---
   The result for one argument.
type Argument_Result
    ## ---
       private: true
       ---
       The argument's widget (`Nothing`: none) and its JSON.
    Resolved widget:(Widget | Nothing) json:Text

    ## ---
       private: true
       ---
       The widget could not be resolved.
    Failed failure:Widget_Failure

    ## ---
       private: true
       ---
       `{"widget":…}` or `{"error":…}`.
    to_json self -> Text = case self of
        Argument_Result.Resolved _ json -> '{"widget":' + json + '}'
        Argument_Result.Failed failure -> '{"error":' + failure.to_json + '}'

private _as_result (method : Widget_Method) (argument : Text) widget -> Argument_Result =
    if widget.is_error then Argument_Result.Failed (_failure_from_error method argument "annotation" widget) else
        case widget of
            Nothing -> Argument_Result.Resolved Nothing "null"
            _ : Widget ->
                json = widget.to_json
                if json.is_error then Argument_Result.Failed (_failure_from_error method argument "annotation" json) else
                    Argument_Result.Resolved widget json
            _ ->
                message = "The annotation gave " + (Meta.type_of widget . to_text) + ", not a Widget."
                Argument_Result.Failed (Widget_Failure.Value method argument "annotation" message [] [])

private _is_lookup_error payload -> Boolean = case payload of
    _ : No_Such_Method -> True
    _ : Module_Does_Not_Exist -> True
    _ -> False

private _failure_from_error (method : Widget_Method) (argument : Text) (step : Text) error -> Widget_Failure =
    payload = error.catch
    Widget_Failure.Value method argument step (_describe payload) (_cause_chain payload) []

private _failure_from_panic (method : Widget_Method) (argument : Text) (caught : Caught_Panic) -> Widget_Failure =
    payload = caught.payload
    stack = caught.stack_trace . take 20 . map .to_display_text
    Widget_Failure.Value method argument "annotation" (_describe payload) (_cause_chain payload) stack

private _describe value -> Text = case value of
    t : Throwable -> t.getClass.getName + ": " + (t.getMessage . if_nothing "")
    _ -> value.to_display_text

## The causes of an error, outermost first: a Java exception's `getCause`, or
   an Enso error's `cause` (or `inner_error`) field. At most ten.
private _cause_chain value (depth : Integer = 0) -> Vector Text =
    if depth >= 10 then [] else
        next = _cause_of value
        if next.is_nothing then [] else [_describe next] + (_cause_chain next depth+1)

private _cause_of value = case value of
    t : Throwable -> t.getCause
    _ -> case Meta.meta value of
        atom : Meta.Atom ->
            names = atom.constructor.fields . catch Any (_-> [])
            index = names.index_of name-> (name == "cause") || (name == "inner_error")
            if index.is_nothing then Nothing else atom.fields.at index
        _ -> Nothing

private _cache_from (uuids : Text) -> Function =
    other_args = uuids.parse_json
    cache (name_or_index : Text | Integer) =
        case other_args.get name_or_index.to_text of
            uuid : Text -> Runtime.value_for_uuid uuid
            _ -> Nothing
    cache

private _inputs_key subject (uuids : Text) -> Text =
    subject_type = (Meta.type_of subject . to_text) . catch Any (_-> "<error>")
    subject_type + "|" + uuids
```

- [ ] **Step 4: Pass**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh enso_test Base_Tests "Widget_Query.resolve_call"'
```

Expected: `14 tests succeeded.` and `0 tests failed.` If "a function of self
taking cache" fails because `Runtime.value_for_uuid` panics outside the IDE,
that is today's behaviour. Then call it through the uuid lookup only when
`other_args` has the key (the code above already does), and check the failure
message.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a add distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso test/Base_Tests/src/Widget_Query_Spec.enso
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Widget_Query.resolve_call: widgets of a call by exact method, errors as results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Base — the failure log entry, its dedup and the timing

**Files:**

- Modify `test/Base_Tests/src/Widget_Query_Spec.enso` (one group)
- No library change unless a test finds a defect in Task 4's `log_text`,
  `_cause_chain` or `log_failure`.

**Interfaces:** Consumes `Widget_Query.resolve_argument`,
`Widget_Query.log_failure`, `Widget_Failure.log_text` (Task 4).

- [ ] **Step 1: Tests**

```enso
    suite_builder.group "Widget_Query failures are logged once, with their causes and stack" group_builder->
        sample = Sample.Value "a label"
        method name = Widget_Method.Value spec_module sample_type name
        no_cache = _-> Nothing

        group_builder.specify "an error's entry has the method, the argument, the step, the message and the cause" <|
            result = Widget_Query.resolve_argument (method "fails_with_error") "arg" sample no_cache
            result.should_be_a Argument_Result.Failed
            text = result.failure.log_text
            text.should_contain "`arg` of enso_dev.Base_Tests.Widget_Query_Spec.Sample.fails_with_error"
            text.should_contain "failed at the annotation: "
            text.should_contain "no choices"
            text.should_contain "caused by: "
            text.should_contain "the cause"

        group_builder.specify "a panic's entry has its stack" <|
            result = Widget_Query.resolve_argument (method "fails_with_panic") "arg" sample no_cache
            result.failure.stack.is_empty . should_be_false
            result.failure.log_text . should_contain "\n    at "

        group_builder.specify "is logged once per method, argument, inputs, step and message" <|
            failure = (Widget_Query.resolve_argument (method "fails_with_error") "arg" sample no_cache).failure
            inputs = "test inputs " + Random.uuid
            Widget_Query.log_failure failure inputs . should_be_true
            Widget_Query.log_failure failure inputs . should_be_false
            Widget_Query.log_failure failure inputs+"2" . should_be_true
```

- [ ] **Step 2: Run** (they should pass on Task 4's code; any failure is a
      defect in Task 4's helpers, fixed there)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && ~/pr1a.sh enso_test Base_Tests "logged once"'
```

Expected: `3 tests succeeded.` and `0 tests failed.`

- [ ] **Step 3: Check the log and the timing by hand**, on a scratch project.
      `--vm.D` is the runner option the shim passes for #342.

```bash
wsl -d Ubuntu-24.04 -e bash -lc '. ~/.enso-toolchain.sh && rm -rf /tmp/wq && mkdir -p /tmp/wq/Wq/src && printf "name: Wq\nversion: 0.0.1\nprefer-local-libraries: true\n" > /tmp/wq/Wq/package.yaml && printf "from Standard.Base import all\nimport Standard.Base.Metadata.Widget_Query\n\nmain =\n    IO.println (Widget_Query.resolve_call Nothing \"Standard.Base.Data\" \"Standard.Base.Data\" \"read\" [\"format\"])\n    IO.println (Widget_Query.resolve_call Nothing \"Standard.Base.Data\" \"Standard.Base.Data\" \"nope\" [\"format\"])\n    IO.println (Widget_Query.resolve_call Nothing \"Standard.Base.Data\" \"Standard.Base.Data\" \"nope\" [\"format\"])\n" > /tmp/wq/Wq/src/Main.enso && cd /tmp/wq && ~/enso-widgets-pr1a/built-distribution/enso-engine-*/enso-*/bin/enso --vm.D Standard.Base.Logging.Progress.Logger.level=debug --log-level debug --run "$PWD/Wq" 2>&1 | grep -E "ADVANCE Widget_Query|Widget_Query\]|arguments" | head'
```

Expected:

- two `ADVANCE Widget_Query.Standard.Base.Data.read+1~…ms`-style lines (`read`
  and `nope`, the third deduplicated in the log but timed);
- exactly one
  `[WARN] … [Standard.Base.Metadata.Widget_Query] The widget of \`format\` of
  Standard.Base.Data.nope … failed at the lookup`;
- three `{"arguments":…}` lines.

Note the outcome in the PR description. If the timing line has no `~ms` suffix,
`ProgressHandle` changed. Read `std-bits/base/.../ProgressHandle.java`.

- [ ] **Step 4: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a add test/Base_Tests/src/Widget_Query_Spec.enso
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Widget_Query: test the failure entry, its causes, stack and dedup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Move the widget tests to their libraries; pin `get_widget_json`'s shape

**Files:**

- Create `test/Base_Tests/src/Base_Widgets_Spec.enso`; modify
  `test/Base_Tests/src/Main.enso`
- Create `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`; modify
  `test/Table_Tests/src/In_Memory/Main.enso` (import after `Table_Spec`,
  `add_specs` after line 45)
- Modify `test/Table_Tests/src/Internal/Widget_Helpers_Spec.enso` (drop the
  import; `(Widgets.get_widget_json w) . to_text` → `w.to_text`, ×8)
- Create `test/SQLite_Tests/src/Widgets_Spec.enso`; modify
  `test/SQLite_Tests/src/Main.enso`
- Create `test/Geo_Tests/src/Geo_Widgets_Spec.enso`; modify
  `test/Geo_Tests/src/Main.enso`
- Create `test/Format_Discovery_Tests/src/Data_Read_Widgets_Spec.enso`; modify
  `test/Format_Discovery_Tests/src/Main.enso`
- Modify `test/Postgres_Tests/src/Library_Discovery_Spec.enso:37`
- Delete `test/Visualization_Tests/src/Widgets/` (5 files); rewrite
  `test/Visualization_Tests/src/Widgets_Spec.enso` to one test of the old shape
  (`Visualization_Tests/src/Main.enso` keeps importing it)
- **Not changed:**
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Widgets.enso` (the GUI
  still calls it; PR 1b deletes it and moves `column_names_json`)
- Modify `tools/ci/stdlib-test-map.yaml`
- Regenerate `distribution/lib/Standard/Base/0.0.0-dev/docs/api/`

**Interfaces:**

- Consumes `Widget_Query.resolve_call` (Task 4).
- Keeps
  `Standard.Visualization.Widgets.get_widget_json value call_name argument_names uuids="{}" -> Text`
  exactly as on `develop`. Its answer is `[[<name>,<widget JSON or null>],…]`,
  and one test pins that (Decision 6).
- Each moved test now calls
  `Widget_Query.resolve_call <subject> <module> <type> <name> [<args>]` and
  compares against
  `'{"arguments":[[<name>,{"widget":' + <widget>.to_json + '}]]}'`.

- [ ] **Step 1: Write the moved specs** (each is the old spec with
      `Widgets.get_widget_json x .name [args]` replaced, and its expectation
      wrapped). Shared helper, repeated in each file:

```enso
## The answer for one argument whose widget is `widget`.
answer argument widget = '{"arguments":[[' + argument.to_json + ',{"widget":' + widget.to_json + '}]]}'
```

`test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Metadata.Choice
import Standard.Base.Metadata.Display
import Standard.Base.Metadata.Widget
import Standard.Base.Metadata.Widget_Query

from Standard.Table import Table

from Standard.Test import all

table_module = "Standard.Table.Table"
table_type = "Standard.Table.Table.Table"

answer argument widget = '{"arguments":[[' + argument.to_json + ',{"widget":' + widget.to_json + '}]]}'

add_specs suite_builder =
    suite_builder.group "Widgets for In-Memory with column name sets" group_builder->
        mock_table = Table.from_rows ["A", "B C", 'D "E"', "F.G/H\I"] []

        group_builder.specify "works for `get` and `at`" <|
            choices = mock_table.column_names . map n-> Choice.Option n n.pretty
            expect = answer "selector" (Widget.Single_Choice choices Nothing Display.Always)
            Widget_Query.resolve_call mock_table table_module table_type "get" ["selector"] . should_equal expect
            Widget_Query.resolve_call mock_table table_module table_type "at" ["selector"] . should_equal expect

        group_builder.specify "works for `filter`" <|
            choices = [Choice.Option "<Expression>" "(expr '[A]')"] + mock_table.column_names . map n-> Choice.Option n n.pretty
            expect = answer "column" (Widget.Single_Choice choices Nothing Display.Always)
            Widget_Query.resolve_call mock_table table_module table_type "filter" ["column"] . should_equal expect
```

Then append the old "works for `join` with `right` table" specify block
unchanged; it calls
`Standard.Table.Internal.Widget_Helpers.make_join_condition_selector` directly.
Add `main filter=Nothing` as in the other specs.

`test/SQLite_Tests/src/Widgets_Spec.enso`: the old `Database_Widgets_Spec` body,
with these replacements (subjects and modules):

| Old                                                     | New                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Widgets.get_widget_json connection .tables ["types"]`  | `Widget_Query.resolve_call connection "Standard.SQLite.SQLite_Connection" "Standard.SQLite.SQLite_Connection.SQLite_Connection" "tables" ["types"]`                      |
| `… connection .query ["query"]` / `.read`               | same module and type, `"query"` / `"read"`                                                                                                                               |
| `… mock_table .get ["selector"]` / `.at` / `.filter`    | `Widget_Query.resolve_call mock_table "Standard.Database.DB_Table" "Standard.Database.DB_Table.DB_Table" "get" ["selector"]` (likewise `at`, `filter` with `["column"]`) |
| `Widgets.get_widget_json Database .connect ["details"]` | `Widget_Query.resolve_call Nothing "Standard.Database.Connection.Database" "Standard.Database.Connection.Database" "connect" ["details"] subject_is_type=True`           |
| `expect = '[["query",' + W . to_json + ']]'`            | `expect = answer "query" W`                                                                                                                                              |

Imports: `import Standard.Base.Metadata.Widget_Query` in place of
`import Standard.Visualization.Widgets`. The `should_contain` checks stay as
they are.

`test/Geo_Tests/src/Geo_Widgets_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Metadata.Choice
import Standard.Base.Metadata.Display
import Standard.Base.Metadata.Widget
import Standard.Base.Metadata.Widget_Query

from Standard.Table import Table
from Standard.Geo import all

from Standard.Test import all

answer argument widget = '{"arguments":[[' + argument.to_json + ',{"widget":' + widget.to_json + '}]]}'

add_specs suite_builder =
    suite_builder.group "Geo widgets" group_builder->
        group_builder.specify "geo_distance, an extension method of Table defined in Standard.Geo" <|
            mock_table = Table.from_rows ["A", "B C", 'D "E"', "F.G/H\I"] []
            choices = [Choice.Option "<Number Value>" "0", Choice.Option "<Expression>" "(expr '[A]')"]
            expect = answer "lat1" (Widget.Single_Choice choices Nothing Display.Always)
            Widget_Query.resolve_call mock_table "Standard.Geo.Table_Extensions" "Standard.Table.Table.Table" "geo_distance" ["lat1"] . should_equal expect

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

`test/Format_Discovery_Tests/src/Data_Read_Widgets_Spec.enso`: the old
`File_Format_Widgets_Spec` with its `Standard.Table`, `Excel`, `Database` and
`Image` imports **removed**. This suite imports only Base, Table and Test, and
finds the formats by discovery, which is the point. Each
`Widgets.get_widget_json Data .read ["format"]` becomes
`Widget_Query.resolve_call Nothing "Standard.Base.Data" "Standard.Base.Data" "read" ["format"]`
(and the same for `fetch` and `list` with `["name_filter"]`). The
`should_contain` checks stay unchanged.

`test/Base_Tests/src/Base_Widgets_Spec.enso`: the old `Text_Widgets_Spec` and
`Widget_Helpers_Spec` (Base's):

```enso
from Standard.Base import all
import Standard.Base.Metadata.Widget_Query
from Standard.Base.Widget_Helpers import all

from Standard.Test import all

add_specs suite_builder =
    suite_builder.group "Widgets for the Text type" group_builder->
        group_builder.specify "works for `take` and `drop`" <|
            expect = '{"arguments":[["range",{"widget":' + Text_Sub_Range.default_widget.to_json + '}]]}'
            text_module = "Standard.Base.Data.Text.Extensions"
            text_type = "Standard.Base.Data.Text.Text"
            json = Widget_Query.resolve_call "abc def" text_module text_type "take" ["range"]
            json . should_equal expect
            Widget_Query.resolve_call "abc def" text_module text_type "drop" ["range"] . should_equal expect
            labels = json.parse_json . get "arguments" . first . second . get "widget" . get "values" . map o-> o.get "label"
            labels.should_contain "First"
            labels.should_contain "While"
            labels.should_contain "After"
            labels.should_contain "Before_Last"

    suite_builder.group "Widget_Helpers run" group_builder->
        group_builder.specify "make_regex_text_widget" <|
            make_regex_text_widget . to_text . should_contain "Option '<Leading_Whitespace>' 'Named_Pattern.Leading_Whitespace' [] ''"
        group_builder.specify "make_data_cleanse_vector_selector" <|
            make_data_cleanse_vector_selector . to_text . should_contain "Option 'Leading_Whitespace' '..Leading_Whitespace' [] ''"

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

`Library_Discovery_Spec.enso:37`:

```enso
            main_src = 'from Standard.Base import all\nimport Standard.Base.Metadata.Widget_Query\n\nmain =\n    IO.println (Widget_Query.resolve_call Nothing "Standard.Database.Connection.Database" "Standard.Database.Connection.Database" "connect" ["details"] subject_is_type=True)\n'
```

This test project does not import `Standard.Database`, so the module must be
loaded by discovery. If `Module_Does_Not_Exist` comes back, keep
`from Standard.Database import all\n` in `main_src` as it was.

- [ ] **Step 2: Register the specs** in each `Main.enso` (import line +
      `X.add_specs suite_builder`), then delete the moved files:

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a rm -r test/Visualization_Tests/src/Widgets
```

- [ ] **Step 3: Pin the old shape that the GUI still reads.** Rewrite
      `test/Visualization_Tests/src/Widgets_Spec.enso` as one test (its
      `add_specs` stays registered in `Visualization_Tests/src/Main.enso`). PR
      1b deletes this file with `Widgets.enso`.

```enso
from Standard.Base import all
import Standard.Base.Metadata.Widget

import Standard.Visualization.Widgets

from Standard.Test import all

## `get_widget_json` is what the GUI calls until PR 1b: an array of
   `[argument, widget or null]` pairs. PR 1b deletes it, with this test.
add_specs suite_builder =
    suite_builder.group "Widgets.get_widget_json (until PR 1b)" group_builder->
        group_builder.specify "keeps its array-of-pairs answer" <|
            json = Widgets.get_widget_json Data .read ["format", "on_problems"]
            json.should_start_with '[["format",{"constructor":"Single_Choice","values":['
            parsed = json.parse_json
            parsed.map .first . should_equal ["format", "on_problems"]
            parsed.second.second . should_equal Nothing

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

(`on_problems` has no annotation, so it pins the `null` too. The prefix is
`Widget.to_json`'s for `Single_Choice` (`Metadata.enso:172`); if a run on
`develop` prints another one, copy its first 50 characters and keep the `null`
check.)

- [ ] **Step 4: Test map.** In `tools/ci/stdlib-test-map.yaml`:
  - `Visualization_Tests.imports`: drop `Excel` and `Geo` (only the deleted
    specs imported them; `Database`, `SQLite` and `Table` stay as other specs
    import them, which the check confirms).
  - `Format_Discovery_Tests.loads`: `[EDI, Excel, Image, SQLite, YXDB]` (the
    format list names Image's and SQLite's formats).
  - `SQLite_Tests`: add `loads: [AWS, DuckDB, Microsoft, Postgres, Snowflake]`
    (the `connect` dropdown lists them by discovery).

  Then run the check, whose message says anything still out of step:

```bash
node tools/ci/check-workflows.mjs
```

Expected: no `stdlib-test-map` error.

- [ ] **Step 5: Run every touched suite** (expected counts are the old ones plus
      the moved ones; read the `tests succeeded.` line of each)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && for s in Base_Tests Table_Tests SQLite_Tests Geo_Tests Format_Discovery_Tests Visualization_Tests; do echo "== $s"; ~/pr1a.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done; ~/pr1a.sh enso_test Postgres_Tests "Library discovery" 2>&1 | grep -E "tests (succeeded|failed)"'
```

Expected: `0 tests failed.` for each. `Visualization_Tests` has 16 fewer tests
than on develop (its five widget specs, 4 + 5 + 5 + 1 + 2 = 17, replaced by the
one old-shape test), and the receiving suites have the 17 between them. Compare
with develop's counts from the baseline clone `~/enso` before judging.

- [ ] **Step 6: Regenerate the API signatures**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && cd ~/enso-widgets-pr1a && corepack pnpm --filter build-scripts run stdlib-api-check; rsync -a --delete built-distribution/enso-engine-*/enso-*/lib/Standard/Base/0.0.0-dev/docs/api/ /mnt/c/Repos/Enso/ide-widgets-pr1a/distribution/lib/Standard/Base/0.0.0-dev/docs/api/; ~/pr1a.sh sync && corepack pnpm --filter build-scripts run stdlib-api-check'
```

Expected: the first check fails on Base (new `Metadata/Widget_Query.md`, changed
`Meta.md`). The second passes. `git status` shows only Base's `docs/api`
changing; nothing under `distribution/lib/Standard/Visualization`.

- [ ] **Step 7: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a add -A test tools/ci/stdlib-test-map.yaml distribution/lib/Standard/Base/0.0.0-dev/docs
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Widget tests move to their libraries and call Widget_Query.resolve_call

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The widget query benchmark

**Files:**

- Create `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso` (~90 lines)
- Create `test/Benchmarks/src/Widgets/Widget_Query_Report.enso` (~40 lines)
- Modify `test/Benchmarks/src/Main.enso` (import after
  `project.Table.Unary_Column_Operations`;
  `builder.append Widget_Query_Bench.collect_benches` after
  `Unary_Column_Operations.collect_benches`)

**Interfaces:** Consumes `Widget_Query.resolve_call`. Produces
`Widget_Query_Bench.collect_benches`, `Widget_Query_Bench.Data.create`,
`Widget_Query_Bench.backends` and `Widget_Query_Bench.queries`, which the report
reuses.

- [ ] **Step 1: The benchmark** (the scratch baseline bench rewritten as
      `collect_benches`)

```enso
from Standard.Base import all
import Standard.Base.Metadata.Widget_Query

from Standard.Table import Table
from Standard.Database import all
from Standard.SQLite import all
from Standard.DuckDB import all

from Standard.Test import Bench

options = Bench.options . set_warmup (Bench.phase_conf 1 2) . set_measure (Bench.phase_conf 1 3)

column_count = 500
row_count = 1000

## A table of `width` columns of five kinds (integer, float, text, date,
   boolean) and `row_count` rows. SQLite stores dates as text.
make_table width (date_as_text : Boolean = False) =
    columns = 0.up_to width . map i->
        values = case i % 5 of
            0 -> 0.up_to row_count . map j-> j+i
            1 -> 0.up_to row_count . map j-> (j*0.5)+i
            2 -> 0.up_to row_count . map j-> "t"+(j%50).to_text
            3 -> 0.up_to row_count . map j->
                date = (Date.new 2020 1 1) + (Period.new days=(j%365))
                if date_as_text then date.to_text else date
            _ -> 0.up_to row_count . map j-> (j%2)==0
        ["c"+i.to_text, values]
    Table.new columns

## The baseline's widget queries: method and arguments.
queries = [["select_columns", ["columns"]], ["filter", ["column", "filter"]], ["set", ["value"]], ["aggregate", ["group_by", "columns"]], ["join", ["on", "join_kind"]]]

## The tables, built when first used. `duckdb` is `Nothing` where DuckDB
   cannot start (the benchmark job also runs off Linux).
type Data
    Value ~memory ~sqlite ~duckdb

    create =
        upload table connection = if connection.is_nothing then Nothing else
            table.select_into_database_table connection ("t"+column_count.to_text) temporary=True
        duck = Panic.catch Any (Database.connect (DuckDB.In_Memory)) (_-> Nothing)
        Data.Value (make_table column_count) (upload (make_table column_count True) (Database.connect (SQLite.In_Memory))) (upload (make_table column_count) duck)

## A backend: its name, its table in `Data`, and the method pointer's module
   and type for it.
type Backend
    Value name:Text table:(Data -> Any) module_name:Text type_name:Text

backends =
    db_module = "Standard.Database.DB_Table"
    db_type = "Standard.Database.DB_Table.DB_Table"
    [Backend.Value "In_Memory" (d-> d.memory) "Standard.Table.Table" "Standard.Table.Table.Table", Backend.Value "SQLite" (d-> d.sqlite) db_module db_type, Backend.Value "DuckDB" (d-> d.duckdb) db_module db_type]

## One widget query, as the IDE makes it; `Nothing` when the backend is absent.
run_query (backend : Backend) data query =
    table = backend.table data
    if table.is_nothing then Nothing else
        Widget_Query.resolve_call table backend.module_name backend.type_name query.first query.second

collect_benches = Bench.build builder->
    data = Data.create
    backends.each backend->
        builder.group ("Widget_Query_" + backend.name + "_" + column_count.to_text) options group_builder->
            queries.each query->
                group_builder.specify query.first <|
                    run_query backend data query

main = collect_benches . run_main
```

`Widget_Query_Report.enso`, the baseline's table for before/after comparison:

```enso
from Standard.Base import all
import project.Widgets.Widget_Query_Bench

time_ms ~action = (Duration.time_execution action).first.nanoseconds / 1000000.0

median values =
    sorted = values.sort
    sorted.at (sorted.length.div 2)

main =
    data = Widget_Query_Bench.Data.create
    IO.println "backend\tmethod\tcold_ms\twarm_ms\tkb\tflag"
    Widget_Query_Bench.backends.each backend->
        Widget_Query_Bench.queries.each query->
            call = Widget_Query_Bench.run_query backend data query
            cold = time_ms call
            warm = median (0.up_to 10 . map _-> time_ms (Widget_Query_Bench.run_query backend data query))
            out = Widget_Query_Bench.run_query backend data query
            kb = if out.is_nothing then 0 else (out.length / 1024.0).round 1
            flag = if out.is_nothing then "ABSENT" else if out.contains '"error"' then "ERROR" else ""
            IO.println (backend.name + '\t' + query.first + '\t' + (cold.round 2).to_text + '\t' + (warm.round 2).to_text + '\t' + kb.to_text + '\t' + flag)
```

- [ ] **Step 2: Run the report** (working directory `test/`, the project's
      parent)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && cd ~/enso-widgets-pr1a/test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --in-project "$PWD/Benchmarks" --run "$PWD/Benchmarks/src/Widgets/Widget_Query_Report.enso"'
```

Expected: 15 rows, no `ERROR` flag, sizes within 10% of the spec's baseline
table (`set` ~1.6 MB, `filter` ~942 KB, `select_columns` ~29 KB). Paste the
table into the PR description. If `--in-project` with a file does not resolve
`project.` imports, run the bench module's own `main`
(`--run "$PWD/Benchmarks/src/Widgets/Widget_Query_Bench.enso"`) for the timings,
and say so.

- [ ] **Step 3: The benchmark compiles and runs once, as CI's benchmark job
      does**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh sbt_run "-Dbench.compileOnly=true" "std-benchmarks/compile"'
```

Expected: success (the annotation processor generates the `Widget_Query_*`
classes).

- [ ] **Step 4: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1a add test/Benchmarks/src/Widgets test/Benchmarks/src/Main.enso
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Benchmark the widget query on 500 columns (in memory, SQLite, DuckDB)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Base CLAUDE.md, verify, open the PR

**Files:** Modify `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`.

- [ ] **Step 1: CLAUDE.md.** Add an "IDE entry points" section to Base's
      CLAUDE.md:
  - `Standard.Base.Metadata.Widget_Query.resolve_call` is the IDE's widget
    query: exact method lookup, the answer JSON (Global Constraints), errors as
    results, logged once on `Standard.Base.Metadata.Widget_Query`, timed under
    `Standard.Base.Logging.Progress`. The GUI moves to it in PR 1b.
  - `Meta.get_method_annotation`, `Meta.find_type_or_module` and
    `Meta.call_module_method` are IDE-only (`private: true`).
  - `call_module_method` is how an in-frame expression reaches a library without
    an import.
  - `Meta.Type.find` prefers a module to a type of the same name (Decision 3).

  Then:

```powershell
corepack pnpm exec prettier --write distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md
git -C C:\Repos\Enso\ide-widgets-pr1a add distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md
git -C C:\Repos\Enso\ide-widgets-pr1a commit -m "Base CLAUDE.md: the IDE's widget query entry point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Whole checks, on Linux**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh sbt_run "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck" "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest org.enso.interpreter.test.AnyOrStaticTest org.enso.interpreter.test.ExtensionMethodResolutionTest"'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1a.sh dist && for s in Base_Tests Table_Tests SQLite_Tests Geo_Tests Format_Discovery_Tests Visualization_Tests Examples_Tests; do echo "== $s"; ~/pr1a.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done && cd ~/enso-widgets-pr1a && corepack pnpm --filter build-scripts run stdlib-api-check && node tools/ci/check-workflows.mjs'
```

Expected: all green; each suite `0 tests failed.` with the counts of Task 6.

- [ ] **Step 3: Open the PR** with the label (it re-runs only the Changelog
      check)

```powershell
git -C C:\Repos\Enso\ide-widgets-pr1a push -u origin widgets/pr1a-query-entry-point
gh pr create --repo jdunkerley/enso --base develop --head widgets/pr1a-query-entry-point --label "CI: No changelog needed" --title "Widgets PR 1a: Widget_Query.resolve_call, an exact widget query entry point in Base" --body-file <scratchpad>/pr1a-body.md
```

`pr1a-body.md`:

```markdown
PR 1a of
[Widgets by conversion](docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md).
Nothing a user sees changes: the GUI keeps calling
`Standard.Visualization.Widgets.get_widget_json` until PR 1b.

## What changes

- **`Standard.Base.Metadata.Widget_Query.resolve_call`**, the widget query PR
  1b's GUI calls by method pointer. It finds the method exactly, by module, type
  and name (new builtins `Meta.get_method_annotation`,
  `Meta.find_type_or_module`, `Meta.get_module_method`, engine `MethodLookup`),
  so static methods, extension methods and methods of `Any` get their own
  annotations.
- **Errors are results.** Each argument gets `{"widget":…}` or
  `{"error":{"step","message"}}`. Each failure is logged once per engine session
  on `Standard.Base.Metadata.Widget_Query`, with the cause chain and, for a
  panic, the stack.
- **Timing** under Settings → Local → Engine logs → Performance timings
  (`Progress` handle `Widget_Query.<type>.<method>`).
- **`Meta.call_module_method`**: an expression evaluated in a user's module can
  call a library's entry point without importing the library (PR 1b uses it for
  the in-frame queries).
- The widget tests move to Base, Table, SQLite, Geo and Format_Discovery tests.
  One test in Visualization_Tests pins `get_widget_json`'s shape until PR 1b
  deletes it.
- A widget-query benchmark (`test/Benchmarks/src/Widgets`).

## Evidence

- Task 1 spike output (the fully-qualified-name rule).
- Benchmark report table (Task 7).
- Log lines from Task 5 Step 3.

## Not verified

- The Postgres-backed parts of `Postgres_Tests`.
- `gatherLicenses` (no dependency changed).
- A full `std-benchmarks` run (compile only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: After merge**: remove the worktree (not with
      `gh pr merge --delete-branch` while it is checked out) and
      `rm -rf ~/enso-widgets-pr1a` in WSL. PR 1b starts from the merged
      `develop`.

---

## Self-review: every PR 1a requirement and its task

| Requirement                                                                                   | Task               |
| --------------------------------------------------------------------------------------------- | ------------------ |
| Spike: the fully-qualified-name rule PR 1b's in-frame changes rest on                         | 1                  |
| Exact lookup (static, extension, `Any`), engine change                                        | 2; Decisions 2, 3  |
| `Meta.call_module_method`, `LogOnce`                                                          | 3                  |
| Entry point in Base, a module method (callable by method pointer)                             | 4; Decision 1      |
| Today's annotations unchanged, incl. functions of `self` with `cache`                         | 4                  |
| Per-argument widget or error; the JSON shape                                                  | 4                  |
| `Widget.resolve_type` left to PR 3                                                            | Global Constraints |
| Log once via `log_internal`: method, argument, step, message, causes, stack; dedup per inputs | 4, 5               |
| Timing under #342                                                                             | 4, 5; Decision 4   |
| Widget tests moved to the owning libraries                                                    | 6                  |
| `get_widget_json` kept working for the GUI, its shape pinned by a test                        | 6; Decision 6      |
| Benchmark checked in                                                                          | 7; Decision 5      |
| CLAUDE.md, PR with label                                                                      | 8                  |
